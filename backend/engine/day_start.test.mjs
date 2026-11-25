// 11/25: 화면(P6)에서 고른 하루 시작 시각을 엔진이 쓴다. 예전에는 항상 09:00에 시작했다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateRealCandidates, groupDay, mealWindowsFor} from './real_candidates.mjs';
import {loadRuntimeInputs, availability, validateDay} from '../../scripts/validate_real_schedule.mjs';
import {mockLiveCheck} from './live_check.mjs';

const {dataset, profiles} = loadRuntimeInputs();
const DATE = '2026-11-17';
const sights = dataset.places.filter(r => r.place.category !== '식사'
  && availability(r, DATE, profiles, {allowShopping: true}).eligible_for_model).map(r => r.place.place_id);
const trip = (members) => ({startDate: DATE, endDate: DATE, exchange_rate: {krw_per_jpy: '9.5', as_of: '2026-11-15'},
  submissions: members.map((m, k) => {
    const picks = sights.filter((_, i) => i % 5 === k).slice(0, 3);
    return {memberId: 'm' + k, picks, longlist: picks, musts: [], vetoes: [], budgetPerDay: 150000, stepLimit: 20000,
      tradeoffs: {pace: 0.5, distance: 0.5, spend: 0.5}, ...m};
  })});
const offline = {liveCheck: mockLiveCheck('pass'), choose: null};

test('그룹의 하루: 가장 늦은 시작 ~ 가장 이른 끝. 시작 시각이 없는 옛 입력은 09:00 · 가장 짧은 활동 시간', () => {
  assert.deepEqual(groupDay([{activeMin: 480}, {activeMin: 600}]), {start: 540, active: 480, explicit: false});
  assert.deepEqual(groupDay([{dayStartMin: 480, activeMin: 780}, {dayStartMin: 600, activeMin: 600}]), {start: 600, active: 600, explicit: true});
  // 한 사람만 시작 시각을 보냈으면 나머지는 09:00으로 본다
  assert.deepEqual(groupDay([{dayStartMin: 480, activeMin: 780}, {activeMin: 480}]), {start: 540, active: 480, explicit: true});
  // 겹치는 시간이 1시간 미만이면 가장 늦은 시작부터 가장 짧은 활동 시간
  assert.deepEqual(groupDay([{dayStartMin: 420, activeMin: 120}, {dayStartMin: 600, activeMin: 300}]), {start: 600, active: 120, explicit: true});
});

test('끼니 창은 시작 시각 기준: 10–19시는 아침이 없고, 08–21시는 세 끼', () => {
  assert.deepEqual(mealWindowsFor(540, 600).map(m => m.name), ['lunch', 'dinner']);
  assert.deepEqual(mealWindowsFor(780, 480).map(m => m.name), ['breakfast', 'lunch', 'dinner']);
  assert.deepEqual(mealWindowsFor(540).map(m => m.name), ['breakfast', 'lunch', 'dinner']);  // 기본 09:00
});

test('validateDay: 활동 시간은 시작 시각부터 센다. 자정을 넘는 시작 시각은 받지 않는다', () => {
  const id = sights[0];
  const base = {date: DATE, place_ids: [id], budget_krw: 150000, step_limit: 20000, krw_per_jpy: '9.5'};
  const late = validateDay({...base, active_min: 300, day_start_min: 780}, dataset, profiles, {allowShopping: true});
  assert.ok(late.items[0].start_min >= 780, `${late.items[0].start_min}`);
  assert.equal(late.totals.elapsed_from_0900_min, late.items[0].end_min - 780);
  assert.throws(() => validateDay({...base, active_min: 300, day_start_min: 1200}, dataset, profiles), /day_start_min/);
});

