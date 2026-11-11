// H4 실험 모드 배정 — 일정 A·B·C, 사람마다 순서, 5.3 설명 배정표
// 실행: cd web && node --test _test/experiment.test.ts  (Node 24 이상)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXPLAIN_TABLE, LETTERS, STRATEGY_WORDS, assignment, experimentExplanation, experimentStatusLine, explainedLetters, groupExplanation, letterMap, seatOf, strategyOf,
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
    "아무도 고르지 않은 1곳은 빈 식사 시간을 채우려고 넣었어요.",
    "내 꼭 가기 5곳 중 3곳이 들어갔어요.",
    "내 1순위 장소d은(는) 이번 일정에 들어가지 못했어요.",
    "내가 제외한 곳은 넣지 않았어요.",
    "하루 예산의 70%, 걸음 한도의 85%를 써요.",
  ]);
  const text = lines.join(" ");
  for (const w of STRATEGY_WORDS) assert.ok(!text.includes(w), w);
});

test("아무도 고르지 않은 곳은 넣은 주체(AI·규칙·식사)대로 설명한다 (#63 이후 실제 장소 방)", () => {
  const withItems = (...sources: string[]) => ({
    metrics: { walkStepsPerDay: 0, costKrwPerDay: 0 },
    days: [{ items: [{ placeId: "a", source: "selected" }, ...sources.map((source, i) => ({ placeId: `x${i}`, source }))] }],
  });
  const fill = (...sources: string[]) => groupExplanation(withItems(...sources))[0];
  assert.equal(fill("ai_added", "meal_fill"),
    "아무도 고르지 않은 곳 중 1곳은 모두의 취향·예산에 맞아 AI가 골라 넣었고, 1곳은 빈 식사 시간을 채우려고 넣었어요.");
  assert.equal(fill("ai_added", "ai_added"), "아무도 고르지 않은 2곳은 모두의 취향·예산에 맞아 AI가 골라 넣었어요.");
  // AI가 꺼져 있거나 검증에 실패하면 rule_added — 식사 채우기라고 말하지 않는다 (#68 리뷰)
  assert.equal(fill("rule_added", "rule_added"), "아무도 고르지 않은 2곳은 모두의 취향·예산에 맞아 규칙에 따라 골라 넣었어요.");
  assert.equal(fill("ai_added", "rule_added", "meal_fill"),
    "아무도 고르지 않은 곳 중 1곳은 모두의 취향·예산에 맞아 AI가 골라 넣었고, 1곳은 모두의 취향·예산에 맞아 규칙에 따라 골라 넣었고, 1곳은 빈 식사 시간을 채우려고 넣었어요.");
  assert.deepEqual(groupExplanation(withItems()), []);
});

const planning = (over = {}) => ({
  must_satisfied: true, unplaced_count: 0, reason_aggregation: "common_across_dates", exclusion_reason_counts: {}, ...over,
});
const realCand = (p: object | null) => ({
  metrics: { walkStepsPerDay: 8000, costKrwPerDay: 50000 },
  days: [{ items: [{ placeId: "a", source: "selected" }, { placeId: "b", source: "selected" }] }],
  planning: p as never,
});

test("5.4 모두에게 같은 설명: 1순위·제외·걸음 한도·못 넣은 이유", () => {
  assert.deepEqual(groupExplanation(realCand(planning()), true), [
    "모두의 1순위 꼭 가기가 모두 들어갔어요.",
    "누군가 제외한 곳은 넣지 않았어요.",
    "하루 걸음 수는 그룹에서 가장 적은 걸음 한도를 넘지 않아요.",
  ]);
  const missed = groupExplanation(realCand(planning({
    must_satisfied: false, unplaced_count: 3,
    exclusion_reason_counts: { closed_on_visit_date: 1, strategy_selection_or_capacity: 1, daily_place_limit: 1, live_no_match: 1 },
  })));
  assert.equal(missed[0], "1순위 꼭 가기 중 일부는 이번 일정에 들어가지 못했어요.");
  // 같은 뜻의 코드는 합치고, 많은 이유부터 쓴다. 모르는 코드는 '그 밖의 운영 조건'으로 묶어 맨 뒤에.
  // 이유별 곳 수는 쓰지 않는다 — 한 곳에 이유가 여럿이면 합이 N(3)보다 커진다(여기선 4) (#71 리뷰)
  assert.equal(missed.at(-1), "꼭 가기로 고른 곳 중 3곳은 넣지 못했어요. 주된 이유: 하루에 갈 수 있는 곳 수가 다 참, 여행 날짜에 모두 휴무, 그 밖의 운영 조건.");
  const overlapping = groupExplanation(realCand(planning({ unplaced_count: 2,
    exclusion_reason_counts: { budget_exceeded: 2, step_limit_exceeded: 1 } }))).at(-1)!;
  assert.equal(overlapping, "꼭 가기로 고른 곳 중 2곳은 넣지 못했어요. 주된 이유: 하루 예산 초과, 하루 걸음 한도 초과.");
  assert.deepEqual(overlapping.match(/\d+곳/g), ["2곳"], "괄호 안 곳 수가 N과 어긋나지 않게 곳 수는 한 번만");
  // 서버가 준 코드 순서가 달라도 같은 문장
  const shuffled = groupExplanation(realCand(planning({ must_satisfied: false, unplaced_count: 3,
    exclusion_reason_counts: { live_no_match: 1, daily_place_limit: 1, closed_on_visit_date: 1, strategy_selection_or_capacity: 1 } })));
  assert.equal(shuffled.at(-1), missed.at(-1));
  // 집계 기준을 모르는 예전 결과는 이유를 붙이지 않는다 (reason_aggregation이 없거나 다름)
  const old = groupExplanation(realCand(planning({ unplaced_count: 2, reason_aggregation: "union", exclusion_reason_counts: { closed_on_visit_date: 2 } })));
  assert.equal(old.at(-1), "꼭 가기로 고른 곳 중 2곳은 넣지 못했어요.");
  const missing = groupExplanation(realCand(planning({ unplaced_count: 2, reason_aggregation: undefined, exclusion_reason_counts: { closed_on_visit_date: 2 } })));
  assert.equal(missing.at(-1), "꼭 가기로 고른 곳 중 2곳은 넣지 못했어요.");
});

