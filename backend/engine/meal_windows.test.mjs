// 11/25 실험 피드백: 끼니 시간대(아침 8–10 · 점심 11–14 · 저녁 17–20)마다 식당 하나, 하루 최소 장소 수(3시간마다 2곳).
import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateRealCandidates, mealWindowsFor, minPlacesFor, realSlotsPerDay, paceSlotsFor} from './real_candidates.mjs';
import {loadRuntimeInputs, availability} from '../../scripts/validate_real_schedule.mjs';
import {mockLiveCheck} from './live_check.mjs';
import {buildSchedule, MEAL_WINDOWS} from './schedule.ts';

const {dataset, profiles} = loadRuntimeInputs();
const byId = new Map(dataset.places.map(r => [r.place.place_id, r]));
const DATES = ['2026-11-17', '2026-11-18'];
const sights = dataset.places.filter(r => r.place.category !== '식사'
  && DATES.every(d => availability(r, d, profiles, {allowShopping: true}).eligible_for_model)).map(r => r.place.place_id);
const isFood = id => byId.get(id)?.place.category === '식사';

const trip = (activeMin, extra = {}) => ({startDate: DATES[0], endDate: DATES.at(-1), exchange_rate: {krw_per_jpy: '9.5', as_of: '2026-11-15'},
  submissions: [0, 1, 2].map(i => {
    const picks = sights.filter((_, k) => k % 7 === i).slice(0, 2);
    const longlist = [...new Set([...picks, ...sights.filter((_, k) => k % 3 === i).slice(0, 6)])];
    return {memberId: 'm' + i, picks, longlist, musts: [picks[0]], vetoes: [], budgetPerDay: 150000, stepLimit: 20000, activeMin,
      tradeoffs: {pace: 0, distance: 0.5, spend: 0.5}, ...extra};
  })});
const offline = {liveCheck: mockLiveCheck('pass'), choose: null};

test('활동 시간에 1시간 이상 걸친 끼니 창만 채운다 (하루는 09:00 시작)', () => {
  assert.deepEqual(mealWindowsFor(720).map(m => m.name), ['breakfast', 'lunch', 'dinner']);  // 09–21시
  assert.deepEqual(mealWindowsFor(540).map(m => m.name), ['breakfast', 'lunch', 'dinner']);  // 09–18시: 저녁 17–18시
  assert.deepEqual(mealWindowsFor(300).map(m => m.name), ['breakfast', 'lunch']);            // 09–14시
  assert.deepEqual(mealWindowsFor(120).map(m => m.name), ['breakfast']);                     // 09–11시: 점심 창과 0분
  assert.deepEqual(MEAL_WINDOWS, {breakfast: [480, 600], lunch: [660, 840], dinner: [1020, 1200]});
});

test('하루 최소 장소 수: 3시간마다 2곳, 오래 머무는 곳은 한 곳으로 세고 그 시간을 뺀다', () => {
  assert.equal(minPlacesFor(540), 6);           // 9시간 → 6곳
  assert.equal(minPlacesFor(720), 8);           // 12시간 → 8곳
  assert.equal(minPlacesFor(540, [480]), 2);    // USJ 8시간 + 남은 1시간에 1곳
  assert.equal(minPlacesFor(540, [180]), 5);    // 3시간 머무는 곳 + 남은 6시간에 4곳
  assert.equal(minPlacesFor(1000), 10);         // 상한
  // 속도로 정한 자리 수보다 적게 잡지 않는다
  assert.equal(realSlotsPerDay(0, 540), Math.max(paceSlotsFor(0, 540), 6));
  assert.equal(realSlotsPerDay(1, 540), 8);
});

