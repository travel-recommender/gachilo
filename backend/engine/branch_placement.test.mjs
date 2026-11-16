// 지점 자동 배치 (docs/branch_auto_placement.md). 실행 중 카탈로그(브랜드·교체 그룹 포함)로 검사한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateRealCandidates, branchCandidates, BRANCH_CANDIDATE_LIMIT} from './real_candidates.mjs';
import {mockLiveCheck} from './live_check.mjs';
import {loadRuntimeInputs, availability, validateDay} from '../../scripts/validate_real_schedule.mjs';

const {dataset, profiles} = loadRuntimeInputs();
const byId = new Map(dataset.places.map(r => [r.place.place_id, r]));
const offline = {liveCheck: mockLiveCheck('pass'), choose: null};
const member = (id, picks, extra = {}) => ({memberId: id, longlist: picks, picks, must: picks[0], veto: null,
  budgetPerDay: 200000, stepLimit: 30000, activeMin: 720, tradeoffs: {pace: 0.5, distance: 0.5, spend: 0.5}, ...extra});
const request = (date, submissions) => ({startDate: date, endDate: date, submissions,
  exchange_rate: {krw_per_jpy: '9.5', as_of: '2026-11-15'}});
const run = (r, deps = offline) => calculateRealCandidates(r, dataset, profiles, {baseUrl: ''}, deps);
const range = (start, end, submissions) => ({...request(start, submissions), endDate: end});
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
  // 우메다 장소들 옆의 시바타점은 같은 그룹에서 가장 가까워 바꿀 이유가 없다
  const picks = ['branch_kiddyland_umeda', 'branch_nintendo_osaka', 'branch_ichiran_umeda_shibata'];
  const {candidates} = await run(request('2026-11-16', [member('a', picks), member('b', picks)]));
  for (const c of candidates) {
    const ichiran = items(c).filter(i => byId.get(i.placeId).place.brand_id === 'ichiran');
    assert.deepEqual(ichiran.map(i => i.placeId), ['branch_ichiran_umeda_shibata'], c.strategy);
    assert.ok(!items(c).some(i => i.branch), c.strategy);
  }
});

test('교체로 빠진 원래 지점은 다음 날 다시 들어가지 않는다 — 같은 가게를 두 번 방문하지 않음 (#74 리뷰)', async () => {
  const {candidates} = await run(range('2026-11-16', '2026-11-17', [
    member('a', ['branch_ichiran_abeno', 'branch_kiddyland_umeda', 'branch_nintendo_osaka']),
    member('b', ['branch_kiddyland_umeda', 'branch_ichiran_abeno']),
  ]));
  for (const c of candidates) {
    const groups = items(c).map(i => byId.get(i.placeId).place.branch_group_id).filter(Boolean);
    assert.equal(new Set(groups).size, groups.length, `${c.strategy}: ${items(c).map(i => i.placeId)}`);
    assert.ok(items(c).some(i => i.branch?.fromPlaceId === 'branch_ichiran_abeno'), c.strategy);
    assert.ok(!items(c).some(i => i.placeId === 'branch_ichiran_abeno'), c.strategy);
  }
});

test('두 사람이 같은 교체 그룹의 다른 지점을 골라도 한 번만 넣고, 둘 다 반영으로 센다', async () => {
  const {candidates} = await run(range('2026-11-16', '2026-11-17', [
    member('a', ['branch_ichiran_abeno', 'branch_kiddyland_umeda']),
    member('b', ['branch_ichiran_umeda_shibata', 'branch_kiddyland_umeda']),
  ]));
  for (const c of candidates) {
    const ichiran = items(c).filter(i => byId.get(i.placeId).place.branch_group_id === 'ichiran:standard');
    assert.equal(ichiran.length, 1, `${c.strategy}: ${items(c).map(i => i.placeId)}`);
    assert.equal(c.planning.unplaced_count, 0, c.strategy);
    assert.equal(c.planning.must_satisfied, true, c.strategy);
  }
});

test('고른 지점이 오늘 휴무면 남은 날을 기다리지 않고 오늘 영업 지점을 시도한다 (#74 리뷰)', async () => {
  // 본점은 11/17 휴무, 11/18 영업. 11/18에 예산·시간으로 떨어져도 대체 기회가 없던 문제를 막는다
  const {candidates} = await run(range('2026-11-17', '2026-11-18', [member('a', ['branch_551_honten']), member('b', ['branch_551_honten'])]));
  for (const c of candidates) {
    assert.deepEqual(c.days.map(d => d.placeIds), [['branch_551_namba_walk'], []], c.strategy);
    assert.equal(c.planning.must_satisfied, true);
  }
});

