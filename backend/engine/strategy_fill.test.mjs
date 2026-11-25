// 11/25 실험 피드백: 구성원이 담은 곳이 모두 들어가면 A·B·C가 같았다. 빈자리 채우기 순서를 전략마다 다르게 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateRealCandidates} from './real_candidates.mjs';
import {memberFits, REASON_TEXT} from './real_ai.mjs';
import {loadRuntimeInputs, availability, toEnginePlace} from '../../scripts/validate_real_schedule.mjs';
import {mockLiveCheck} from './live_check.mjs';

const {dataset, profiles} = loadRuntimeInputs();
const byId = new Map(dataset.places.map(r => [r.place.place_id, r]));
const DATE = '2026-11-17';
const open = dataset.places.filter(r => availability(r, DATE, profiles, {allowShopping: true}).eligible_for_model);
const ofKind = kinds => open.filter(r => kinds.includes(r.place.category)).slice(0, 2).map(r => r.place.place_id);
// 취향이 서로 다른 세 사람: 문화·명소 / 쇼핑·카페 / 자연·체험
const KINDS = [['문화', '명소'], ['쇼핑', '카페'], ['자연', '체험·오락']];
const request = () => ({startDate: DATE, endDate: DATE, exchange_rate: {krw_per_jpy: '9.5', as_of: '2026-11-15'},
  submissions: KINDS.map((kinds, k) => {
    const picks = ofKind(kinds);  // 한 사람에 2곳: 하루에 빈자리가 남게
    return {memberId: 'm' + k, picks, longlist: picks, musts: [], vetoes: [], budgetPerDay: 120000, stepLimit: 20000,
      activeMin: 720, tradeoffs: {pace: 1, distance: 0.5, spend: 0.5}};
  })});
const withoutKey = async fn => {
  const saved = [process.env.SOMSOM_API_KEY, process.env.AI_MOCK];
  delete process.env.SOMSOM_API_KEY; delete process.env.AI_MOCK;
  try { return await fn(); } finally {
    if (saved[0] !== undefined) process.env.SOMSOM_API_KEY = saved[0];
    if (saved[1] !== undefined) process.env.AI_MOCK = saved[1];
  }
};
const fitsOf = (r, id) => {
  const record = byId.get(id);
  const cost = toEnginePlace(record, availability(record, DATE, profiles, {allowShopping: true}), r.exchange_rate.krw_per_jpy).cost;
  return memberFits(record, cost, r.submissions, byId);
};

test('취향이 다른 그룹에서는 세 전략이 빈자리를 다른 장소로 채운다', async () => {
  const r = request();
  const {candidates} = await withoutKey(() => calculateRealCandidates(r, dataset, profiles, {baseUrl: ''}, {liveCheck: mockLiveCheck('pass'), mealFill: false}));
  // 세 사람 모두에게 맞는 곳이 없으면 최소 불만은 채우지 않고, 평균 만족·공정성은 채운다
  const fills = candidates.map(c => c.days.flatMap(d => d.items).filter(i => i.aiAdded).map(i => i.placeId).sort().join(','));
  assert.ok(new Set(fills).size > 1, `세 전략의 채운 곳이 모두 같다: ${fills[0]}`);
  assert.ok(fills.some(Boolean));
  // 구성원이 담은 곳은 세 전략 모두 그대로 들어간다(채우기만 다르다)
  const mine = new Set(r.submissions.flatMap(s => s.picks));
  for (const c of candidates) assert.equal(c.planning.unplaced_count, 0, c.strategy);
  for (const c of candidates) assert.ok([...mine].every(id => c.days.some(d => d.placeIds.includes(id))), c.strategy);
});

test('최소 불만은 누군가에게 맞지 않는 곳(적합도 0.2 미만)으로 채우지 않는다', async () => {
  const r = request();
  const {candidates} = await withoutKey(() => calculateRealCandidates(r, dataset, profiles, {baseUrl: ''}, {liveCheck: mockLiveCheck('pass'), mealFill: false}));
  const misery = candidates.find(c => c.strategy === 'least_misery');
  for (const i of misery.days.flatMap(d => d.items).filter(i => i.aiAdded)) {
    assert.ok(Math.min(...fitsOf(r, i.placeId)) >= 0.2, i.placeId);
  }
});

test('공정성이 한 사람의 취향으로 채운 곳은 그 근거를 쓰되 누구인지는 밝히지 않는다', async () => {
  const r = request();
  const {candidates} = await withoutKey(() => calculateRealCandidates(r, dataset, profiles, {baseUrl: ''}, {liveCheck: mockLiveCheck('pass'), mealFill: false}));
  const fair = candidates.find(c => c.strategy === 'fairness').days.flatMap(d => d.items).filter(i => i.reasonCode === 'member_taste');
  assert.ok(fair.length > 0);
  for (const i of fair) {
    assert.ok(i.reason.startsWith(REASON_TEXT.member_taste));
    assert.ok(!/m[012]/.test(i.reason));
  }
  // 다른 전략은 이 근거를 쓰지 않는다
  for (const c of candidates.filter(c => c.strategy !== 'fairness')) {
    assert.ok(!c.days.flatMap(d => d.items).some(i => i.reasonCode === 'member_taste'), c.strategy);
  }
});
