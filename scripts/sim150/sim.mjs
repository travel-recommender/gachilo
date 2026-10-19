/**
 * 7주차 — 150곳 확정 데이터로 시뮬레이션 재실행.
 * 전략 3개가 서로 다른 결과를 내는지 확인하고, 36곳 결과와 비교한다.
 * popularity는 수식에서 빼는 것과 같게 모든 장소에 0.5로 고정한다(코드는 아직 안 건드림).
 */
import fs from 'node:fs';
const ROOT = new URL('../../backend/engine', import.meta.url).href;
const { buildConsensus } = await import(`${ROOT}/consensus.ts`);
const { setCustomPlaces, PLACES: BASE36 } = await import(`${ROOT}/places.ts`);
const raw = JSON.parse(fs.readFileSync(new URL('./places150.json', import.meta.url), 'utf8'));

const mul = (s) => { let a = s >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

const STRATS = ['average', 'least_misery', 'fairness'];
const errors = [];

const places139 = raw.map((o) => ({
  id: o.id, name: o.name, area: o.area || '미상', category: o.category,
  lat: o.lat, lng: o.lng, cost: o.cost ?? 15000, stayMin: o.stayMin,
  openFrom: 9 * 60, openTo: 21 * 60, exposure: 0.6,
  covered: o.covered ?? false, bagLoad: o.bagLoad,
  popularity: 0.5, blurb: '', custom: true,
}));
const places36 = BASE36.map((p) => ({ ...p, popularity: 0.5 }));

function groups(pool, seed, n = 300) {
  const rnd = mul(seed); const out = [];
  for (let g = 0; g < n; g++) {
    const size = 3 + Math.floor(rnd() * 3);
    out.push(Array.from({ length: size }, (_, k) => {
      const picks = [];
      while (picks.length < 5) { const p = pool[Math.floor(rnd() * pool.length)].id; if (!picks.includes(p)) picks.push(p); }
      let veto = null; let guard = 0;
      do { veto = pool[Math.floor(rnd() * pool.length)].id; } while (picks.includes(veto) && ++guard < 20);
      return { memberId: 'm' + k, longlist: [], picks, must: picks[0], veto,
        budgetPerDay: 40000 + Math.floor(rnd() * 60000),
        stepLimit: 7000 + Math.floor(rnd() * 6000),
        activeMin: 360 + Math.floor(rnd() * 180) };
    }));
  }
  return out;
}

function run(label, pool, seed) {
  setCustomPlaces(pool);
  const gs = groups(pool, seed);
  let differ = 0, allThree = 0, empty = 0;
  const agg = Object.fromEntries(STRATS.map((s) => [s, { mean: [], min: [], gini: [], must: [], cost: [] }]));
  const jaccard = [];

  gs.forEach((subs, gi) => {
    const cores = {};
    for (const st of STRATS) {
      let r;
      try { r = buildConsensus({ submissions: subs, nights: 2, strategy: st, allowPartial: true }); }
      catch (e) { errors.push(`[${label}] 그룹${gi} ${st}: ${e.message}`); return; }
      const ids = r.core.map((c) => c.place.id);
      cores[st] = ids.slice().sort().join('|');
      if (!ids.length) empty++;
      const m = r.metrics;
      for (const [k, v] of [['mean', m.mean], ['min', m.min], ['gini', m.gini], ['must', m.mustKeptRate], ['cost', m.perPersonCost]]) {
        if (!Number.isFinite(v)) errors.push(`[${label}] 그룹${gi} ${st}: metrics.${k}=${v}`);
        else agg[st][k].push(v);
      }
    }
    const uniq = new Set(Object.values(cores));
    if (uniq.size > 1) differ++;
    if (uniq.size === 3) allThree++;
    const sets = STRATS.map((s) => new Set((cores[s] || '').split('|')));
    const [A, B] = [sets[0], sets[1]];
    const inter = [...A].filter((x) => B.has(x)).length;
    const uni = new Set([...A, ...B]).size;
    if (uni) jaccard.push(inter / uni);
  });

  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  console.log(`\n■ ${label}  (장소 ${pool.length}곳 · 그룹 300개 · 3~5인 · 각 5곳 찜 + 1곳 거부)`);
  console.log(`  전략별 결과가 갈린 그룹   ${differ}/300  (${(differ / 3).toFixed(1)}%)`);
  console.log(`  셋 다 서로 다른 그룹      ${allThree}/300  (${(allThree / 3).toFixed(1)}%)`);
  console.log(`  average vs least_misery 코어 겹침  ${(avg(jaccard) * 100).toFixed(1)}%`);
  if (empty) console.log(`  코어가 빈 결과            ${empty}건`);
  console.log(`  전략        만족도평균  최저멤버  지니   꼭지킴  1인비용`);
  for (const st of STRATS) {
    const a = agg[st];
    console.log(`  ${st.padEnd(13)} ${avg(a.mean).toFixed(3)}    ${avg(a.min).toFixed(3)}   ${avg(a.gini).toFixed(3)}  ${(avg(a.must) * 100).toFixed(0)}%   ${Math.round(avg(a.cost)).toLocaleString()}원`);
  }
  return { differ, allThree };
}

console.log('='.repeat(66));
console.log('7주차 시뮬레이션 — 확정 150곳 데이터 (사용 가능 139곳)');
console.log('='.repeat(66));
const r36 = run('36곳 (기존 프로토타입)', places36, 20261014);
const r139 = run('139곳 (확정 데이터)', places139, 20261014);

console.log(`\n${'─'.repeat(66)}`);
console.log(`전략이 갈리는 비율:  36곳 ${(r36.differ / 3).toFixed(1)}%  →  139곳 ${(r139.differ / 3).toFixed(1)}%`);
console.log(`에러·비정상 지표: ${errors.length}건`);
errors.slice(0, 10).forEach((e) => console.log('  ' + e));
