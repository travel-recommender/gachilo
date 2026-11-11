/**
 * 민감도 분석 — 만족도 가중치 5개와 체류 시간(stay_min)을 ±20% 흔들 때 전략 비교 결론이 유지되는가.
 * 실제 서비스 엔진(backend/engine/real_candidates.mjs)과 실행 중인 카탈로그(data/runtime_catalog.json, 238곳)를 그대로 쓴다.
 *
 * 실행 (저장소 루트, Node 24 / Node 22는 --experimental-strip-types):
 *   node scripts/experiment/sensitivity.mjs                 → docs/sensitivity/results.json, table.csv
 *   node scripts/experiment/sensitivity.mjs --groups 100    → 빠른 확인용 (파일을 쓰지 않음)
 *   node scripts/experiment/sensitivity.mjs --weights '{"pick":0.4,"must":0.25,"budget":0.15,"walk":0.1,"veto":0.1}' --out docs/sensitivity/week13
 *     → 13주에 실험으로 보정한 가중치를 기준으로 같은 분석을 다시 돌린다 (#7·#8).
 *       --weights를 쓰면 --out이 꼭 있어야 한다. 11주 결과(docs/sensitivity/)를 덮어쓰지 않기 위해서다.
 *
 * 가상 그룹 (실험설계_10주차.md 2장 조건과 같게)
 *   4명 · 2026-11-16~19(4일, 검증 기간 11/30 안) · 그룹 1,000개 · 시드 20261111
 *   - 4일 중 하루라도 일정 검사를 통과하는 장소 중 무작위 15곳을 그룹이 공유
 *   - 각자 그 15곳에서 1차 목록 8곳, 앞 5곳이 꼭 가기(picks), 그중 첫 곳이 1순위(must)
 *   - 제외: 다른 사람 목록에 있고 내 목록·남의 1순위가 아닌 곳 하나
 *   - 예산 4~10만 원/일, 걸음 7,000~13,000보, 활동 6~9시간, 성향 축은 모두 0.5
 *   - 실시간 영업 확인은 모두 통과로 두고 AI 채우기는 끈다 (구성원이 고른 장소로만 전략을 비교)
 *
 * 흔드는 값
 *   - 가중치 5개(consensus.ts WEIGHTS): 하나씩 ×0.8 / ×1.2 한 뒤 합이 1이 되게 다시 나눈다.
 *       pick = 꼭 가기(picks 5곳) 반영률, must = 1순위(must 1곳) 반영, budget·walk = 한도 안 활용, veto = 제외 반영
 *     가중치는 만족도 "채점"(satisfactionOf의 weights 인자)에만 쓰이고 엔진(일정 선택)에는 들어가지 않는다.
 *     그래서 가중치 조건은 기준 조건의 일정을 그대로 두고 다시 채점만 한다(schedule_changed = 0).
 *     공유 WEIGHTS는 바꾸지 않는다.
 *   - stay_min: 모든 장소의 체류 시간을 ×0.8 / ×1.2 (반올림, 최소 1분). 일정 자체가 바뀐다.
 *
 * 만족도는 consensus.ts의 satisfactionOf를 그대로 호출한다(찜 반영률·1순위·예산·걸음·제외).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
const ROOT = new URL('../../', import.meta.url);
const {calculateRealCandidates} = await import(new URL('backend/engine/real_candidates.mjs', ROOT).href);
const V = await import(new URL('scripts/validate_real_schedule.mjs', ROOT).href);
const {mockLiveCheck} = await import(new URL('backend/engine/live_check.mjs', ROOT).href);
const C = await import(new URL('backend/engine/consensus.ts', ROOT).href);
const {withPlaceCatalog} = await import(new URL('backend/engine/places.ts', ROOT).href);
const offline = {liveCheck: mockLiveCheck('pass'), choose: null};

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const SEED = 20261111, MEMBERS = 4, COMMON = 15, LONGLIST = 8, PICKS = 5;
const GROUPS = Number(arg('--groups') ?? 1000);
if (!Number.isInteger(GROUPS) || GROUPS < 1) throw Error('--groups는 1 이상의 정수');
// 빠른 확인(--groups)은 파일을 쓰지 않는다. 보정 가중치(--weights)는 --out에만 쓴다
if (arg('--weights') && !arg('--out')) throw Error('--weights를 쓰면 --out <폴더>도 지정하세요 (11주 결과를 덮어쓰지 않도록)');
const OUT_DIR = arg('--out') ?? 'docs/sensitivity';
const WRITE = !arg('--groups') || GROUPS === 1000;
const DATES = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'];
const STRATEGIES = ['average', 'least_misery', 'fairness'];
const KEYS = ['pick', 'must', 'budget', 'walk', 'veto'];
const BASE_WEIGHTS = arg('--weights') ? JSON.parse(arg('--weights')) : {...C.WEIGHTS};
if (KEYS.some(k => typeof BASE_WEIGHTS[k] !== 'number')) throw Error('--weights needs pick, must, budget, walk, veto');

const {dataset: baseDataset, profiles} = V.loadRuntimeInputs();
const manifest = JSON.parse(fs.readFileSync(new URL('data/runtime_catalog.json', ROOT), 'utf8'));
const catalogSha = crypto.createHash('sha256')
  .update(fs.readFileSync(new URL('data/' + manifest.catalog, ROOT))).digest('hex').slice(0, 12);

/** Fisher–Yates. 정렬 함수에 무작위 비교를 넣는 방식은 균등하지 않고 Node 버전마다 결과가 달라진다 */
const shuffle = (xs, rnd) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const mul = s => { let a = s >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

/** 그룹 입력은 조건과 상관없이 한 번만 만든다. 모든 조건이 같은 1,000그룹을 쓴다 */
function makeGroups() {
  const pool = baseDataset.places
    .filter(r => DATES.some(d => V.availability(r, d, profiles, {allowShopping: true}).eligible_for_model))
    .map(r => r.place.place_id);
  const rnd = mul(SEED);
  const groups = [];
  for (let g = 0; g < GROUPS; g++) {
    const common = shuffle(pool, rnd).slice(0, COMMON);
    const subs = Array.from({length: MEMBERS}, (_, k) => {
      const ll = [];
      while (ll.length < LONGLIST) { const p = common[Math.floor(rnd() * common.length)]; if (!ll.includes(p)) ll.push(p); }
      const picks = ll.slice(0, PICKS);
      return {memberId: 'm' + k, longlist: ll, picks, must: picks[0], veto: null,
        budgetPerDay: 40000 + Math.floor(rnd() * 60000), stepLimit: 7000 + Math.floor(rnd() * 6000),
        activeMin: 360 + Math.floor(rnd() * 180), tradeoffs: {pace: 0.5, distance: 0.5, spend: 0.5}};
    });
    subs.forEach((s, k) => {
      const others = subs.filter((_, j) => j !== k).flatMap(o => o.longlist)
        .filter(id => !s.longlist.includes(id) && !subs.some(o => o.must === id));
      if (others.length) s.veto = others[Math.floor(rnd() * others.length)];
    });
    groups.push(subs);
  }
  return {pool: pool.length, groups};
}

const withStay = factor => factor === 1 ? baseDataset : {...baseDataset, places: baseDataset.places.map(r => ({
  ...r, place: {...r.place, stay_min: Math.max(1, Math.round(r.place.stay_min * factor))}}))};

function normalized(key, factor) {
  const w = {...BASE_WEIGHTS};
  if (key) w[key] *= factor;
  const sum = KEYS.reduce((a, k) => a + w[k], 0);
  return Object.fromEntries(KEYS.map(k => [k, w[k] / sum]));
}

/** 일정 하나에 대한 구성원 4명의 만족도 (consensus.ts satisfactionOf, 가중치는 인자로만) */
function scores(candidate, subs, ids, weights) {
  const placed = new Set(candidate.days.flatMap(d => d.placeIds));
  const chosen = [...placed].map(id => ({place: {id}, tier: 'core', participants: [], votes: 0, mustOf: null}));
  return withPlaceCatalog(ids.map(id => ({id})), () => subs.map(s => C.satisfactionOf(
    C.toView(s, DATES.length), chosen, candidate.metrics.costKrwPerDay * DATES.length,
    C.stepsToKm(candidate.metrics.walkStepsPerDay), weights).score));
}

const sig = c => c.days.map(d => d.placeIds.join(',')).join('|');
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = xs => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)); };

