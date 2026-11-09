// H4 실험 모드 배정 — 일정 A·B·C, 사람마다 순서, 5.3 설명 배정표
// 실행: cd web && node --test _test/experiment.test.ts  (Node 24 이상)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXPLAIN_TABLE, LETTERS, STRATEGY_WORDS, assignment, experimentExplanation, experimentStatusLine, explainedLetters, letterMap, seatOf, strategyOf,
} from "../src/lib/experiment.ts";

const members = ["m1", "m2", "m3", "m4", "m5", "m6", "m7"];

test("5.3 표: 모든 순번이 설명 있음·없음을 둘 다 겪고, 7번째부터 다시 1번", () => {
  for (const row of EXPLAIN_TABLE) {
    assert.ok(row.length >= 1 && row.length <= 2);
  }
  assert.deepEqual(explainedLetters(1), ["A"]);
  assert.deepEqual(explainedLetters(2), ["B", "C"]);
  assert.deepEqual(explainedLetters(6), ["A", "B"]);
  assert.deepEqual(explainedLetters(7), explainedLetters(1));
  // 6명이 돌면 각 일정이 설명 있음으로 3번씩
  for (const l of LETTERS) assert.equal(EXPLAIN_TABLE.filter((r) => r.includes(l)).length, 3);
});

test("글자 배정은 같은 방이면 모두 같고, 세 전략에 겹치지 않게 붙는다", () => {
  const map = letterMap("room-1");
  assert.deepEqual(Object.values(map).sort(), ["A", "B", "C"]);
  assert.deepEqual(letterMap("room-1"), map);
  for (const l of LETTERS) assert.equal(map[strategyOf("room-1", l)!], l);
  assert.equal(strategyOf("room-1", "D"), null);
  assert.equal(strategyOf("room-1", null), null);
  // 같은 그룹 두 사람은 같은 글자 = 같은 전략을 본다
  const a = assignment("room-1", "m1", members)!;
  const b = assignment("room-1", "m2", members)!;
  for (const s of a.slots) assert.equal(b.slots.find((x) => x.letter === s.letter)!.strategy, s.strategy);
});

test("방마다 글자 배정이 달라질 수 있다 (전략이 특정 글자에 고정되지 않음)", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 30; i++) seen.add(JSON.stringify(letterMap(`room-${i}`)));
  assert.ok(seen.size > 1);
});

test("표시 순서는 사람마다 섞이되, 같은 사람은 다시 들어와도 같다", () => {
  const first = assignment("room-1", "m3", members)!;
  assert.deepEqual(assignment("room-1", "m3", members), first);
  assert.deepEqual(first.slots.map((s) => s.order), [1, 2, 3]);
  assert.deepEqual(first.slots.map((s) => s.letter).sort(), ["A", "B", "C"]);
  const orders = new Set(members.map((m) => assignment("room-1", m, members)!.slots.map((s) => s.letter).join("")));
  assert.ok(orders.size > 1);
});

test("설명 배정은 순번(참여자 목록 순서)을 따른다", () => {
  assert.equal(seatOf("m4", members), 4);
  assert.equal(seatOf("nobody", members), null);
  assert.equal(assignment("room-1", "nobody", members), null);
  members.forEach((m, i) => {
    const a = assignment("room-1", m, members)!;
    assert.equal(a.seat, i + 1);
    const on = a.slots.filter((s) => s.explained).map((s) => s.letter).sort();
    assert.deepEqual(on, [...explainedLetters(i + 1)].sort());
    // 누구나 설명 있음과 없음을 둘 다 본다
    assert.ok(a.slots.some((s) => s.explained) && a.slots.some((s) => !s.explained));
  });
});

test("설명 문장은 내 입력과 엔진 결과로만 채우고 전략 이름을 쓰지 않는다", () => {
  const cand = {
    metrics: { walkStepsPerDay: 7650, costKrwPerDay: 63000 },
    days: [
      { items: [{ placeId: "a", source: "selected" }, { placeId: "b", source: "selected" }] },
      { items: [{ placeId: "c", source: "selected" }, { placeId: "m", source: "meal_fill" }] },
    ],
  };
  const mine = { picks: ["a", "b", "c", "d", "e"], must: "d", veto: null, vetoes: ["x"], budgetPerDay: 90000, stepLimit: 9000 };
  const lines = experimentExplanation(cand, mine, (id) => `장소${id}`);
  assert.deepEqual(lines, [
    "내 꼭 가기 5곳 중 3곳이 들어갔어요.",
    "내 1순위 장소d은(는) 이번 일정에 들어가지 못했어요.",
    "내가 제외한 곳은 넣지 않았어요.",
    "하루 예산의 70%, 걸음 한도의 85%를 써요.",
    "아무도 고르지 않은 1곳은 빈 식사 시간 등을 채우려고 규칙에 따라 넣었어요.",
  ]);
  const text = lines.join(" ");
  for (const w of STRATEGY_WORDS) assert.ok(!text.includes(w), w);
});

test("실험 안내 문구에는 방장 확정·전략 이름이 없다", () => {
  for (const status of ["collecting", "awaiting_result", "calculating", "awaiting_selection", "ready"]) {
    const line = experimentStatusLine({ status, submittedCount: 3, memberCount: 3 }, true, true);
    assert.ok(line.length > 0);
    assert.ok(!line.includes("방장") && !line.includes("확정"), line);
    for (const w of STRATEGY_WORDS) assert.ok(!line.includes(w), w);
  }
});
