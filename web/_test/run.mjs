import { transform } from "sucrase";
import fs from "node:fs"; import path from "node:path"; import Module from "node:module";
const SRC = path.resolve("./src"); const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) {
  if (r.startsWith("@/")) r = path.join(SRC, r.slice(2));
  for (const c of [r, r+".ts", r+".tsx"]) { try { return orig.call(this,c,...a); } catch {} }
  return orig.call(this, r, ...a);
};
for (const e of [".ts",".tsx"]) Module._extensions[e] = (m,f)=>m._compile(
  transform(fs.readFileSync(f,"utf8"),{transforms:["typescript","imports"]}).code,f);
const require = Module.createRequire(import.meta.url);
const C = require("../src/lib/consensus.ts");
const S = require("../src/lib/schedule.ts");
const P = require("../src/lib/places.ts");
const D = require("../src/lib/demo.ts");
const E = require("../src/lib/explain.ts");

let fail = 0;
const ok = (c,m) => { console.log(`  ${c?"PASS":"FAIL"}  ${m}`); if(!c) fail++; };
const won = n => Math.round(n).toLocaleString("ko-KR")+"원";

// 나의 입력
const MY_LONGLIST = ["glico","kuromon","umeda_sky","nakazaki","ichiran"];
const COMPANIONS = ["m1","m2","m3","m4"];
const NIGHTS = 3, DAYS = 4;

// 1차 — 전원이 검색으로 찾아온 곳을 합쳐 그룹 후보 풀을 만든다
const pool = [...MY_LONGLIST];
D.demoLonglists(COMPANIONS).forEach(s => s.longlist.forEach(id => { if(!pool.includes(id)) pool.push(id); }));

// 2차 — 그 풀에서 각자 5곳·꼭·빼고 싶은 곳을 고른다
const me = { memberId:"me", longlist:MY_LONGLIST, picks:["glico","kuromon","umeda_sky","nakazaki","ichiran"],
             must:"umeda_sky", veto:"shinsaibashi", budgetPerDay:75000, stepLimit:8500, activeMin:480 };
const subs = [me, ...D.demoSubmissions(COMPANIONS, pool)];

console.log("═══ 입력 (5인) ═══");
console.log(`  1차 후보 풀 ${pool.length}곳`);
subs.forEach(s => console.log(`  ${P.findMember(s.memberId).name.padEnd(3)} 하루 예산 ${won(s.budgetPerDay).padStart(8)} · 걷기 ${s.stepLimit.toLocaleString("ko-KR")}보 · 꼭 ${P.PLACE_MAP[s.must]?.name ?? "-"}`));
console.log(`  → 그룹 예산 ${won(Math.min(...subs.map(s=>C.tripBudget(s, DAYS))))} · 그룹 걷기 ${Math.min(...subs.map(s=>s.stepLimit)).toLocaleString("ko-KR")}보`);

console.log("\n═══ 전략별 결과 ═══");
const results = {};
for (const st of ["average","least_misery","fairness"]) {
  const r = C.buildConsensus({ submissions: subs, nights: NIGHTS, strategy: st });
  results[st] = r;
  const m = r.metrics;
  console.log(`\n  [${st}]  코어 ${r.core.length} · 옵션 ${r.options.length} · 제외 ${r.excluded.length}`);
  console.log(`     평균 ${m.mean.toFixed(3)} | 최저 ${m.min.toFixed(3)} | 편차 ${m.std.toFixed(3)} | 지니 ${m.gini.toFixed(3)} | 꼭반영 ${(m.mustKeptRate*100).toFixed(0)}%`);
  console.log("     " + r.satisfaction.map(s=>`${P.findMember(s.memberId).name} ${s.score.toFixed(2)}`).join("  "));
}

const sig = new Set(Object.values(results).map(r => r.core.map(c=>c.place.id).sort().join("|")));
console.log(`\n  전략별 코어 구성이 서로 다른가: ${sig.size > 1 ? "예 (" + sig.size + "종)" : "아니오 — 경쟁이 없음"}`);
ok(sig.size > 1, "전략에 따라 결과가 달라짐 (비교 실험이 성립)");

