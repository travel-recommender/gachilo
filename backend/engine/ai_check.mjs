/**
 * AI 연결 점검 (동덕여대 솜솜AI 게이트웨이).
 *   node ai_check.mjs   키 없이 — 근거 JSON과 검사기만 확인
 *   SOMSOM_API_KEY를 환경변수에 넣고 실행하면 같은 입력으로 3회 호출한다 (사실 오류 0건이 목표)
 * Node 22에서는 앞에 --experimental-strip-types 를 붙인다. Node 24는 그냥 실행된다.
 */
import { buildConsensus } from './consensus.ts';
import { buildEvidence, callModel, parsePlan, validatePlan, render, enrich } from './ai.ts';

const DAYS = 4;
const SUBS = [
  { memberId: 'm1', longlist: [], picks: ['glico', 'kuromon', 'umeda_sky', 'nakazaki', 'ichiran'],
    must: 'umeda_sky', veto: 'shinsaibashi', budgetPerDay: 75000, stepLimit: 8500, activeMin: 480 },
  { memberId: 'm2', longlist: [], picks: ['osaka_castle', 'kaiyukan', 'tempozan', 'glico', 'rikuro'],
    must: 'kaiyukan', veto: 'usj', budgetPerDay: 70000, stepLimit: 7000, activeMin: 360 },
  { memberId: 'm3', longlist: [], picks: ['nakazaki', 'amemura', 'nmao', 'osaka_castle', 'kuromon'],
    must: 'osaka_castle', veto: null, budgetPerDay: 100000, stepLimit: 13000, activeMin: 540 },
];

const consensus = buildConsensus({ submissions: SUBS, nights: DAYS - 1, strategy: 'fairness', allowPartial: true });
const ev = buildEvidence(consensus, SUBS, DAYS);
console.log(`근거 JSON — 확정 ${ev.fixed.length}곳 · AI 자리 ${ev.ai_slots} · 후보 ${ev.ai_candidates.length}곳 · 남은 예산 ${ev.group_limits.remaining_budget_won.toLocaleString('ko-KR')}원 · ${JSON.stringify(ev).length}자`);

// 검사기 확인 — 일부러 틀린 출력
const bad = { ai_added: [{ id: 'kyoto_tower', reason: '교토타워는 평점이 높아요.' }],
              summary: ['1인 72,000원으로 맞췄고 미도스지선으로 이동해요.', '가장 빠듯한 분에게 맞췄어요.'] };
console.log('\n[검사기] 일부러 틀린 출력에서 잡아낸 것:');
validatePlan(bad, ev).forEach((e) => console.log('  ·', e));

if (!process.env.SOMSOM_API_KEY) {
  console.log('\nSOMSOM_API_KEY가 없어 실제 호출은 건너뜁니다. (서버는 이 상태에서도 규칙 결과로 동작)');
  const off = await enrich(consensus, SUBS, DAYS, '규칙 결과 문장');
  console.log('enrich 결과:', off.ai, '| summary:', off.summary);
} else {
  for (let i = 1; i <= 3; i++) {
    const t0 = Date.now();
    try {
      const plan = parsePlan(await callModel(ev));
      const errs = validatePlan(plan, ev);
      console.log(`\n[run${i}] ${Date.now() - t0}ms · 사실 오류 ${errs.length}건 · 추가 ${plan.ai_added.map((a) => a.id).join(', ') || '없음'}`);
      errs.forEach((e) => console.log('  ·', e));
      plan.summary.forEach((s) => console.log('  ', render(s)));
      plan.ai_added.forEach((a) => console.log('  +', a.id, render(a.reason)));
    } catch (e) {
      console.log(`\n[run${i}] 실패: ${e.message}`);
    }
  }
}
