/**
 * 7주차 입력 확장 검사 — 꼭/제외 여러 곳, 트레이드오프, 날짜별 숙소.
 *   node --test inputs.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildConsensus } from "./consensus.ts";
import { buildSchedule } from "./schedule.ts";
import {
  distanceWeightFor, groupTradeoffs, mustRounds, mustsOf, slotsPerDayFor,
  spendCapFor, staysByDay, validateStays, validateSubmissions, vetoesOf,
} from "./inputs.ts";

const sub = (over = {}) => ({
  memberId: "m1", longlist: [], picks: ["glico", "kuromon", "umeda_sky", "nakazaki", "ichiran"],
  budgetPerDay: 75000, stepLimit: 8500, activeMin: 480, ...over,
});

const TRIO = [
  sub({ memberId: "m1", musts: ["umeda_sky", "nakazaki"], vetoes: ["shinsaibashi"] }),
  sub({ memberId: "m2", picks: ["osaka_castle", "kaiyukan", "tempozan", "glico", "rikuro"],
        musts: ["kaiyukan", "tempozan", "rikuro"], vetoes: ["usj"], budgetPerDay: 70000, stepLimit: 7000, activeMin: 360 }),
  sub({ memberId: "m3", picks: ["nakazaki", "amemura", "nmao", "osaka_castle", "kuromon"],
        musts: ["osaka_castle"], budgetPerDay: 100000, stepLimit: 13000, activeMin: 540 }),
];

const run = (subs, opts = {}) =>
  buildConsensus({ submissions: subs, nights: 3, strategy: "fairness", allowPartial: true, ...opts });

/* ── 1. 꼭 가기 · 제외 목록 ── */

test("옛 형식(must/veto 한 개)도 그대로 읽는다", () => {
  const s = sub({ must: "glico", veto: "usj" });
  assert.deepEqual(mustsOf(s), ["glico"]);
  assert.deepEqual(vetoesOf(s), ["usj"]);
});

test("목록 형식을 읽고 중복과 없는 id는 버린다", () => {
  const s = sub({ musts: ["glico", "glico", "없는곳"], vetoes: ["usj", "없는곳2"] });
  assert.deepEqual(mustsOf(s), ["glico"]);
  assert.deepEqual(vetoesOf(s), ["usj"]);
});

test("전원의 1순위가 누군가의 2순위보다 먼저 배치된다", () => {
  const rounds = mustRounds(TRIO, new Set());
  const firstRound = rounds.filter((r) => r.rank === 0).map((r) => r.id);
  const laterRanks = rounds.filter((r) => r.rank > 0).map((r) => r.id);
  assert.deepEqual(firstRound.sort(), ["kaiyukan", "osaka_castle", "umeda_sky"].sort());
  // 2순위 이후는 1순위 전부 뒤에 온다
  const lastFirstIndex = rounds.findLastIndex((r) => r.rank === 0);
  const firstLaterIndex = rounds.findIndex((r) => r.rank > 0);
  assert.ok(lastFirstIndex < firstLaterIndex, "1순위가 모두 앞에 있어야 한다");
  assert.ok(laterRanks.includes("nakazaki") && laterRanks.includes("tempozan"));
});

test("남이 거부한 곳은 내 목록에서 빠지고 다음 순위가 1순위가 된다", () => {
  const rounds = mustRounds(TRIO, new Set(["umeda_sky"]));
  const mine = rounds.filter((r) => r.memberId === "m1");
  assert.equal(mine[0].id, "nakazaki");
  assert.equal(mine[0].rank, 0, "앞이 빠지면 다음 곳이 1순위 자리를 이어받는다");
});

test("자리가 모자라도 전원의 1순위는 코어에 들어간다", () => {
  // 자리를 1곳/일로 줄여 3인 1순위 3곳보다 적게 만든다
  const res = run(TRIO, { nights: 1, slotsPerDay: 1 });
  const coreIds = new Set(res.core.map((s) => s.place.id));
  ["umeda_sky", "kaiyukan", "osaka_castle"].forEach((id) =>
    assert.ok(coreIds.has(id), `1순위 ${id}가 코어에 있어야 한다`));
  assert.ok(res.satisfaction.every((s) => s.mustKept), "전원 원리 2 충족");
});

