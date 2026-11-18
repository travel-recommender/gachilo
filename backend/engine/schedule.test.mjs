// 끼니 시각·술집 배치 — 아침 9시, 점심 12시, 저녁 18시, 술집 21시 이후.
// 실행: node --test backend/engine/schedule.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSchedule, fmtTime} from './schedule.ts';
import {allPlaces, setCustomPlaces} from './places.ts';

// 서로 가까운 가짜 장소들. 카탈로그 36곳은 모두 제외해 채우기 후보를 이 안으로 한정한다
const at = (i) => ({lat:34.67+i*0.001, lng:135.50});
const place = (id, i, category, stayMin, openFrom=540, openTo=1260, name=id) =>
  ({...at(i), id, name, area:'test', category, cost:0, stayMin, openFrom, openTo, bagLoad:0});
const sel = (p) => ({place:p, votes:1, mustOf:null, tier:'core', participants:[]});

test('식당은 9시·12시·18시에, 술집은 21시 이후에 둔다', (t) => {
  const breakfast = place('cafe-morning', 0, 'food', 40, 480);
  const lunchFill = place('late-diner', 1, 'food', 50, 600, 1320);
  setCustomPlaces([breakfast, lunchFill]); t.after(() => setCustomPlaces([]));
  const vetoed = new Set(allPlaces().map(p => p.id).filter(id => id !== breakfast.id && id !== lunchFill.id));
  const picked = [
    place('museum', 2, 'culture', 120),
    place('ramen', 3, 'food', 40, 600, 1320),
    place('tower', 4, 'landmark', 120),
    place('shop', 5, 'shopping', 90),
    place('izakaya', 6, 'food', 90, 1020, 1440, '도톤보리 이자카야'),
  ];
  const {plans} = buildSchedule(picked.map(sel), 1, {fillMeals:true, vetoed});
  const at_ = Object.fromEntries(plans[0].items.map(it => [it.place.id, fmtTime(it.startMin)]));
  assert.equal(plans[0].items[0].place.id, 'cafe-morning');
  assert.equal(at_['cafe-morning'], '09:00');
  // 오전에 문 여는 식당이 있어도 끼니 시각까지 미룬다
  assert.ok(at_.ramen === '12:00' || at_['late-diner'] === '12:00', JSON.stringify(at_));
  assert.ok(Object.values(at_).includes('18:00'), JSON.stringify(at_));
  assert.equal(at_.izakaya, '21:00');
  const times = plans[0].items.map(it => it.startMin);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

// 먼저 가지 않으면 문 닫는 곳 (#79). 9시 a 다음, 가까운 n과 먼 f(i=20, 약 2.2km) 중 하나를 고르는 상황
test('먼저 가지 않으면 문 닫는 곳을 앞에 두고, 가까운 곳도 그 뒤에 간다 (#79)', () => {
  const a = place('a', 0, 'culture', 30), n = place('n', 1, 'culture', 120), f = place('f', 20, 'culture', 60, 540, 660);
  const {plans, dropped} = buildSchedule([a, n, f].map(sel), 1, {});
  assert.deepEqual(plans[0].items.map(it => it.place.id), ['a', 'f', 'n']);
  assert.equal(dropped.length, 0);
});

test('바꾸면 가까운 곳이 빠지는 경우는 바꾸지 않는다 (#79 리뷰)', () => {
  // n이 12:00에 닫아 f(11:00 닫음) 뒤로는 못 간다 → 원래대로 n을 먼저 두고 f가 빠진다
  const a = place('a', 0, 'culture', 30), n = place('n', 1, 'culture', 120, 540, 720), f = place('f', 20, 'culture', 60, 540, 660);
  const {plans, dropped} = buildSchedule([a, n, f].map(sel), 1, {});
  assert.deepEqual(plans[0].items.map(it => it.place.id), ['a', 'n']);
  assert.deepEqual(dropped.map(d => d.place.id), ['f']);
});

test('앞당긴 곳이 끝날 때 점심 시간이면(남은 식당 있음) 가까운 곳이 식사 뒤로 밀려 빠질 수 있으므로 바꾸지 않는다 (#79 리뷰)', () => {
  // f(120분)를 먼저 가면 11:5x에 끝나 점심(식당 r)이 먼저 오고, 13:30에 닫는 n은 식사 뒤라 못 간다
  const a = place('a', 0, 'culture', 30), n = place('n', 1, 'culture', 60, 540, 810), f = place('f', 20, 'culture', 120, 540, 720);
  const r = place('r', 2, 'food', 60, 600, 1260);
  const {plans} = buildSchedule([a, n, f, r].map(sel), 1, {});
  const ids = plans[0].items.map(it => it.place.id);
  assert.ok(ids.includes('n'), JSON.stringify(ids));
  assert.ok(ids.includes('r'), JSON.stringify(ids));
});

test('가까운 곳이 꼭 가기이고 먼 곳이 아니면 바꾸지 않는다 (#79 리뷰)', () => {
  const a = place('a', 0, 'culture', 30), n = place('n', 1, 'culture', 120), f = place('f', 20, 'culture', 60, 540, 660);
  const {plans} = buildSchedule([sel(a), {...sel(n), mustOf: 'm1'}, sel(f)], 1, {});
  assert.deepEqual(plans[0].items.map(it => it.place.id).slice(0, 2), ['a', 'n']);
});

test('자동 식사 채우기가 켜져 있으면 남은 식당이 없어도 끼니 시간으로 보고 바꾸지 않는다 (#79 재리뷰)', (t) => {
  // 위 경우에서 식당 r 대신 채우기 후보 식당 하나만 둔다. 바꾸면 채운 식당 뒤로 n이 밀려 빠진다
  const filler = place('filler', 3, 'food', 60, 600, 1260);
  setCustomPlaces([filler]); t.after(() => setCustomPlaces([]));
  const vetoed = new Set(allPlaces().map(p => p.id).filter(id => id !== filler.id));
  const a = place('a', 0, 'culture', 30), n = place('n', 1, 'culture', 60, 540, 810), f = place('f', 20, 'culture', 120, 540, 720);
  const {plans, dropped} = buildSchedule([a, n, f].map(sel), 1, {fillMeals: true, vetoed});
  // 바꾸면 a, f, 채운 식당 / n 빠짐(가까운 곳이 빠지고 먼 곳이 남음). 바꾸지 않으면 수정 전과 같이 a, n / f 빠짐
  assert.deepEqual(plans[0].items.map(it => it.place.id), ['a', 'n']);
  assert.deepEqual(dropped.map(d => d.place.id), ['f']);
});
