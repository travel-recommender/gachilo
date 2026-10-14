// P6 trade off 묶음 — 멀리·알차게 갈수록 '아껴서'에 하한이 생긴다.
// 실행: cd web && node --test _test/tradeoff.test.ts  (Node 24 이상)
import { test } from "node:test";
import assert from "node:assert/strict";
import { moveTrade, spendFloor, toServerTradeoffs } from "../src/lib/tradeoff.ts";

const MID = { pace: 0.5, distance: 0.5, spend: 0.5 };

test("가운데에서는 '아껴서'를 끝까지 내릴 수 있다", () => {
  assert.equal(spendFloor(MID).floor, 0);
  assert.equal(moveTrade(MID, "spend", 0).spend, 0);
});

test("'멀리도' 끝이면 '아껴서'는 절반까지만 내려간다", () => {
  const far = moveTrade({ ...MID, spend: 0 }, "distance", 1);
  assert.equal(far.spend, 0.5);
  assert.equal(moveTrade(far, "spend", 0.1).spend, 0.5);
  assert.match(spendFloor(far).reason ?? "", /멀리 다니면/);
});

test("'알차게'와 '멀리도'가 겹치면 하한이 더 오르되 0.7을 넘지 않는다", () => {
  const both = moveTrade(moveTrade(MID, "pace", 0), "distance", 1);
  assert.equal(spendFloor(both).floor, 0.7);
  assert.equal(both.spend, 0.7);
});

test("서버로 보낼 때 pace만 엔진 방향(1=빡빡)으로 뒤집고 하한을 지킨다", () => {
  assert.deepEqual(toServerTradeoffs({ pace: 0, distance: 1, spend: 0 }), { pace: 1, distance: 1, spend: 0.7 });
  assert.deepEqual(toServerTradeoffs({ pace: 1, distance: 0.2, spend: 0.3 }), { pace: 0, distance: 0.2, spend: 0.3 });
});
