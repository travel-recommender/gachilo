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
    // 다른 장소가 우메다이므로, 아무도 고르지 않은 지점이 아니라 b가 고른 시바타점이 그대로 들어간다 (#74 재리뷰)
    assert.equal(ichiran[0].placeId, 'branch_ichiran_umeda_shibata', c.strategy);
    assert.ok(!ichiran[0].branch, c.strategy);
    assert.equal(c.planning.unplaced_count, 0, c.strategy);
    assert.equal(c.planning.must_satisfied, true, c.strategy);
  }
});

test('원래 지점이 남은 날 영업하고 넣을 수 있으면 그날 원래 지점으로 넣는다 (#74 재리뷰)', async () => {
  // 본점은 11/17 휴무, 11/18 영업. 두 사람 모두 본점을 골랐으므로 11/18의 본점이 맞다
  const {candidates} = await run(range('2026-11-17', '2026-11-18', [member('a', ['branch_551_honten']), member('b', ['branch_551_honten'])]));
  for (const c of candidates) {
    assert.deepEqual(c.days.map(d => d.placeIds), [[], ['branch_551_honten']], c.strategy);
    assert.ok(!items(c).some(i => i.branch));
    assert.equal(c.planning.must_satisfied, true);
  }
});

test('기다렸는데 원래 지점이 결국 못 들어가면, 휴무인 날 영업 지점으로 대신 넣는다 (#74 리뷰 2번)', async () => {
  // 본점이 11/18에 영업해도 그날 검사(여기서는 체류 시간이 활동 시간보다 김)에서 떨어지게 만든다
  const places = dataset.places.map(r => r.place.place_id !== 'branch_551_honten' ? r
    : {...r, place: {...r.place, stay_min: 2000}, review: {...r.review, stay_policy: {...r.review.stay_policy, representative: 2000}}});
  const {candidates} = await calculateRealCandidates(range('2026-11-17', '2026-11-18', [member('a', ['branch_551_honten']), member('b', ['branch_551_honten'])]),
    {...dataset, places}, profiles, {baseUrl: ''}, offline);
  for (const c of candidates) {
    assert.deepEqual(c.days.map(d => d.placeIds), [['branch_551_namba_walk'], []], c.strategy);
    assert.equal(items(c)[0].branch.reasonCode, 'original_unavailable');
    assert.equal(c.planning.must_satisfied, true);
  }
});