/** 체류 시간 배율별 엔진 결과. 가중치 조건은 같은 배율의 결과를 다시 채점만 한다 */
const engineCache = new Map();
async function schedulesFor(stay, groups) {
  if (engineCache.has(stay)) return engineCache.get(stay);
  const dataset = withStay(stay);
  const runs = [];
  for (const subs of groups) {
    const r = await calculateRealCandidates({startDate: DATES[0], endDate: DATES.at(-1),
      exchange_rate: {krw_per_jpy: '9.5', as_of: '2026-11-11'}, submissions: subs}, dataset, profiles, {baseUrl: ''}, offline);
    runs.push(r.candidates);
  }
  const value = {ids: dataset.places.map(r => r.place.place_id), runs};
  engineCache.set(stay, value);
  return value;
}

async function runCondition(cond, groups, baselineSigs) {
  const {ids, runs} = await schedulesFor(cond.stay, groups);
  const per = {average: [], least_misery: [], fairness: []};
  const sigs = [];
  let changed = 0, differ = 0;
  const same = {least_misery: 0, fairness: 0};
  for (let g = 0; g < groups.length; g++) {
    const candidates = runs[g];
    const s = candidates.map(sig).join('#');
    sigs.push(s);
    if (baselineSigs && baselineSigs[g] !== s) changed++;
    if (new Set(candidates.map(sig)).size > 1) differ++;
    const bySt = Object.fromEntries(candidates.map(c => [c.strategy, sig(c)]));
    for (const st of ['least_misery', 'fairness']) if (bySt[st] === bySt.average) same[st]++;
    for (const c of candidates) {
      const sc = scores(c, groups[g], ids, cond.weights);
      per[c.strategy].push({mean: mean(sc), min: Math.min(...sc), gap: Math.max(...sc) - Math.min(...sc),
        placed: new Set(c.days.flatMap(d => d.placeIds)).size});
    }
  }
  const n = groups.length;
  const strategies = Object.fromEntries(STRATEGIES.map(st => [st, {
    mean: mean(per[st].map(x => x.mean)), min: mean(per[st].map(x => x.min)),
    gap: mean(per[st].map(x => x.gap)), placed: mean(per[st].map(x => x.placed))}]));
  // H1: 최저 만족도가 평균 전략보다 높은가 / H2: 만족도 차이가 평균 전략보다 작은가 (그룹별 대응 차이)
  const paired = (st, key, sign) => {
    const d = per[st].map((x, g) => sign * (x[key] - per.average[g][key]));
    const m = mean(d), se = sd(d) / Math.sqrt(n);
    return {diff: m, se, t: se ? m / se : 0, better: d.filter(x => x > 1e-9).length / n, worse: d.filter(x => x < -1e-9).length / n};
  };
  const ranking = key => [...STRATEGIES].sort((a, b) => key === 'gap'
    ? strategies[a].gap - strategies[b].gap : strategies[b][key] - strategies[a][key]);
  return {id: cond.id, label: cond.label, kind: cond.kind, weights: cond.weights, stay: cond.stay,
    groups: n, schedule_changed: baselineSigs ? changed / n : 0,
    // 세 일정 중 하나라도 다른 그룹 (세 일정이 모두 서로 다른 그룹이 아님)
    any_candidate_differs: differ / n,
    same_schedule_as_average: {least_misery: same.least_misery / n, fairness: same.fairness / n},
    strategies,
    h1: {least_misery: paired('least_misery', 'min', 1), fairness: paired('fairness', 'min', 1)},
    h2: {least_misery: paired('least_misery', 'gap', -1), fairness: paired('fairness', 'gap', -1)},
    rank_min: ranking('min'), rank_gap: ranking('gap'), sigs};
}