test('아침 옵션: 아침 창에 여는 고른 식당을 첫 일정으로 둔다. 끄면 점심까지 미룬다', () => {
  const at = (id, lat, opts) => ({place: {id, name: id, area: 'x', category: 'food', lat, lng: 135.5, cost: 0, stayMin: 60,
    openFrom: 480, openTo: 1320, bagLoad: 0}, votes: 1, mustOf: null, tier: 'core', participants: []});
  const sels = [at('diner', 34.6), {...at('museum', 34.601), place: {...at('museum', 34.601).place, category: 'culture'}}];
  const on = buildSchedule(sels, 1, {breakfast: true}).plans[0].items;
  assert.equal(on[0].place.id, 'diner');
  assert.ok(on[0].startMin >= 480 && on[0].startMin < 600);
  const off = buildSchedule(sels, 1, {}).plans[0].items;
  assert.equal(off.find(i => i.place.id === 'diner').startMin, 720);
});

test('실제 장소 일정: 넣은 끼니 식당은 그 끼니 창 안에서 시작하고, 규칙으로 넣었다고 밝힌다', async () => {
  const {candidates} = await calculateRealCandidates(trip(720), dataset, profiles, {baseUrl: ''}, offline);
  for (const c of candidates) {
    const filled = c.days.flatMap(d => d.items).filter(i => i.source === 'meal_fill');
    assert.ok(filled.length >= DATES.length, `${c.strategy}: 끼니 식당 ${filled.length}곳`);
    assert.equal(c.planning.meal_fill.added_count, filled.length);
    assert.deepEqual(c.planning.meal_fill.windows, ['breakfast', 'lunch', 'dinner']);
    assert.match(c.summary, /빈 끼니 시간.*식당 \d+곳을 규칙으로 추가/);
    for (const i of filled) {
      assert.ok(isFood(i.placeId));
      assert.equal(i.filled, true);
      assert.equal(i.aiAdded, false);
      assert.equal(i.reasonCode, 'meal_slot');
      assert.ok(Object.values(MEAL_WINDOWS).some(([from, to]) => i.startMin >= from && i.startMin < to), `${i.placeId}@${i.startMin}`);
    }
    // 끼니 식당은 아무도 담지 않은 곳이고, 같은 식당을 두 번 넣지 않는다
    const listed = new Set(trip(720).submissions.flatMap(s => [...s.picks, ...s.longlist]));
    assert.ok(filled.every(i => !listed.has(i.placeId)));
    assert.equal(new Set(filled.map(i => i.placeId)).size, filled.length);
    // 하루에 점심 창 식당은 하나뿐이다
    for (const d of c.days) {
      const lunches = d.items.filter(i => isFood(i.placeId) && i.startMin >= 660 && i.startMin < 840);
      assert.ok(lunches.length <= 1, `${c.strategy} ${d.date}: ${lunches.map(i => i.placeId)}`);
    }
    // 끼니 식당은 AI 추가 수에 섞이지 않는다
    assert.equal(c.planning.ai_fill.added_count, 0);
  }
});

test('끼니 채우기를 끄면(deps.mealFill=false) 아무도 담지 않은 식당을 넣지 않는다', async () => {
  const {candidates} = await calculateRealCandidates(trip(720), dataset, profiles, {baseUrl: ''}, {...offline, mealFill: false});
  for (const c of candidates) {
    assert.ok(!c.days.flatMap(d => d.items).some(i => i.source === 'meal_fill'));
    assert.equal(c.planning.meal_fill.added_count, 0);
  }
});

test('끼니 식당만으로는 일정을 만들지 않는다 — 식당 말고는 모두 실시간 확인에 실패하면 실패한다', async () => {
  const r = trip(720);
  // 구성원 장소와 그 교체 지점까지 모두 실패, 식당만 통과
  const liveCheck = async requests => ({source: 'mock', checked_on: '2026-11-15', fetched: 0, reused: 0,
    verdicts: new Map(requests.map(({record, date}) => [`${record.place.place_id}|${date}`, record.place.category !== '식사' ? ['live_closed_permanently'] : []]))});
  await assert.rejects(calculateRealCandidates(r, dataset, profiles, {baseUrl: ''}, {liveCheck, choose: null}), /NO_SCHEDULABLE_REAL_CANDIDATE/);
});