test('08:00에 나와 21:00에 들어가는 그룹은 아침 창(8–10시) 안에서 시작하고 21시 전에 끝난다', async () => {
  const r = trip([{dayStartMin: 480, activeMin: 780}, {dayStartMin: 480, activeMin: 780}, {dayStartMin: 480, activeMin: 780}]);
  const {candidates} = await calculateRealCandidates(r, dataset, profiles, {baseUrl: ''}, offline);
  for (const c of candidates) {
    const items = c.days[0].items;
    assert.ok(items.every(i => i.startMin >= 480 && i.endMin <= 1260), c.strategy);
    // 8시에 여는 곳이 드물어 9시대 시작이 보통이다. 예전처럼 9시 기준 활동 시간으로 21시 전에 잘리지 않는지가 핵심
    assert.ok(items[0].startMin < 600, `${c.strategy}: 첫 일정 ${items[0].startMin}`);
    assert.ok(items.at(-1).endMin > 1080, `${c.strategy}: 마지막 일정 ${items.at(-1).endMin}`);
    assert.deepEqual(c.planning.meal_fill.windows, ['breakfast', 'lunch', 'dinner']);
  }
});

test('10:00에 나오는 그룹은 아침 식당 없이 10시 이후부터 짠다', async () => {
  const r = trip([{dayStartMin: 600, activeMin: 540}, {dayStartMin: 600, activeMin: 540}, {dayStartMin: 600, activeMin: 540}]);
  const {candidates} = await calculateRealCandidates(r, dataset, profiles, {baseUrl: ''}, offline);
  for (const c of candidates) {
    assert.ok(c.days[0].items.every(i => i.startMin >= 600), c.strategy);
    assert.deepEqual(c.planning.meal_fill.windows, ['lunch', 'dinner']);
  }
});

test('시작 시각이 없는 옛 입력은 예전처럼 09:00에 시작한다', async () => {
  const r = trip([{activeMin: 540}, {activeMin: 540}, {activeMin: 540}]);
  const {candidates} = await calculateRealCandidates(r, dataset, profiles, {baseUrl: ''}, offline);
  for (const c of candidates) assert.ok(c.days[0].items.every(i => i.startMin >= 540), c.strategy);
});

// 11/25 화면 확인: 08–21시 2일 여행에서 비싼 점심(17,034원) 뒤 예산이 모자라 1일차 저녁이 빠졌다.
// 뒤 끼니 예산을 남기고 고르며, 끼니 후보를 끼니마다 따로 뽑아(저녁 영업 식당이 모자라지 않게) 두 날 모두 세 끼를 채운다.
test('예산이 빠듯해도 뒤 끼니 몫을 남겨 두 날 모두 아침·점심·저녁 식당이 들어간다', async () => {
  const submissions = [
    {memberId: 'a', longlist: ['osaka_010', 'osaka_007', 'osaka_008'], picks: ['osaka_007'], musts: ['osaka_007'], vetoes: [],
      budgetPerDay: 70000, stepLimit: 9000, activeMin: 780, dayStartMin: 480, tradeoffs: {pace: 0.5, distance: 0.5, spend: 0.5}},
    {memberId: 'b', longlist: ['osaka_009', 'osaka_015', 'osaka_011', 'osaka_018', 'osaka_003', 'osaka_012'],
      picks: ['osaka_009', 'osaka_015', 'osaka_011', 'osaka_018', 'osaka_003'], musts: [], vetoes: [],
      budgetPerDay: 120000, stepLimit: 18000, activeMin: 780, dayStartMin: 480, tradeoffs: {pace: 0.5, distance: 0.5, spend: 0.5}},
  ];
  const r = {startDate: '2026-11-27', endDate: '2026-11-28', exchange_rate: {krw_per_jpy: '9.5', as_of: '2026-11-25'}, submissions};
  const {candidates} = await calculateRealCandidates(r, dataset, profiles, {baseUrl: ''}, offline);
  const food = new Set(dataset.places.filter(p => p.place.category === '식사').map(p => p.place.place_id));
  for (const c of candidates) for (const d of c.days) {
    for (const [name, [from, to]] of [['아침', [480, 600]], ['점심', [660, 840]], ['저녁', [1020, 1200]]]) {
      assert.ok(d.items.some(i => food.has(i.placeId) && i.startMin >= from && i.startMin < to), `${c.strategy} ${d.date} ${name}`);
    }
  }
});
