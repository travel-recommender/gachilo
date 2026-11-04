/**
 * 실험설계_10주차.md 2장 숫자 재현: 꼭 가기 개수·전달 방식에 따라 세 후보가 얼마나 갈리는가.
 * 실제 서비스 엔진(backend/engine/real_candidates.mjs)과 저장소의 150곳 데이터를 그대로 쓴다.
 *
 * 실행 (저장소 루트, Node 24 / Node 22는 --experimental-strip-types):
 *   node scripts/experiment/candidate_diversity.mjs
 *
 * 조건: 4명 · 2026-11-02~11-05(4일) · pace 0.5 · 그룹 200개 · 시드 20261026
 *   - 후보 풀: 4일 중 하루라도 일정 검사를 통과하는 장소 중 무작위 15곳을 그룹이 공유
 *   - 각자 그 15곳에서 1차 목록 6곳, 그중 앞 N곳을 꼭 가기(picks), 첫 곳을 must(1순위)
 *   - 제외: 다른 사람 목록에 있고 내 목록·남의 1순위가 아닌 곳 하나
 *   - "musts 전체"는 같은 입력에서 꼭 가기 N곳을 모두 musts로도 넘긴 경우
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
const ROOT = new URL('../../', import.meta.url);
const {calculateRealCandidates} = await import(new URL('backend/engine/real_candidates.mjs', ROOT).href);
const V = await import(new URL('scripts/validate_real_schedule.mjs', ROOT).href);
const {mockLiveCheck} = await import(new URL('backend/engine/live_check.mjs', ROOT).href);
// 전략 간 차이만 본다: 유료 실시간 확인 대신 모두 통과, AI 채우기는 끈다 (구성원 장소만 비교)
const offline = {liveCheck: mockLiveCheck('pass'), choose: null};
const {dataset, profiles} = V.loadInputs();

const SEED = 20261026, GROUPS = 200, MEMBERS = 4, COMMON = 15, LONGLIST = 6;
const DATES = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
const mul = (s) => { let a = s >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const pool = dataset.places
  .filter(r => DATES.some(d => V.availability(r, d, profiles, {allowShopping: true}).eligible_for_model))
  .map(r => r.place.place_id);
const sig = c => c.days.map(d => d.placeIds.join(',')).join('|');

async function run(nMust, allMusts) {
  const rnd = mul(SEED);
  let differ = 0, mustMiss = 0, placed = 0, ok = 0;
  for (let g = 0; g < GROUPS; g++) {
    const common = [...pool].sort(() => rnd() - 0.5).slice(0, COMMON);
    const subs = Array.from({length: MEMBERS}, (_, k) => {
      const ll = [];
      while (ll.length < LONGLIST) { const p = common[Math.floor(rnd() * common.length)]; if (!ll.includes(p)) ll.push(p); }
      const picks = ll.slice(0, nMust);
      return {memberId: 'm' + k, longlist: ll, picks, must: picks[0], ...(allMusts ? {musts: [...picks]} : {}), veto: null,
        budgetPerDay: 40000 + Math.floor(rnd() * 60000), stepLimit: 7000 + Math.floor(rnd() * 6000),
        activeMin: 360 + Math.floor(rnd() * 180), tradeoffs: {pace: 0.5, distance: 0.5, spend: 0.5}};
    });
    subs.forEach((s, k) => {
      const others = subs.filter((_, j) => j !== k).flatMap(o => o.longlist)
        .filter(id => !s.longlist.includes(id) && !subs.some(o => o.must === id));
      if (others.length) s.veto = others[Math.floor(rnd() * others.length)];
    });
    const r = await calculateRealCandidates({startDate: DATES[0], endDate: DATES.at(-1),
      exchange_rate: {krw_per_jpy: '9.5', as_of: '2026-10-26'}, submissions: subs}, dataset, profiles, {baseUrl: ''}, offline);
    ok++;
    if (new Set(r.candidates.map(sig)).size > 1) differ++;
    if (r.candidates.some(c => /꼭 가는 장소 조건이 충족되지/.test(c.summary))) mustMiss++;
    placed += new Set(r.candidates[0].days.flatMap(d => d.placeIds)).size;
  }
  console.log(`꼭 가기 ${nMust}곳 · ${allMusts ? 'musts 전체' : 'picks + must 1곳'}`.padEnd(28)
    + ` 세 후보가 갈린 그룹 ${differ}/${ok} (${Math.round(differ / ok * 100)}%) · 꼭 가기 미충족 ${mustMiss} · 배치 평균 ${(placed / ok).toFixed(1)}곳`);
}

const dataFile = new URL('data/week5/live_20260923/processed/osaka_places_150_fresh.json', ROOT);
const sha = crypto.createHash('sha256').update(fs.readFileSync(dataFile)).digest('hex').slice(0, 12);
console.log(`데이터 osaka_places_150_fresh.json sha256 ${sha}… · 후보 풀 ${pool.length}곳 · 시드 ${SEED}`);
await run(3, false);
await run(5, false);
await run(5, true);
