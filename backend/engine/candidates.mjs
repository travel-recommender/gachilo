/** Shared P7/P8 projection. Never publish member inputs or per-member scores. */
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {buildConsensus, kmToSteps} from './consensus.ts';
import {buildSchedule} from './schedule.ts';
import {setMembers} from './places.ts';

export const STRATEGIES = ['average', 'least_misery', 'fairness'];
const round = n => Math.round(n * 100) / 100;
const labels = {average:'평균', least_misery:'최소 불만', fairness:'공정성'};
const reasonText = {
  budget_fits: '남은 예산 범위에서 추가한 장소입니다.',
  no_one_dislikes: '구성원 모두의 입력 조건을 바탕으로 추가한 장소입니다.',
  category_gap: '부족한 활동 유형을 보완한 장소입니다.',
  near_fixed: '같은 날의 공통 선택 장소와 가까운 장소입니다.',
};

function ruleResult(consensus, submissions, days, summary) {
  const vetoed = new Set(submissions.map(s => s.veto).filter(Boolean));
  return {core: consensus.core, schedule: buildSchedule(consensus.core, days,
    {considerBags:true, fillMeals:true, vetoed}), summary,
    ai:{used:false, added:[], basis:[]}};
}

export async function calculateCandidates(request, enrich) {
  setMembers(request.members);
  const start = Date.parse(request.startDate+'T00:00:00Z');
  const days = Math.round((Date.parse(request.endDate+'T00:00:00Z')-start)/86400000)+1;
  if (!Number.isInteger(days) || days < 1 || days > 30) throw Error('invalid dates');
  const candidates = [];
  // Sequential strategies keep each optional model call bounded and avoid a burst.
  for (const strategy of STRATEGIES) {
    const consensus = buildConsensus({submissions:request.submissions, nights:days-1,
      strategy, allowPartial:true});
    const fallback = `${labels[strategy]} 전략의 시연용 후보입니다. 비용·이동은 추정이며 모든 개인 제약의 충족을 보장하지 않습니다.`;
    let enriched;
    try { enriched = enrich ? await enrich(consensus, request.submissions, days, fallback) : null; }
    catch { /* An explanation failure must not remove the rule candidates. */ }
    enriched ??= ruleResult(consensus, request.submissions, days, fallback);
    const selected = new Map(enriched.core.map(s => [s.place.id, s]));
    const modelAdded = new Set(enriched.ai.added);
    const basis = new Map(enriched.ai.basis.map(b => [b.id, b.reason_code]));
    const projected = enriched.schedule.plans.map((plan, i) => {
      const items = plan.items.map(item => {
        const id = item.place.id;
        const filled = item.tier === 'filled';
        const aiAdded = !filled && Boolean(selected.get(id)?.aiAdded || modelAdded.has(id));
        const source = filled ? 'meal_fill' : modelAdded.has(id) ? 'ai_added' : aiAdded ? 'rule_added' : 'selected';
        const code = filled ? 'meal_slot' : source === 'ai_added' ? basis.get(id) : aiAdded ? 'rule_fill' : null;
        const reason = filled ? '일정의 빈 식사 시간에 규칙으로 추가한 장소입니다.'
          : source === 'ai_added' ? (Object.hasOwn(reasonText, code) ? reasonText[code] : '검증된 AI 제안으로 추가한 장소입니다.')
          : aiAdded ? '선택 장소 이후 남은 자리를 규칙으로 보완한 장소입니다.' : null;
        return {placeId:id, aiAdded, filled, source, reasonCode:code ?? null, reason};
      });
      return {date:new Date(start+i*86400000).toISOString().slice(0,10),
        placeIds:items.map(x => x.placeId), items,
        metrics:{walkSteps:kmToSteps(plan.walkKm), costKrw:Math.round(plan.cost),
          totalKm:round(plan.totalKm)}};
    });
    const mean = key => projected.reduce((sum, d) => sum+d.metrics[key], 0)/days;
    candidates.push({strategy,
      metrics:{walkStepsPerDay:Math.round(mean('walkSteps')),
        costKrwPerDay:Math.round(mean('costKrw')), totalKmPerDay:round(mean('totalKm'))},
      days:projected, summary:enriched.summary,
      explanationSource:enriched.ai.used ? 'ai' : 'rules'});
  }
  return {candidates};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const request = JSON.parse(fs.readFileSync(0, 'utf8'));
  // #37 is optional until merged. No key means no external request even if installed.
  const moduleUrl = new URL('./ai.ts', import.meta.url);
  const enrich = fs.existsSync(moduleUrl) ? (await import(moduleUrl.href)).enrich : undefined;
  process.stdout.write(JSON.stringify(await calculateCandidates(request, enrich)));
}