console.log("\n═══ 가설 점검 ═══");
const avg = results.average.metrics, fair = results.fairness.metrics, lm = results.least_misery.metrics;
ok(fair.min >= avg.min, `H1 공정성 최저만족(${fair.min.toFixed(3)}) ≥ 평균 최저만족(${avg.min.toFixed(3)})`);
ok(fair.std <= avg.std, `H2 공정성 편차(${fair.std.toFixed(3)}) ≤ 평균 편차(${avg.std.toFixed(3)})`);
ok(lm.min >= avg.min, `최소불만 전략도 최저만족 보장(${lm.min.toFixed(3)})`);

console.log("\n═══ 부분 동행 효과 (H3) ═══");
for (const st of ["average","fairness"]) {
  const withP = C.buildConsensus({ submissions: subs, nights: NIGHTS, strategy: st, allowPartial: true });
  const noP   = C.buildConsensus({ submissions: subs, nights: NIGHTS, strategy: st, allowPartial: false });
  console.log(`  [${st}] 부분동행 O 평균 ${withP.metrics.mean.toFixed(3)} / X 평균 ${noP.metrics.mean.toFixed(3)}  (차이 ${(withP.metrics.mean-noP.metrics.mean).toFixed(3)})`);
  ok(withP.metrics.mean >= noP.metrics.mean, `${st}: 부분 동행이 평균 만족도를 낮추지 않음`);
  console.log(`        옵션 ${withP.options.length}곳 / 제외 ${withP.excluded.length}곳 → 부분동행 없으면 제외 ${noP.excluded.length}곳`);
}

console.log("\n═══ 제약 위반 검사 ═══");
const r = results.fairness;
ok(r.metrics.perPersonCost <= Math.min(...subs.map(s=>C.tripBudget(s, DAYS))), `코어 비용 ${won(r.metrics.perPersonCost)} ≤ 그룹 예산`);
const vetoed = new Set(subs.map(s=>s.veto).filter(Boolean));
ok(!r.selections.some(s=>vetoed.has(s.place.id)), "거부된 장소가 일정에 없음");
ok(r.satisfaction.every(s=>s.vetoKept), "전원의 거부가 지켜짐");
const everyoneHasOne = subs.every(s => !s.must || r.selections.some(x => x.place.id===s.must));
ok(everyoneHasOne, "전원의 '꼭'이 일정에 포함됨");

console.log("\n═══ 일정 배치 ═══");
const vetoed2 = new Set(subs.map(s=>s.veto).filter(Boolean));
const { plans, dropped } = S.buildSchedule(r.selections, DAYS, { considerBags: true, fillMeals: true, vetoed: vetoed2 });
plans.forEach(p => {
  console.log(`\n  ${p.day}일차 — ${p.items.length}곳 · 걷기 ${p.walkKm}km · 총이동 ${p.totalKm}km / ${p.totalMoveMin}분 · ${won(p.cost)}`);
  p.items.forEach(it => console.log(`     ${S.fmtTime(it.startMin)}–${S.fmtTime(it.endMin)} ${it.tier==="option"?"[선택]":it.tier==="filled"?"[추가]":"      "} ${it.place.name} (${it.place.area})`));
});
if (dropped.length) console.log(`\n  영업시간이 안 맞아 빠진 곳: ${dropped.map(d=>d.place.name).join(", ")}`);

const groupWalk = Math.min(...subs.map(s=>C.stepsToKm(s.stepLimit)));
ok(plans.every(p => p.items.length>0), "모든 날에 일정이 있음");
ok(plans.every(p => p.items.every(it => it.startMin >= it.place.openFrom && it.endMin <= it.place.openTo)), "영업시간 위반 없음");
console.log(`  하루 최대 도보 ${Math.max(...plans.map(p=>p.walkKm))}km (그룹 한계 ${groupWalk.toFixed(1)}km = ${Math.min(...subs.map(s=>s.stepLimit)).toLocaleString("ko-KR")}보)`);
ok(plans.every(p=>p.walkKm <= groupWalk), "모든 날이 그룹 걷기 한계 이내");

console.log("\n═══ 설명 생성 ═══");
E.explainResult(r, subs, DAYS).forEach(l => console.log("  · " + l));
console.log("  · " + E.explainDay(plans[0], groupWalk));
console.log("  · 특정 장소: " + E.explainPlace(r, "umeda_sky"));
console.log("  · 제외 장소: " + (E.explainPlace(r, "denden") ?? "-"));

console.log(fail ? `\n${fail}건 실패` : "\n전부 통과");
process.exit(fail?1:0);
