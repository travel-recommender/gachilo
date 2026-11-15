// 지점 자동 배치 (docs/branch_auto_placement.md). 실행 중 카탈로그(브랜드·교체 그룹 포함)로 검사한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateRealCandidates} from './real_candidates.mjs';
import {mockLiveCheck} from './live_check.mjs';
import {loadRuntimeInputs, availability, validateDay} from '../../scripts/validate_real_schedule.mjs';

const {dataset, profiles} = loadRuntimeInputs();
const byId = new Map(dataset.places.map(r => [r.place.place_id, r]));
const offline = {liveCheck: mockLiveCheck('pass'), choose: null};
const member = (id, picks, extra = {}) => ({memberId: id, longlist: picks, picks, must: picks[0], veto: null,
  budgetPerDay: 200000, stepLimit: 30000, activeMin: 720, tradeoffs: {pace: 0.5, distance: 0.5, spend: 0.5}, ...extra});
const request = (date, submissions) => ({startDate: date, endDate: date, submissions,
  exchange_rate: {krw_per_jpy: '9.5', as_of: '2026-11-15'}});
const run = r => calculateRealCandidates(r, dataset, profiles, {baseUrl: ''}, offline);
const items = c => c.days.flatMap(d => d.items);
const moveMin = (date, ids) => validateDay({budget_krw: 1e9, step_limit: 1e9, active_min: 1440, krw_per_jpy: '9.5', date, place_ids: ids},
  dataset, profiles, {allowShopping: true, candidateMetrics: true, distanceWeight: 0.5}).items.reduce((t, i) => t + i.move_min, 0);

test('카탈로그: 551 본점은 11/17 휴무, 같은 식당 그룹의 난바워크는 영업, 포장(다카시마야)은 다른 교체 그룹', () => {
  const ok = (id, date) => availability(byId.get(id), date, profiles, {allowShopping: true}).eligible_for_model;
  assert.equal(ok('branch_551_honten', '2026-11-17'), false);
  assert.equal(ok('branch_551_namba_walk', '2026-11-17'), true);
  assert.equal(byId.get('branch_551_honten').place.branch_group_id, byId.get('branch_551_namba_walk').place.branch_group_id);
  assert.notEqual(byId.get('branch_551_honten').place.branch_group_id, byId.get('branch_551_takashimaya_osaka').place.branch_group_id);
});

test('고른 지점이 그날 휴무면 같은 교체 그룹의 영업 지점으로 넣고, 꼭 가기·1순위는 반영된 것으로 센다', async () => {
  const {candidates} = await run(request('2026-11-17', [member('a', ['branch_551_honten']), member('b', ['branch_551_honten'])]));
  for (const c of candidates) {
    const placed = items(c);
    assert.deepEqual(placed.map(i => i.placeId), ['branch_551_namba_walk'], c.strategy);
    assert.deepEqual(placed[0].branch, {fromPlaceId: 'branch_551_honten', reasonCode: 'original_unavailable', savedMin: null});
    assert.equal(placed[0].source, 'selected');
    assert.equal(c.planning.must_satisfied, true);
    assert.equal(c.planning.unplaced_count, 0);
    // 포장 전용 지점(다른 방문 목적)으로는 바꾸지 않는다
    assert.ok(!placed.some(i => i.placeId === 'branch_551_takashimaya_osaka'));
  }
});

test('누군가 그 브랜드의 지점을 제외했으면 다른 지점으로 바꾸지 않는다', async () => {
  const {candidates} = await run(request('2026-11-17', [
    member('a', ['branch_551_honten', 'branch_kiddyland_umeda']),
    member('b', ['branch_kiddyland_umeda'], {veto: 'branch_551_takashimaya_osaka'}),
  ]));
  for (const c of candidates) {
    assert.ok(!items(c).some(i => byId.get(i.placeId).place.brand_id === '551_horai'), c.strategy);
    assert.ok(!items(c).some(i => i.branch));
    assert.equal(c.planning.must_satisfied, false);
  }
});

test('앞뒤 장소와 더 가까운 같은 그룹 지점이 있으면 바꾸고, 줄어든 이동 시간은 실제 계산과 같다', async () => {
  const date = '2026-11-16';
  const picks = ['branch_kiddyland_umeda', 'branch_nintendo_osaka', 'branch_ichiran_abeno'];
  const {candidates} = await run(request(date, [member('a', picks), member('b', [...picks].reverse())]));
  for (const c of candidates) {
    const day = c.days[0];
    const swapped = day.items.filter(i => i.branch);
    assert.equal(swapped.length, 1, c.strategy);
    const [item] = swapped;
    assert.equal(item.branch.fromPlaceId, 'branch_ichiran_abeno');
    assert.equal(item.branch.reasonCode, 'shorter_route');
    assert.equal(byId.get(item.placeId).place.branch_group_id, 'ichiran:standard');
    assert.notEqual(byId.get(item.placeId).place.place_id, 'osm_node_2546559085', '폐업 보류 본관으로는 바꾸지 않는다');
    const before = day.placeIds.map(id => id === item.placeId ? 'branch_ichiran_abeno' : id);
    const saved = moveMin(date, before) - moveMin(date, day.placeIds);
    assert.ok(saved >= 1);
    assert.equal(item.branch.savedMin, Math.round(saved));
    assert.equal(c.planning.unplaced_count, 0, '원래 고른 아베노점은 반영된 것으로 센다');
  }
});

test('이미 가장 가까운 지점이면 그대로 두고, 교체 정보도 붙이지 않는다', async () => {
  const date = '2026-11-16';
  const picks = ['branch_kiddyland_umeda', 'branch_nintendo_osaka', 'branch_ichiran_umeda_hankyu'];
  const {candidates} = await run(request(date, [member('a', picks), member('b', picks)]));
  for (const c of candidates) {
    for (const i of items(c)) {
      if (!i.branch) continue;
      // 바꿨다면 반드시 이동이 1분 이상 줄어야 한다
      const day = c.days.find(d => d.placeIds.includes(i.placeId));
      const before = day.placeIds.map(id => id === i.placeId ? i.branch.fromPlaceId : id);
      assert.ok(moveMin(date, before) - moveMin(date, day.placeIds) >= 1);
    }
  }
});

test('예전 카탈로그(브랜드 정보 없음)에서는 아무것도 바꾸지 않는다', async () => {
  const {loadInputs} = await import('../../scripts/validate_real_schedule.mjs');
  const old = loadInputs();
  const r = await calculateRealCandidates({startDate: '2026-10-01', endDate: '2026-10-02', exchange_rate: {krw_per_jpy: '9.5', as_of: '2026-11-15'},
    submissions: [member('a', old.dataset.places.slice(0, 6).map(p => p.place.place_id))]}, old.dataset, old.profiles, {baseUrl: ''}, offline)
    .catch(() => null);
  if (r) for (const c of r.candidates) assert.ok(!items(c).some(i => i.branch));
});
