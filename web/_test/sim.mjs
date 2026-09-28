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
const P = require("../src/lib/places.ts");

function mulberry(seed){let a=seed>>>0;return()=>{a|=0;a=(a+0x6d2b79f5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}

/** 취향 편향을 가진 가상 참여자 생성 */
function makeMember(id, rnd) {
  const cats = ["landmark","food","cafe","shopping","culture","activity","nature"];
  // 선호 카테고리 1~2개
  const fav = [cats[Math.floor(rnd()*cats.length)]];
  if (rnd() < 0.5) fav.push(cats[Math.floor(rnd()*cats.length)]);

  const pool = P.PLACES.filter(p => fav.includes(p.category));
  const others = P.PLACES.filter(p => !fav.includes(p.category));
  const picks = [];
  while (picks.length < 5) {
    const from = rnd() < 0.7 && pool.length ? pool : others;
    const p = from[Math.floor(rnd()*from.length)];
    if (p && !picks.includes(p.id)) picks.push(p.id);
  }
  const veto = rnd() < 0.6 ? P.PLACES[Math.floor(rnd()*P.PLACES.length)].id : null;
  return {
    memberId: id,
    longlist: picks,
    picks,
    must: picks[Math.floor(rnd()*picks.length)],
    veto: picks.includes(veto) ? null : veto,
    budgetPerDay: Math.round((30000 + rnd()*75000)/5000)*5000,
    stepLimit: 6000 + Math.floor(rnd()*7)*1500,
    activeMin: 330 + Math.floor(rnd()*4)*60,
  };
}

const PARTIAL = process.argv[2] !== "nopartial";
const N = 500;
const SIZES = [3,4,5,6];
const strategies = ["average","least_misery","fairness"];
const acc = {};
strategies.forEach(s => acc[s] = { mean:[], min:[], std:[], gini:[], must:[], core:[], opt:[] });
let differ = 0, differFair = 0;
const partialGain = { with:[], without:[] };

const rnd = mulberry(20260914);
for (let i=0;i<N;i++){
  const n = SIZES[Math.floor(rnd()*SIZES.length)];
  const subs = Array.from({length:n},(_,k)=>makeMember("m"+k, rnd));
  const nights = 2 + Math.floor(rnd()*3);

  const cores = {};
  for (const st of strategies){
    const r = C.buildConsensus({ submissions: subs, nights, strategy: st, allowPartial: PARTIAL });
    acc[st].mean.push(r.metrics.mean);
    acc[st].min.push(r.metrics.min);
    acc[st].std.push(r.metrics.std);
    acc[st].gini.push(r.metrics.gini);
    acc[st].must.push(r.metrics.mustKeptRate);
    acc[st].core.push(r.core.length);
    acc[st].opt.push(r.options.length);
    cores[st] = r.core.map(c=>c.place.id).sort().join("|");
  }
  if (new Set(Object.values(cores)).size > 1) differ++;
  if (cores.average !== cores.fairness) differFair++;

  const w = C.buildConsensus({ submissions: subs, nights, strategy:"fairness", allowPartial:true });
  const wo = C.buildConsensus({ submissions: subs, nights, strategy:"fairness", allowPartial:false });
  partialGain.with.push(w.metrics.mean);
  partialGain.without.push(wo.metrics.mean);
}

const avg = a => a.reduce((x,y)=>x+y,0)/a.length;
const fmt = n => n.toFixed(4);

console.log(`가상 그룹 ${N}개 (3~6인, 2~4박) · 부분동행 ${PARTIAL?"허용":"금지"}\n`);
console.log("전략          평균만족  최저만족  편차     지니     꼭반영  코어  옵션");
for (const st of strategies){
  const a = acc[st];
  console.log(`${st.padEnd(13)} ${fmt(avg(a.mean))}  ${fmt(avg(a.min))}  ${fmt(avg(a.std))}  ${fmt(avg(a.gini))}  ${(avg(a.must)*100).toFixed(1)}%  ${avg(a.core).toFixed(1)}  ${avg(a.opt).toFixed(1)}`);
}

console.log(`\n전략에 따라 코어 구성이 달라진 그룹: ${differ}/${N} (${(differ/N*100).toFixed(1)}%)`);
console.log(`  그중 평균 vs 공정성이 다른 경우: ${differFair}/${N} (${(differFair/N*100).toFixed(1)}%)`);

console.log("\n── 가설 검증 ──");
const A = acc.average, F = acc.fairness, L = acc.least_misery;
const winMin = F.min.filter((v,i)=>v > A.min[i]).length;
const tieMin = F.min.filter((v,i)=>Math.abs(v - A.min[i])<1e-9).length;
const winStd = F.std.filter((v,i)=>v < A.std[i]).length;
const tieStd = F.std.filter((v,i)=>Math.abs(v - A.std[i])<1e-9).length;
console.log(`H1 공정성 최저만족 > 평균: ${winMin}건 승 / ${tieMin}건 동일 / ${N-winMin-tieMin}건 패`);
console.log(`   평균값 ${fmt(avg(F.min))} vs ${fmt(avg(A.min))}  (차이 ${fmt(avg(F.min)-avg(A.min))})`);
console.log(`H2 공정성 편차 < 평균:    ${winStd}건 승 / ${tieStd}건 동일 / ${N-winStd-tieStd}건 패`);
console.log(`   평균값 ${fmt(avg(F.std))} vs ${fmt(avg(A.std))}  (차이 ${fmt(avg(F.std)-avg(A.std))})`);
console.log(`   최소불만 최저만족 평균: ${fmt(avg(L.min))}`);
const pw = avg(partialGain.with), pwo = avg(partialGain.without);
const pWin = partialGain.with.filter((v,i)=>v>partialGain.without[i]).length;
console.log(`H3 부분동행 평균만족: ${fmt(pw)} vs ${fmt(pwo)}  (차이 ${fmt(pw-pwo)}, ${pWin}/${N}건에서 개선)`);
