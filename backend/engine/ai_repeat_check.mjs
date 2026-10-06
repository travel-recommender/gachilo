/**
 * 환각 방지 반복 검사 — 같은 입력을 여러 번, 여러 모델로 돌려 사실 오류를 센다.
 *
 *   SOMSOM_API_KEY=... node ai_repeat_check.mjs
 *   SOMSOM_API_KEY=... RUNS=5 MODELS=gemini-3.5-flash-lite,claude-haiku-4-5-20251001 node ai_repeat_check.mjs
 *
 * 기본값: 3회 · gemini-3.5-flash-lite
 * 결과는 화면에 표로 나오고, ai_runs_<날짜>.json 으로도 저장된다 (PR·논문 첨부용).
 */
import fs from 'node:fs';
import { buildConsensus } from './consensus.ts';
import { buildEvidence, callModel, parsePlan, validatePlan, buildPlanSchedule, validateScheduledPlan, renderSummary } from './ai.ts';

const RUNS = Number(process.env.RUNS ?? 3);
const MODELS = (process.env.MODELS ?? 'gemini-3.5-flash-lite').split(',').map((s) => s.trim()).filter(Boolean);

/** 입력은 고정. 반복 간 차이는 모델의 비결정성에서만 와야 한다 */
const CASES = [
  { name: '3인 3박4일 · 자리 남음', days: 4, subs: [
    { memberId: 'm1', longlist: [], picks: ['glico', 'kuromon', 'umeda_sky', 'nakazaki', 'ichiran'],
      must: 'umeda_sky', veto: 'shinsaibashi', budgetPerDay: 75000, stepLimit: 8500, activeMin: 480 },
    { memberId: 'm2', longlist: [], picks: ['osaka_castle', 'kaiyukan', 'tempozan', 'glico', 'rikuro'],
      must: 'kaiyukan', veto: 'usj', budgetPerDay: 70000, stepLimit: 7000, activeMin: 360 },
    { memberId: 'm3', longlist: [], picks: ['nakazaki', 'amemura', 'nmao', 'osaka_castle', 'kuromon'],
      must: 'osaka_castle', veto: null, budgetPerDay: 100000, stepLimit: 13000, activeMin: 540 },
  ] },
  { name: '2인 1박2일 · 예산 빠듯', days: 2, subs: [
    { memberId: 'm1', longlist: [], picks: ['glico', 'kuromon', 'shinsekai', 'hozenji', 'ichiran'],
      must: 'glico', veto: null, budgetPerDay: 40000, stepLimit: 6000, activeMin: 300 },
    { memberId: 'm2', longlist: [], picks: ['osaka_castle', 'nmao', 'nakazaki', 'glico', 'rikuro'],
      must: 'nmao', veto: 'usj', budgetPerDay: 45000, stepLimit: 9000, activeMin: 420 },
  ] },
];

if (!process.env.SOMSOM_API_KEY) {
  console.error('SOMSOM_API_KEY가 필요합니다. 검사기만 보려면 ai_check.mjs를 쓰세요.');
  process.exit(1);
}

const rows = [];
const log = { ran_at: new Date().toISOString(), runs: RUNS, models: MODELS, cases: [] };

for (const c of CASES) {
  const consensus = buildConsensus({ submissions: c.subs, nights: c.days - 1, strategy: 'fairness', allowPartial: true });
  const ev = buildEvidence(consensus, c.subs, c.days);
  const entry = { case: c.name, ai_slots: ev.ai_slots, candidates: ev.ai_candidates.length, runs: [] };
  console.log(`\n═══ ${c.name} — AI 자리 ${ev.ai_slots} · 후보 ${ev.ai_candidates.length}곳 · 남은 예산 ${ev.group_limits.remaining_budget_won.toLocaleString('ko-KR')}원 ═══`);

  for (const model of MODELS) {
    process.env.SOMSOM_MODEL = model;
    const added = [], codes = [];
    let errorCount = 0;

    for (let i = 1; i <= RUNS; i++) {
      const t0 = Date.now();
      let plan = null, schedule = null, errs = [], failed = null;
      try {
        plan = parsePlan(await callModel(ev));
        errs = validatePlan(plan, ev);
        if (!errs.length) {
          schedule = buildPlanSchedule(plan, consensus, c.subs, c.days).schedule;
          errs = validateScheduledPlan(plan, ev, schedule);
        }
      } catch (e) {
        failed = e.message;
      }
      const ms = Date.now() - t0;
      errorCount += errs.length + (failed ? 1 : 0);
      added.push(plan ? plan.ai_added.map((a) => a.id).sort().join(',') : '-');
      codes.push(plan ? [...plan.summary].sort().join(',') : '-');
      entry.runs.push({ model, run: i, ms, errors: errs, failed,
                        ai_added: plan?.ai_added ?? null, summary_codes: plan?.summary ?? null,
                        rendered: plan && !errs.length && !failed ? renderSummary(plan, ev, schedule) : null });

      console.log(`  [${model} #${i}] ${ms}ms · 사실 오류 ${errs.length}건${failed ? ` · 호출 실패: ${failed}` : ''}`);
      errs.forEach((e) => console.log('      ·', e));
      if (plan && !errs.length && !failed) console.log('      ', renderSummary(plan, ev, schedule));
    }

    rows.push({
      시나리오: c.name, 모델: model, 회차: RUNS, '사실 오류': errorCount,
      '추가 장소 동일': new Set(added).size === 1 ? '예' : '아니오',
      '설명 코드 동일': new Set(codes).size === 1 ? '예' : '아니오',
    });
  }
  log.cases.push(entry);
}

console.log('\n═══ 요약 ═══');
console.table(rows);

const path = `ai_runs_${new Date().toISOString().slice(0, 10)}.json`;
fs.writeFileSync(path, JSON.stringify(log, null, 2));
console.log(`\n상세 결과: ${path}`);

const total = rows.reduce((s, r) => s + r['사실 오류'], 0);
console.log(`사실 오류 합계 ${total}건 — ${total === 0 ? 'PASS' : 'FAIL'}`);
process.exit(total === 0 ? 0 : 1);
