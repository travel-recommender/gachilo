/**
 * AI 연결 점검 (동덕여대 솜솜AI 게이트웨이).
 *   node ai_check.mjs        키 없이 — 근거 JSON과 검사기만 확인
 *   SOMSOM_API_KEY를 환경변수에 넣고 실행하면 같은 입력으로 3회 호출한다 (사실 오류 0건이 목표)
 */
import { buildConsensus } from './consensus.ts';
import assert from 'node:assert/strict';
import { buildEvidence, callModel, parsePlan, validatePlan, buildPlanSchedule, validateScheduledPlan, renderSummary, enrich } from './ai.ts';

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
console.log(`근거 JSON — 확정 ${ev.fixed.length}곳(코어 ${ev.fixed.filter(f => f.tier === 'core').length}) · AI 자리 ${ev.ai_slots} · 후보 ${ev.ai_candidates.length}곳 · 남은 예산 ${ev.group_limits.remaining_budget_won.toLocaleString('ko-KR')}원`);

// 검사기가 거부해야 하는 출력들
const BAD = [
  ['없는 장소', { ai_added: [{ id: 'kyoto_tower', reason_code: 'budget_fits' }], summary: ['must_kept'] }],
  ['자유 문장(없는 장소)', { ai_added: [], summary: ['교토타워를 방문해요.'] }],
  ['자유 문장(지어낸 가격)', { ai_added: [], summary: ['모든 장소의 입장료는 0원이에요.'] }],
  ['근거 없는 설명', { ai_added: [], summary: ['ai_filled'] }],
  ['지어낸 숫자', { ai_added: [], summary: ['1인 72,000원으로 맞췄어요.'] }],
  ['모르는 이유 코드', { ai_added: [{ id: ev.ai_candidates[0]?.id, reason_code: '평점이 높아서' }], summary: ['must_kept'] }],
];
console.log('\n[검사기] 거부해야 하는 출력');
BAD.forEach(([name, out]) => {
  const errs = validatePlan(out, ev);
  assert.ok(errs.length, `${name}: 잘못된 출력을 통과시킴`);
  console.log(`  ${errs.length ? '거부함' : '통과시킴!!'} · ${name}${errs.length ? ' — ' + errs[0] : ''}`);
});

if (!process.env.SOMSOM_API_KEY) {
  console.log('\nSOMSOM_API_KEY가 없어 실제 호출은 건너뜁니다. (서버는 이 상태에서도 규칙 결과로 동작)');
  const off = await enrich(consensus, SUBS, DAYS, '규칙 결과 문장');
  console.log('enrich 결과:', off.ai);
} else {
  for (let i = 1; i <= 3; i++) {
    const t0 = Date.now();
    try {
      const plan = parsePlan(await callModel(ev));
      let errs = validatePlan(plan, ev);
      const schedule = errs.length ? null : buildPlanSchedule(plan, consensus, SUBS, DAYS).schedule;
      if (schedule) errs = validateScheduledPlan(plan, ev, schedule);
      console.log(`\n[run${i}] ${Date.now() - t0}ms · 사실 오류 ${errs.length}건 · 추가 ${plan.ai_added.map((a) => a.id).join(', ') || '없음'}`);
      errs.forEach((e) => console.log('  ·', e));
      if (!errs.length) console.log('  ', renderSummary(plan, ev, schedule));
    } catch (e) {
      console.log(`\n[run${i}] 실패: ${e.message}`);
    }
  }
}