test("2순위부터는 자리가 없으면 본인만 가는 옵션으로 돌아간다", () => {
  const res = run(TRIO, { nights: 1, slotsPerDay: 1 });
  const option = res.options.find((s) => s.place.id === "tempozan" || s.place.id === "rikuro");
  assert.ok(option, "밀린 '꼭'은 옵션으로 남는다");
  assert.deepEqual(option.participants, ["m2"], "그 사람만 참여자로 남는다");
});

test("꼭 가기를 여러 개 지키면 만족도가 올라간다", () => {
  const one = run(TRIO.map((s) => (s.memberId === "m2" ? { ...s, musts: ["kaiyukan"] } : s)));
  const three = run(TRIO);
  const pick = (r) => r.satisfaction.find((s) => s.memberId === "m2");
  assert.ok(pick(three).mustRate >= pick(one).mustRate - 1e-9);
  assert.equal(pick(one).mustRate, 1);
});

/* ── 2. 트레이드오프 ── */

test("세 축은 성격에 맞게 합친다 (pace·distance는 하한, spend는 평균)", () => {
  const g = groupTradeoffs([
    sub({ memberId: "a", tradeoffs: { pace: 0.2, distance: 0.9, spend: 0.0 } }),
    sub({ memberId: "b", tradeoffs: { pace: 0.8, distance: 0.1, spend: 1.0 } }),
  ]);
  assert.equal(g.pace, 0.2);
  assert.equal(g.distance, 0.1);
  assert.equal(g.spend, 0.5);
});

test("입력이 없으면 가운데 값으로 본다", () => {
  const g = groupTradeoffs([sub({}), sub({ memberId: "b" })]);
  assert.deepEqual(g, { pace: 0.5, distance: 0.5, spend: 0.5 });
});

test("pace가 하루 자리 수를 정한다", () => {
  assert.equal(slotsPerDayFor(0), 2);
  assert.equal(slotsPerDayFor(0.5), 3);
  assert.equal(slotsPerDayFor(1), 4);
});

test("spend가 실제 예산 상한을 정한다", () => {
  assert.equal(spendCapFor(100000, 0), 70000);
  assert.equal(spendCapFor(100000, 1), 100000);
  assert.ok(distanceWeightFor(0) > distanceWeightFor(1));
});

test("여유롭게 고르면 코어가 줄고 빡빡하게 고르면 늘어난다", () => {
  const relaxed = run(TRIO.map((s) => ({ ...s, tradeoffs: { pace: 0.1, distance: 0.1, spend: 0.1 } })));
  const packed = run(TRIO.map((s) => ({ ...s, tradeoffs: { pace: 0.9, distance: 0.9, spend: 0.9 } })));
  assert.ok(relaxed.core.length < packed.core.length, "결과가 실제로 달라져야 한다");
  assert.ok(relaxed.metrics.budgetCap < packed.metrics.budgetCap);
  assert.equal(relaxed.metrics.slotsPerDay, 2);
  assert.equal(packed.metrics.slotsPerDay, 4);
});

test("아끼기로 맞추면 1인 비용이 넉넉하게보다 크지 않다", () => {
  const save = run(TRIO.map((s) => ({ ...s, tradeoffs: { pace: 0.5, distance: 0.5, spend: 0 } })));
  const spend = run(TRIO.map((s) => ({ ...s, tradeoffs: { pace: 0.5, distance: 0.5, spend: 1 } })));
  assert.ok(save.metrics.perPersonCost <= spend.metrics.perPersonCost);
});

/* ── 3. 날짜별 숙소 ── */

const STAYS = [
  { date: "2026-11-01", name: "난바 호텔", lat: 34.6655, lng: 135.5012 },
  { date: "2026-11-02", name: "난바 호텔", lat: 34.6655, lng: 135.5012 },
  { date: "2026-11-03", name: "우메다 호텔", lat: 34.7025, lng: 135.4959 },
  { date: "2026-11-04", name: "우메다 호텔", lat: 34.7025, lng: 135.4959 },
];

test("숙소를 날짜 순서대로 일차에 맞춘다", () => {
  const { byDay, conflicts } = staysByDay(STAYS, "2026-11-01", 4);
  assert.equal(byDay[0].name, "난바 호텔");
  assert.equal(byDay[2].name, "우메다 호텔");
  assert.equal(conflicts.length, 0);
});

