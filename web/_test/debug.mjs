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
const D = require("../src/lib/demo.ts");

const MY_LONGLIST = ["glico","kuromon","umeda_sky","nakazaki","ichiran"];
const COMPANIONS = ["m1","m2","m3","m4"];
const DAYS = 4;

const pool = [...MY_LONGLIST];
D.demoLonglists(COMPANIONS).forEach(s => s.longlist.forEach(id => { if(!pool.includes(id)) pool.push(id); }));

const me = { memberId:"me", longlist:MY_LONGLIST, picks:[...MY_LONGLIST],
             must:"umeda_sky", veto:"shinsaibashi", budgetPerDay:75000, stepLimit:8500, activeMin:480 };
const subs = [me, ...D.demoSubmissions(COMPANIONS, pool)].map(s => C.toView(s, DAYS));

const musts = new Set(subs.map(s=>s.must));
const vetos = new Set(subs.map(s=>s.veto).filter(Boolean));
const cand = [...new Set(subs.flatMap(s=>s.picks))].filter(id=>!vetos.has(id) && !musts.has(id));
console.log(`고유 후보 ${new Set(subs.flatMap(s=>s.picks)).size}곳 · 꼭 ${musts.size}곳 · 거부 ${vetos.size}곳 · 경쟁 대상 ${cand.length}곳`);
console.log(`자리(capacity) = 4일 × 4 = 16, 그중 꼭이 ${musts.size}개 차지 → 경쟁 자리 ${16-musts.size}개\n`);

// 전략별 개인 효용과 점수
const strategies = ["average","least_misery","fairness"];
const rows = cand.map(id => {
  const pl = P.PLACE_MAP[id];
  const utils = subs.map(s => C.utilityOf(pl, s));
  return { id, name: pl.name, cost: pl.cost, utils };
});

console.log("장소별 개인 효용 (혜인/윤진/조은/민서/도윤)");
rows.forEach(r => console.log(`  ${r.name.padEnd(22)} ${r.utils.map(u=>u.toFixed(2)).join(" ")}  비용 ${r.cost}`));

console.log("\n전략별 정렬 순서 (앞 12개)");
const orders = {};
for (const st of strategies) {
  const sorted = [...rows].map(r => {
    const u = r.utils;
    const mean = u.reduce((a,b)=>a+b,0)/u.length;
    const sd = Math.sqrt(u.reduce((a,b)=>a+(b-mean)**2,0)/u.length);
    let sc;
    if (st==="average") sc = mean;
    else if (st==="least_misery") sc = Math.min(...u)*0.8 + mean*0.2;
    else sc = mean - 0.7*sd;
    return { ...r, sc };
  }).sort((a,b)=>b.sc-a.sc);
  orders[st] = sorted.map(x=>x.id);
  console.log(`\n  [${st}]`);
  sorted.slice(0,12).forEach((x,i)=>console.log(`    ${String(i+1).padStart(2)}. ${x.name.padEnd(22)} ${x.sc.toFixed(3)}`));
}

console.log("\n순서가 같은가?");
console.log("  average vs fairness:", orders.average.join()===orders.fairness.join() ? "동일" : "다름");
console.log("  average vs least_misery:", orders.average.join()===orders.least_misery.join() ? "동일" : "다름");
