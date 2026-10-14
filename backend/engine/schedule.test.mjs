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