const conditions = [{id: 'base', label: '기준', kind: 'base', weights: normalized(null, 1), stay: 1}];
for (const k of KEYS) for (const f of [0.8, 1.2]) {
  conditions.push({id: `w_${k}_${f}`, label: `${k} ×${f}`, kind: 'weight', weights: normalized(k, f), stay: 1});
}
for (const f of [0.8, 1.2]) conditions.push({id: `stay_${f}`, label: `stay_min ×${f}`, kind: 'stay', weights: normalized(null, 1), stay: f});

const {pool, groups} = makeGroups();
console.log(`카탈로그 ${baseDataset.places.length}곳 (sha256 ${catalogSha}…) · 후보 풀 ${pool}곳 · 그룹 ${groups.length}개 · 시드 ${SEED}`);
const results = [];
let baseSigs = null;
for (const cond of conditions) {
  const t0 = Date.now();
  const r = await runCondition(cond, groups, baseSigs);
  if (cond.id === 'base') baseSigs = r.sigs;
  delete r.sigs;
  results.push(r);
  const f = x => x.toFixed(3);
  console.log(`${r.label.padEnd(14)} 최저 AVG ${f(r.strategies.average.min)} LM ${f(r.strategies.least_misery.min)} FAIR ${f(r.strategies.fairness.min)}`
    + ` | H1 LM−AVG ${f(r.h1.least_misery.diff)} (t ${r.h1.least_misery.t.toFixed(1)})`
    + ` | H2 AVG−FAIR 차이 ${f(r.h2.fairness.diff)} | 일정 바뀜 ${(r.schedule_changed * 100).toFixed(1)}% · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

if (WRITE) {
  const out = new URL(OUT_DIR.replace(/\/?$/, '/'), ROOT);
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(new URL('results.json', out), JSON.stringify({
    generated_by: 'scripts/experiment/sensitivity.mjs', seed: SEED, groups: GROUPS, members: MEMBERS,
    dates: DATES, picks: PICKS, longlist: LONGLIST, common_pool: COMMON, candidate_pool: pool,
    catalog: manifest.catalog, catalog_count: baseDataset.places.length, catalog_sha256_12: catalogSha,
    base_weights: BASE_WEIGHTS, conditions: results}, null, 2) + '\n');
  const rows = [['condition', 'kind', ...KEYS.map(k => 'w_' + k), 'stay_factor',
    ...STRATEGIES.flatMap(s => [`${s}_mean`, `${s}_min`, `${s}_gap`]),
    'h1_lm_minus_avg', 'h1_lm_t', 'h1_fair_minus_avg', 'h1_fair_t', 'h2_avg_minus_lm_gap', 'h2_avg_minus_fair_gap', 'h2_fair_t',
    'rank_min_not_significant_except_lm_avg', 'rank_gap_not_significant_except_lm_avg', 'schedule_changed', 'any_candidate_differs',
    'lm_same_schedule_as_avg', 'fair_same_schedule_as_avg']];
  for (const r of results) rows.push([r.label, r.kind, ...KEYS.map(k => r.weights[k].toFixed(4)), r.stay,
    ...STRATEGIES.flatMap(s => ['mean', 'min', 'gap'].map(k => r.strategies[s][k].toFixed(4))),
    r.h1.least_misery.diff.toFixed(4), r.h1.least_misery.t.toFixed(2), r.h1.fairness.diff.toFixed(4), r.h1.fairness.t.toFixed(2),
    r.h2.least_misery.diff.toFixed(4), r.h2.fairness.diff.toFixed(4), r.h2.fairness.t.toFixed(2),
    r.rank_min.join('>'), r.rank_gap.join('<'), r.schedule_changed.toFixed(4), r.any_candidate_differs.toFixed(4),
    r.same_schedule_as_average.least_misery.toFixed(4), r.same_schedule_as_average.fairness.toFixed(4)]);
  fs.writeFileSync(new URL('table.csv', out), '﻿' + rows.map(r => r.join(',')).join('\n') + '\n');
  console.log(`저장: ${OUT_DIR}/results.json, ${OUT_DIR}/table.csv`);
}