test('다시 짤 때는 기다린 결과에서 빠진 곳만 대체한다 — 원래 지점으로 들어간 곳은 그대로 (#74 재리뷰 3차)', async () => {
  // 본점: 11/17 휴무, 11/18 영업 → 기다려서 11/18 본점으로 들어간다.
  // 다루마 도톤보리: 11/17을 휴무로 두고 11/18은 체류 시간 2000분으로 탈락 → 다시 짤 때 11/17 신세카이점으로 대신 들어가야 한다.
  // 다시 짤 때 고른 곳 전체를 넘기면 본점까지 11/17 난바워크점으로 바뀌어 이 테스트가 실패한다.
  const y = 'branch_daruma_dotonbori';
  const places = dataset.places.map(r => r.place.place_id !== y ? r
    : {...r, place: {...r.place, stay_min: 2000}, review: {...r.review, stay_policy: {...r.review.stay_policy, representative: 2000}}});
  const yProfile = profiles.places[y];
  const closedProfiles = {...profiles, places: {...profiles.places, [y]: {...yProfile, uncertain_dates: [...(yProfile.uncertain_dates ?? []), '2026-11-17']}}};
  const picks = ['branch_551_honten', y];
  const {candidates} = await calculateRealCandidates(range('2026-11-17', '2026-11-18', [member('a', picks), member('b', picks)]),
    {...dataset, places}, closedProfiles, {baseUrl: ''}, offline);
  for (const c of candidates) {
    assert.deepEqual(c.days.map(d => d.placeIds), [['branch_daruma_shinsekai'], ['branch_551_honten']], c.strategy);
    assert.equal(items(c)[0].branch.fromPlaceId, y);
    assert.equal(items(c)[0].branch.reasonCode, 'original_unavailable');
    assert.ok(!items(c)[1].branch);
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

test('빈자리 후보 수는 여행 전체 자리만큼 늘어난다 (예전 10곳 고정 → 10~20곳)', async () => {
  const {buildPool} = await import('./real_ai.mjs');
  const candidates = dataset.places.filter(r => availability(r, '2026-11-17', profiles, {allowShopping: true}).eligible_for_model)
    .map(record => ({record, costKrw: 0}));
  // 취향이 넓은 사람(여러 유형을 담음)이어야 후보가 취향 필터를 넉넉히 통과한다
  const taste = dataset.places.filter(r => r.place.category).map(r => r.place.place_id);
  const args = {candidates, submissions: [{...member('a', taste.slice(0, 5)), longlist: taste}], byId, missedMusts: [], budgetKrw: 1e9};
  assert.equal(buildPool(args).length, 10);
  assert.ok(buildPool({...args, size: 21}).length > 10);
});

test('같은 교체 그룹의 지점은 상한 밖이어도 AI·규칙 채우기 후보가 되지 않는다 (#74 재리뷰)', async () => {
  // 채우기 후보 풀(모델에 보낼 목록)을 직접 받아 본다
  let pool = [];
  const choose = async candidates => { pool = candidates.map(c => c.id); return {source: 'rule_added', picks: []}; };
  const taste = ['branch_ichiran_abeno', 'branch_kiddyland_umeda', 'branch_marugame_umeda', 'branch_daruma_dotonbori'];
  await run(range('2026-11-16', '2026-11-18', [member('a', taste), member('b', ['branch_ichiran_abeno'])]),
    {liveCheck: mockLiveCheck('pass'), choose});
  assert.ok(pool.length > 0);
  const ichiranInPool = pool.filter(id => byId.get(id).place.branch_group_id === 'ichiran:standard');
  assert.deepEqual(ichiranInPool, []);
});

test('교체 후보 순서는 제외한 장소 근처가 아니라 같이 갈 장소 근처 지점부터 (#74 재리뷰)', () => {
  // 난바 근처의 브랜드 없는 장소 하나를 누군가 제외했다고 둔다. 같이 갈 장소는 우메다뿐이다
  const namba = dataset.places.find(r => r.place.place_id !== 'branch_ichiran_abeno' && !r.place.brand_id
    && Math.abs(r.place.latitude - 34.669) < 0.003 && Math.abs(r.place.longitude - 135.501) < 0.004).place.place_id;
  const ids = ['branch_ichiran_abeno', 'branch_kiddyland_umeda', namba];
  const top = branchCandidates(dataset, profiles, ['2026-11-16'], ids, new Set([namba])).get('branch_ichiran_abeno');
  assert.deepEqual(top.slice(0, 2).sort(), ['branch_ichiran_umeda_hankyu', 'branch_ichiran_umeda_shibata'], `${namba}: ${top}`);
});

test('가까운 지점으로 바꿔도 문 닫는 시각이 이른 곳을 먼저 가서 빠지는 곳이 없으면 바꾼다 (11/18 테스트 피드백)', async () => {
  // 앞뒤가 모두 우메다인데 신사이바시점이 남던 경우: 우메다점으로 바꾸면 가까운 백화점부터 가느라 17시에 닫는 텐만구가 빠져 교체가 탈락했다
  const picks = ['branch_ichiran_shinsaibashi', 'osaka_007', 'osaka_010', 'osaka_023'];
  const {candidates} = await run(request('2026-11-18', [member('a', picks, {must: 'osaka_007', activeMin: 600}), member('b', picks, {must: 'osaka_007', activeMin: 600})]));
  for (const c of candidates) {
    const ids = items(c).map(i => i.placeId);
    assert.ok(ids.includes('osaka_010'), c.strategy);
    assert.ok(!ids.includes('branch_ichiran_shinsaibashi'), c.strategy);
    const ichiran = items(c).find(i => i.branch?.fromPlaceId === 'branch_ichiran_shinsaibashi');
    assert.ok(ichiran && /umeda/.test(ichiran.placeId), c.strategy);
    assert.equal(ichiran.branch.reasonCode, 'shorter_route');
  }
});