test("1순위가 있는지 모르면 '모두의 1순위가 들어갔어요'라고 하지 않는다 (#71 리뷰)", () => {
  // 엔진은 1순위가 하나도 없어도 must_satisfied = true를 준다
  assert.ok(!groupExplanation(realCand(planning())).some((l) => l.includes("1순위")));
  assert.ok(groupExplanation(realCand(planning()), true).includes("모두의 1순위 꼭 가기가 모두 들어갔어요."));
  // 못 들어갔다는 문장은 1순위가 있었다는 뜻이라 늘 쓴다
  assert.equal(groupExplanation(realCand(planning({ must_satisfied: false })))[0], "1순위 꼭 가기 중 일부는 이번 일정에 들어가지 못했어요.");
  const noMust = { picks: [], must: null, veto: null, budgetPerDay: 0, stepLimit: 0 };
  assert.ok(!experimentExplanation(realCand(planning()), noMust, (id) => id).some((l) => l.includes("1순위")));
});

test("내가 제외한 곳이 들어 있는 낡은 결과에서는 그룹 제외 문장을 빼고 내 문장만 쓴다 (#71 리뷰)", () => {
  const mine = { picks: ["a"], must: "a", veto: null, vetoes: ["b"], budgetPerDay: 0, stepLimit: 0 };
  const lines = experimentExplanation(realCand(planning()), mine, (id) => id);
  assert.ok(!lines.includes("누군가 제외한 곳은 넣지 않았어요."));
  assert.ok(lines.includes("내가 제외한 곳 중 일부가 들어 있어요."));
});

test("그룹 설명은 다른 사람의 입력을 드러내지 않고, 데모 방(planning 없음)에는 나오지 않는다", () => {
  const all = groupExplanation(realCand(planning({ must_satisfied: false, unplaced_count: 1, exclusion_reason_counts: { budget_exceeded: 1 } }))).join(" ");
  // 숫자는 장소 수만. 숫자 뒤에 원·보·%가 붙는 개인 조건 수치를 쓰지 않는다
  assert.ok(!/\d[\d,]*\s*(원|보|%)/.test(all), all);
  for (const w of STRATEGY_WORDS) assert.ok(!all.includes(w), w);
  assert.deepEqual(groupExplanation(realCand(null)), []);
  assert.deepEqual(groupExplanation(realCand(undefined as never)), []);
});

test("실제 장소 방: 그룹 설명이 먼저, 내 설명이 뒤. 제외 문장은 반복하지 않는다", () => {
  const mine = { picks: ["a", "c"], must: "a", veto: null, vetoes: ["z"], budgetPerDay: 100000, stepLimit: 10000 };
  const lines = experimentExplanation(realCand(planning()), mine, (id) => id);
  assert.deepEqual(lines, [
    "모두의 1순위 꼭 가기가 모두 들어갔어요.",
    "누군가 제외한 곳은 넣지 않았어요.",
    "하루 걸음 수는 그룹에서 가장 적은 걸음 한도를 넘지 않아요.",
    "내 꼭 가기 2곳 중 1곳이 들어갔어요.",
    "내 1순위 a은(는) 들어갔어요.",
    "하루 예산의 50%, 걸음 한도의 80%를 써요.",
  ]);
});

test("실험 안내 문구에는 방장 확정·전략 이름이 없다", () => {
  for (const status of ["collecting", "awaiting_result", "calculating", "awaiting_selection", "ready"]) {
    const line = experimentStatusLine({ status, submittedCount: 3, memberCount: 3 }, true, true);
    assert.ok(line.length > 0);
    assert.ok(!line.includes("방장") && !line.includes("확정"), line);
    for (const w of STRATEGY_WORDS) assert.ok(!line.includes(w), w);
  }
});
