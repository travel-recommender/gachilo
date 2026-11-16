// satisfactionOf의 weights 인자 — 민감도 분석(scripts/experiment/sensitivity.mjs)이 이 인자로만 가중치를 바꾼다.
// 누가 함수 안을 WEIGHTS.x로 되돌리면 13주 재실행이 기본 가중치로 조용히 채점되므로 막아 둔다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {WEIGHTS, satisfactionOf, toView, stepsToKm} from './consensus.ts';
import {withPlaceCatalog} from './places.ts';

const sub = {memberId: 'm', picks: ['a', 'b', 'c', 'd'], must: 'a', veto: 'z', budgetPerDay: 50000, stepLimit: 10000, activeMin: 480};
const chosen = ['a', 'b'].map(id => ({place: {id}, tier: 'core', participants: [], votes: 0, mustOf: null}));
const score = weights => withPlaceCatalog(['a', 'b', 'c', 'd', 'z'].map(id => ({id})),
  () => satisfactionOf(toView(sub, 2), chosen, 30000 * 2, stepsToKm(8000), weights));

test('weights 인자가 채점에 실제로 쓰인다', () => {
  const only = key => Object.fromEntries(Object.keys(WEIGHTS).map(k => [k, k === key ? 1 : 0]));
  const r = score(only('pick'));
  assert.equal(r.score, r.pickRate);                       // 꼭 가기 4곳 중 2곳 = 0.5
  assert.equal(r.pickRate, 0.5);
  assert.equal(score(only('must')).score, 1);              // 1순위 a 반영
  assert.equal(score(only('veto')).score, 1);              // 제외 z 미포함
  assert.notEqual(score(only('pick')).score, score(only('must')).score);
});

test('인자를 주지 않으면 공유 WEIGHTS로 채점하고, 공유 WEIGHTS는 바뀌지 않는다', () => {
  const before = {...WEIGHTS};
  assert.equal(score(undefined).score, score({...WEIGHTS}).score);
  score({pick: 1, must: 0, budget: 0, walk: 0, veto: 0});
  assert.deepEqual({...WEIGHTS}, before);
});
