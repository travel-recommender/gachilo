// P7·P8 공용 결과 흐름 판단 — 늦은 응답 무시, 방장 계산은 버전당 한 번, 규칙 보완을 AI로 표시하지 않음
// 실행: cd web && node --test _test/shared-flow.test.ts  (Node 24 이상)
import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeOf, calcView, createCalculator, hasCandidates, newer } from "../src/lib/shared-flow.ts";
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

test("방장만, 전원 제출 상태에서, 같은 버전에 한 번만 자동 계산한다", async () => {
  const calc = createCalculator();
  const waiting = snap({ status: "awaiting_result", revision: 5, submittedCount: 3 });
  assert.equal(calcView(waiting, false, calc.attempts).auto, false);
  assert.equal(calc.view(snap({ status: "collecting" }), true).auto, false);
  assert.equal(calc.view(snap({ status: "calculating" }), true).auto, false);
  assert.equal(calc.view(waiting, true).auto, true);
  await calc.run(waiting, async () => snap({ status: "awaiting_selection", revision: 5 }));
  assert.equal(calc.view(waiting, true).auto, false);
  // 누가 다시 내서 버전이 오르면 새 버전은 다시 자동 계산한다
  assert.equal(calc.view({ ...waiting, revision: 6 }, true).auto, true);
});

test("요청 중에는 자동 계산도 다시 계산하기도 보이지 않는다", async () => {
  const calc = createCalculator();
  const waiting = snap({ status: "awaiting_result", revision: 2 });
  let release!: (s: ReturnType<typeof snap>) => void;
  const done = calc.run(waiting, () => new Promise((r) => { release = r; }));
  assert.deepEqual(calc.view(waiting, true), { auto: false, retry: false, error: null });
  release(snap({ status: "calculating", revision: 2 }));
  await done;
});

// #40 리뷰 [P2] — 계산 실패 뒤 화면을 옮겨도(훅이 새로 떠도) 다시 계산하기가 남아야 한다
test("계산이 503으로 실패하면 화면을 옮겨 다녀도 같은 버전에 다시 계산하기와 오류가 보인다", async () => {
  const calc = createCalculator();
  let notified = 0;
  const off = calc.subscribe(() => { notified++; });
  const waiting = snap({ status: "awaiting_result", revision: 3 });
  const fail = Object.assign(new Error("계산 서버가 응답하지 않아요."), { status: 503 });
  assert.equal(await calc.run(waiting, () => Promise.reject(fail)), null);
  off();
  // 대기 → 조건 → 대기로 돌아온 새 화면: 같은 계산기에서 같은 버전을 다시 본다 (자동 재호출은 안 한다)
  const remounted = calc.view({ ...waiting }, true);
  assert.deepEqual(remounted, { auto: false, retry: true, error: "계산 서버가 응답하지 않아요." });
  assert.ok(notified >= 2);
  calc.retry(waiting);
  assert.equal(calc.view(waiting, true).auto, true);
});

test("202를 받은 작업이 실패·만료돼 다시 awaiting_result가 되면 다시 계산하기가 보인다", async () => {
  const calc = createCalculator();
  const waiting = snap({ status: "awaiting_result", revision: 7 });
  // 다른 방장 탭의 작업이 진행 중이라 202(calculating)를 받았다
  await calc.run(waiting, async () => snap({ status: "calculating", revision: 7 }));
  assert.deepEqual(calc.view(snap({ status: "calculating", revision: 7 }), true), { auto: false, retry: false, error: null });
  // 그 작업이 실패해 서버가 같은 버전의 awaiting_result로 돌아왔다
  const back = calc.view(snap({ status: "awaiting_result", revision: 7 }), true);
  assert.equal(back.auto, false);
  assert.equal(back.retry, true);
  assert.match(back.error ?? "", /다시 계산/);
});

test("409(그 사이 입력이 바뀜)는 오류로 보이지 않는다", async () => {
  const calc = createCalculator();
  const waiting = snap({ status: "awaiting_result", revision: 4 });
  await calc.run(waiting, () => Promise.reject(Object.assign(new Error("낡은 버전"), { status: 409 })));
  // 다음 조회에서 새 버전이 오면 그 버전은 자동 계산한다
  assert.equal(calc.view({ ...waiting, revision: 5 }, true).auto, true);
  // 참여자 화면에는 계산 관련 표시가 없다
  assert.deepEqual(calc.view(waiting, false), { auto: false, retry: false, error: null });
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
