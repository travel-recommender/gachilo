// P7·P8 공용 결과 흐름 판단 — 늦은 응답 무시, 방장 계산은 버전당 한 번, 규칙 보완을 AI로 표시하지 않음
// 실행: cd web && node --test _test/shared-flow.test.ts  (Node 24 이상)
import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeOf, calcKey, hasCandidates, newer, shouldCalculate } from "../src/lib/shared-flow.ts";
import type { SharedResults } from "../src/lib/shared-results-api";

const snap = (patch: Partial<SharedResults> = {}): SharedResults => ({
  dataset: "prototype_demo_36", roomId: "r1", status: "collecting", submittedCount: 1, memberCount: 3,
  revision: 1, candidates: [], selectedStrategy: null, selectionVersion: 0, result: null, ...patch,
});

test("입력 버전이 낮은 늦은 응답은 최신 화면을 덮지 않는다", () => {
  const now = snap({ revision: 3, status: "awaiting_selection" });
  assert.equal(newer(now, snap({ revision: 2, status: "ready" })), now);
  const later = snap({ revision: 4 });
  assert.equal(newer(now, later), later);
});

test("같은 입력 버전에서 확정 버전이 낮은 응답은 무시한다", () => {
  const picked = snap({ revision: 3, status: "ready", selectionVersion: 2, selectedStrategy: "fairness" });
  assert.equal(newer(picked, snap({ revision: 3, status: "awaiting_selection", selectionVersion: 1 })), picked);
  // 다른 방 응답은 그대로 받는다 (방을 바꾼 경우)
  const other = snap({ roomId: "r2", revision: 1 });
  assert.equal(newer(picked, other), other);
});

test("방장만, 전원 제출 상태에서, 같은 버전에 한 번만 계산한다", () => {
  const waiting = snap({ status: "awaiting_result", revision: 5, submittedCount: 3 });
  const tried = new Set<string>();
  assert.equal(shouldCalculate(waiting, false, tried), false);
  assert.equal(shouldCalculate(snap({ status: "collecting" }), true, tried), false);
  assert.equal(shouldCalculate(snap({ status: "calculating" }), true, tried), false);
  assert.equal(shouldCalculate(waiting, true, tried), true);
  tried.add(calcKey(waiting));
  assert.equal(shouldCalculate(waiting, true, tried), false);
  // 누가 다시 내서 버전이 오르면 새 버전은 다시 계산한다
  assert.equal(shouldCalculate({ ...waiting, revision: 6 }, true, tried), true);
});

test("후보는 계산이 끝난 뒤(awaiting_selection·ready)에만 보여준다", () => {
  const c = [{ strategy: "average" }] as unknown as SharedResults["candidates"];
  assert.equal(hasCandidates(snap({ status: "calculating", candidates: c })), false);
  assert.equal(hasCandidates(snap({ status: "awaiting_selection", candidates: c })), true);
  assert.equal(hasCandidates(snap({ status: "ready", candidates: c })), true);
  assert.equal(hasCandidates(null), false);
});

test("규칙으로 채운 곳은 'AI 추천'이 아니라 '추천'이다", () => {
  const item = (source: "selected" | "rule_added" | "ai_added" | "meal_fill") =>
    ({ placeId: "x", aiAdded: false, filled: false, source, reasonCode: null, reason: null });
  assert.equal(badgeOf(item("ai_added")), "AI 추천");
  assert.equal(badgeOf(item("rule_added")), "추천");
  assert.equal(badgeOf(item("meal_fill")), "추천");
  assert.equal(badgeOf(item("selected")), null);
});