test('교체 후보는 고른 곳마다 최대 3곳, 제외한 브랜드는 실시간 확인에도 넣지 않는다 (#74 리뷰)', async () => {
  const seen = [];
  const spy = async requests => { seen.push(...requests.map(r => r.record.place.place_id)); return mockLiveCheck('pass')(requests); };
  const picks = ['branch_ichiran_abeno', 'branch_kiddyland_umeda', 'branch_551_honten'];
  const dates = ['2026-11-16', '2026-11-17'];
  const vetoes = new Set(['branch_551_takashimaya_osaka']);
  const cands = branchCandidates(dataset, profiles, dates, picks, vetoes);
  assert.equal(cands.has('branch_551_honten'), false, '제외한 브랜드');
  assert.ok(cands.get('branch_ichiran_abeno').length <= BRANCH_CANDIDATE_LIMIT);
  await run(range(dates[0], dates[1], [member('a', picks), member('b', ['branch_kiddyland_umeda'], {veto: 'branch_551_takashimaya_osaka'})]),
    {liveCheck: spy, choose: null});
  const checked = new Set(seen);
  const ichiranBranches = dataset.places.filter(r => r.place.brand_id === 'ichiran' && r.place.place_id !== 'branch_ichiran_abeno')
    .map(r => r.place.place_id).filter(id => checked.has(id));
  assert.ok(ichiranBranches.length <= BRANCH_CANDIDATE_LIMIT, ichiranBranches.join(','));
  assert.ok(!dataset.places.some(r => r.place.brand_id === '551_horai' && r.place.place_id !== 'branch_551_honten' && checked.has(r.place.place_id)));
});

test('예전 카탈로그(브랜드 정보 없음)에서는 아무것도 바꾸지 않는다', async () => {
  const {loadInputs} = await import('../../scripts/validate_real_schedule.mjs');
  const old = loadInputs();
  const r = await calculateRealCandidates({startDate: '2026-10-01', endDate: '2026-10-02', exchange_rate: {krw_per_jpy: '9.5', as_of: '2026-11-15'},
    submissions: [member('a', old.dataset.places.slice(0, 6).map(p => p.place.place_id))]}, old.dataset, old.profiles, {baseUrl: ''}, offline);
  // 예외를 삼키지 않는다 — 결과가 반드시 있어야 하고, 아무것도 바뀌지 않아야 한다 (#74 리뷰)
  assert.ok(r.candidates.length > 0);
  for (const c of r.candidates) assert.ok(!items(c).some(i => i.branch));
});

// 11/16 모의 실험: 활동 시간을 10~19시로 넣어도 '여유'가 한 명 있으면 하루 2곳에서 끝나 오후 1시쯤 일정이 끝났다
test('하루 자리 수는 활동 시간에 맞춘다 — 여유라도 9시간이면 하루 2곳에서 끝내지 않는다', async () => {
  const {realSlotsPerDay} = await import('./real_candidates.mjs');
  assert.equal(realSlotsPerDay(0, 540), 4);    // 여유, 10~19시: 120분에 한 곳
  assert.equal(realSlotsPerDay(0.5, 540), 7);  // 보통: 75분에 한 곳
  assert.equal(realSlotsPerDay(1, 540), 8);    // 빡빡: 60분에 한 곳, 상한 8
  assert.equal(realSlotsPerDay(0, 240), 2);    // 짧은 활동 시간은 그대로 적게
  assert.equal(realSlotsPerDay(0, 60), 2);     // 하한
  // 실제 장소 12곳을 셋이 나눠 고른 하루 여행: 예전(여유 = 하루 2곳)보다 많이 넣는다
  const picks = ['branch_kiddyland_umeda', 'branch_nintendo_osaka', 'branch_ichiran_umeda_shibata', 'osaka_015', 'osaka_011', 'osaka_012'];
  // 1순위는 자리 수와 상관없이 먼저 들어가므로, 셋 다 같은 1순위로 두어 자리 수 효과만 본다
  const subs = [picks.slice(0, 3), picks.slice(2, 5), picks.slice(3)]
    .map((p, k) => ({...member('m' + k, [picks[0], ...p.filter(x => x !== picks[0])]), activeMin: 540, tradeoffs: {pace: 0, distance: 0.5, spend: 0.5}}));
  const {candidates} = await run(request('2026-11-17', subs));
  for (const c of candidates) assert.ok(c.days[0].placeIds.length > 2, `${c.strategy}: ${c.days[0].placeIds}`);
});

test('빈자리 후보 수는 여행 전체 자리만큼 늘어난다 (예전 10곳 고정 → 10~30곳)', async () => {
  const {buildPool} = await import('./real_ai.mjs');
  const candidates = dataset.places.filter(r => availability(r, '2026-11-17', profiles, {allowShopping: true}).eligible_for_model)
    .map(record => ({record, costKrw: 0}));
  // 취향이 넓은 사람(여러 유형을 담음)이어야 후보가 취향 필터를 넉넉히 통과한다
  const taste = dataset.places.filter(r => r.place.category).map(r => r.place.place_id);
  const args = {candidates, submissions: [{...member('a', taste.slice(0, 5)), longlist: taste}], byId, missedMusts: [], budgetKrw: 1e9};
  assert.equal(buildPool(args).length, 10);
  assert.ok(buildPool({...args, size: 21}).length > 10);
});