test("여행 기간 밖 날짜는 버리고, 숙소 없는 날은 null이다", () => {
  const { byDay } = staysByDay([{ date: "2026-12-25", name: "엉뚱", lat: 34.7, lng: 135.5 }], "2026-11-01", 4);
  assert.deepEqual(byDay, [null, null, null, null]);
});

test("같은 날 숙소가 갈리면 많은 쪽을 쓰고 충돌로 알린다", () => {
  const mixed = [
    { date: "2026-11-01", name: "난바 호텔", lat: 34.6655, lng: 135.5012, memberId: "m1" },
    { date: "2026-11-01", name: "난바 호텔", lat: 34.6655, lng: 135.5012, memberId: "m2" },
    { date: "2026-11-01", name: "우메다 호텔", lat: 34.7025, lng: 135.4959, memberId: "m3" },
  ];
  const { byDay, conflicts } = staysByDay(mixed, "2026-11-01", 2);
  assert.equal(byDay[0].name, "난바 호텔", "2명이 적은 쪽을 기준으로 한다");
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].names.sort(), ["난바 호텔", "우메다 호텔"]);
});

test("숙소를 넣으면 하루 합계에 출발·복귀 거리가 보인다", () => {
  const res = run(TRIO);
  const { byDay } = staysByDay(STAYS, "2026-11-01", 4);
  const withStay = buildSchedule(res.core, 4, { considerBags: true, fillMeals: true, vetoed: new Set(), staysByDay: byDay });
  const withoutStay = buildSchedule(res.core, 4, { considerBags: true, fillMeals: true, vetoed: new Set() });

  const dayWithItems = withStay.plans.find((p) => p.items.length > 0);
  assert.equal(typeof dayWithItems.stayName, "string");
  assert.equal(typeof dayWithItems.stayOutKm, "number");
  assert.equal(typeof dayWithItems.stayBackKm, "number");

  const sum = (plans) => plans.reduce((s, p) => s + p.totalKm, 0);
  assert.ok(sum(withStay.plans) > sum(withoutStay.plans), "숙소 왕복만큼 이동이 늘어야 한다");
  assert.equal(withoutStay.plans[0].stayName, undefined, "숙소가 없으면 필드도 없다");
});

test("숙소는 일정 항목으로 들어가지 않는다", () => {
  const res = run(TRIO);
  const { byDay } = staysByDay(STAYS, "2026-11-01", 4);
  const sch = buildSchedule(res.core, 4, { fillMeals: true, vetoed: new Set(), staysByDay: byDay });
  const ids = sch.plans.flatMap((p) => p.items.map((it) => it.place.id));
  assert.ok(!ids.some((id) => id.startsWith("stay:")), "숙소는 방문 장소가 아니다");
});

/* ── 4. 입력 검증 ── */

test("없는 장소 id를 걸러낸다", () => {
  const issues = validateSubmissions([sub({ musts: ["없는곳"] })]);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /알 수 없는 장소/);
});

test("같은 곳을 꼭 가기와 빼기에 함께 넣으면 잡는다", () => {
  const issues = validateSubmissions([sub({ musts: ["glico"], vetoes: ["glico"] })]);
  assert.ok(issues.some((i) => /함께|같은 장소/.test(i.message)));
});

test("트레이드오프가 0~1 밖이면 잡는다", () => {
  const issues = validateSubmissions([sub({ tradeoffs: { pace: 2, distance: 0.5, spend: -1 } })]);
  assert.equal(issues.length, 2);
});

test("정상 입력은 통과한다", () => {
  assert.deepEqual(validateSubmissions(TRIO), []);
  assert.deepEqual(validateStays(STAYS), []);
});

test("숙소에 좌표가 없으면 잡는다", () => {
  const issues = validateStays([{ date: "2026-11-01", name: "주소만 있음" }]);
  assert.ok(issues.some((i) => /좌표/.test(i.message)));
});

test("숙소 날짜 형식을 잡는다", () => {
  const issues = validateStays([{ date: "11/1", name: "호텔", lat: 34.7, lng: 135.5 }]);
  assert.ok(issues.some((i) => /YYYY-MM-DD/.test(i.message)));
});
