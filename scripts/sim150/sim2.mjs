/** 전략이 갈린 그룹만 골라서 '같은 그룹 안에서' 전략끼리 짝지어 비교한다. */
import fs from 'node:fs';
const ROOT = new URL('../../backend/engine', import.meta.url).href;
const { buildConsensus } = await import(`${ROOT}/consensus.ts`);
const { setCustomPlaces } = await import(`${ROOT}/places.ts`);
const raw = JSON.parse(fs.readFileSync(new URL('./places150.json', import.meta.url), 'utf8'));
const mul = (s) => { let a = s >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

setCustomPlaces(raw.map((o) => ({ id:o.id, name:o.name, area:o.area||'미상', category:o.category,
  lat:o.lat, lng:o.lng, cost:o.cost??15000, stayMin:o.stayMin, openFrom:540, openTo:1260,
  exposure:0.6, covered:o.covered??false, bagLoad:o.bagLoad, popularity:0.5, blurb:'', custom:true })));

const rnd = mul(20261014);
const STRATS = ['average','least_misery','fairness'];
const diffs = { min: [], mean: [], gini: [] };   // 갈린 그룹에서의 짝비교
let n = 0, wins = { least_misery_min: 0, fairness_gini: 0, average_mean: 0 };

for (let g = 0; g < 300; g++) {
  const size = 3 + Math.floor(rnd() * 3);
  const subs = Array.from({ length: size }, (_, k) => {
    const picks = []; while (picks.length < 5) { const p = raw[Math.floor(rnd()*raw.length)].id; if (!picks.includes(p)) picks.push(p); }
    let veto = null, guard = 0;
    do { veto = raw[Math.floor(rnd()*raw.length)].id; } while (picks.includes(veto) && ++guard < 20);
    return { memberId:'m'+k, longlist:[], picks, must:picks[0], veto,
      budgetPerDay:40000+Math.floor(rnd()*60000), stepLimit:7000+Math.floor(rnd()*6000), activeMin:360+Math.floor(rnd()*180) };
  });
  const res = {};
  for (const st of STRATS) res[st] = buildConsensus({ submissions: subs, nights: 2, strategy: st, allowPartial: true });
  const key = (r) => r.core.map(c=>c.place.id).sort().join('|');
  if (new Set(STRATS.map(st=>key(res[st]))).size === 1) continue;   // 안 갈린 그룹은 제외
  n++;
  diffs.min.push(res.least_misery.metrics.min - res.average.metrics.min);
  diffs.mean.push(res.average.metrics.mean - res.least_misery.metrics.mean);
  diffs.gini.push(res.average.metrics.gini - res.fairness.metrics.gini);
  if (res.least_misery.metrics.min > res.average.metrics.min) wins.least_misery_min++;
  if (res.fairness.metrics.gini < res.average.metrics.gini) wins.fairness_gini++;
  if (res.average.metrics.mean > res.least_misery.metrics.mean) wins.average_mean++;
}

const stat = (xs) => {
  const m = xs.reduce((a,b)=>a+b,0)/xs.length;
  const sd = Math.sqrt(xs.reduce((a,b)=>a+(b-m)**2,0)/xs.length);
  const t = m / (sd / Math.sqrt(xs.length));
  return { m, sd, t };
};
console.log(`전략이 갈린 그룹 ${n}개만 대상으로 '같은 그룹 안에서' 짝지어 비교\n`);
console.log('가설                                        평균차이    t      이긴 비율');
console.log('─'.repeat(72));
const rows = [
  ['least_misery가 최저멤버 만족도를 올리나', diffs.min, wins.least_misery_min],
  ['average가 전체 평균을 올리나',            diffs.mean, wins.average_mean],
  ['fairness가 불평등(지니)을 낮추나',        diffs.gini, wins.fairness_gini],
];
for (const [label, xs, w] of rows) {
  const s = stat(xs);
  console.log(` ${label.padEnd(40)} ${s.m>=0?'+':''}${s.m.toFixed(4)}  ${s.t.toFixed(2).padStart(6)}   ${w}/${n} (${(100*w/n).toFixed(0)}%)`);
}
console.log('\n※ t 절댓값이 2 넘으면 "우연이라고 보기 어렵다" 쪽');
