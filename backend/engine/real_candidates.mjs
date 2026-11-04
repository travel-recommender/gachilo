/** Real catalogue → the same shared-candidate contract as the demo, without inventing data. */
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {loadInputs, availability, toEnginePlace, validateDay} from '../../scripts/validate_real_schedule.mjs';
import {buildConsensus} from './consensus.ts';
import {distanceWeightFor, groupTradeoffs, slotsPerDayFor, spendCapFor} from './inputs.ts';
import {withPlaceCatalog} from './places.ts';
import {withRouting, routingSummary} from './routing.ts';
import {defaultLiveCheck} from './live_check.mjs';
import {buildPool, choose, REASON_TEXT} from './real_ai.mjs';

const STRATEGIES = ['average', 'least_misery', 'fairness'];
const LABELS = {average: '평균 만족', least_misery: '최소 불만', fairness: '공정성'};
const roundKm = n => Math.round(n * 100) / 100;

function datesFor(request) {
  const dates = [];
  for (let t = Date.parse(request.startDate + 'T00:00:00Z'); t <= Date.parse(request.endDate + 'T00:00:00Z'); t += 86400000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  if (!dates.length || dates.length > 30 || !request.submissions?.length) throw Error('invalid saved trip');
  return dates;
}

const vetoesOf = request => new Set(request.submissions.flatMap(s => s.vetoes ?? (s.veto ? [s.veto] : [])));
const mustsOf = request => new Set(request.submissions.flatMap(s => s.musts ?? (s.must ? [s.must] : [])));
const limitsFor = request => ({
  budget_krw: spendCapFor(Math.min(...request.submissions.map(s => s.budgetPerDay)), groupTradeoffs(request.submissions).spend),
  step_limit: Math.min(...request.submissions.map(s => s.stepLimit)),
  active_min: Math.min(...request.submissions.map(s => s.activeMin)),
  krw_per_jpy: request.exchange_rate.krw_per_jpy,
});
const passed = (live, id, date) => live.verdicts.get(`${id}|${date}`)?.length === 0;

/** Call the existing strategy implementation separately for each date/strategy.
 * Only picked, date-eligible real places enter its registry, so neither consensus nor scheduling
 * can introduce a demo place or an unreviewed filler. Missing popularity is left missing.
 * listed: places someone put in their step-1 list (P3) without marking 꼭 가기. They are tried
 * after the picks to fill empty slots.
 * live: every place-date must pass the live check (live_check.mjs) before it can be placed.
 * ai: places nobody listed (real_ai.mjs), tried last and only for slots the members' places left empty.
 */
function calculatePrepared(request, dataset, profiles, dates, picked, listed = [], live, ai = null) {
  const byId = new Map(dataset.places.map(r => [r.place.place_id, r]));
  const vetoes = vetoesOf(request), musts = mustsOf(request);
  // 각 참여자의 1순위 꼭 가기(거부된 곳은 건너뛰고 다음 순위가 이어받음). inputs.ts의 mustRounds와 같은 규칙이다.
  // pace 자리 수가 이것을 잘라내지 않는다. 운영·예산·걷기·활동시간 검사는 그대로 적용한다.
  const firstMusts = new Set(request.submissions
    .map(s => (s.musts ?? (s.must ? [s.must] : [])).find(id => !vetoes.has(id)))
    .filter(Boolean));
  const tradeoffs = groupTradeoffs(request.submissions);
  // pace 축으로 정한 하루 자리 수. 합의 단계가 아니라 검증을 통과한 장소 수에 적용한다.
  const slots = slotsPerDayFor(tradeoffs.pace);
  const limits = limitsFor(request);
  const validationOptions = {allowShopping: true, candidateMetrics: true, distanceWeight: distanceWeightFor(tradeoffs.distance)};
  const eligibleOn = (ids, date) => ids.filter(id => !vetoes.has(id)).flatMap(id => {
    const record = byId.get(id);
    const check = record && availability(record, date, profiles, {allowShopping: true});
    if (!check?.eligible_for_model || !passed(live, id, date)) return [];
    return [toEnginePlace(record, check, limits.krw_per_jpy)];
  });
  const eligibleByDate = dates.map(date => eligibleOn([...picked, ...listed], date));
  const aiPicks = ai ? [...ai.picks, ...(ai.backup ?? [])] : [];
  const aiById = new Map(aiPicks.map((p, i) => [p.id, {...p, source: i < ai.picks.length ? ai.source : 'rule_added'}]));
  const aiEligibleByDate = dates.map(date => new Set(eligibleOn(aiPicks.map(p => p.id), date).map(p => p.id)));
  const candidates = STRATEGIES.map(strategy => {
    const scheduled = new Set();
    const days = dates.map((date, index) => {
      const catalogue = eligibleByDate[index].filter(p => !scheduled.has(p.id) && picked.has(p.id));
      // 남은 날짜에 고르게 나눈다. 첫날에 자리 수만큼 몰아 넣으면 장소가 적을 때 뒷날이 빈다.
      const remaining = new Set(eligibleByDate.slice(index).flat().map(p => p.id).filter(id => !scheduled.has(id)));
      const share = Math.min(slots, Math.max(1, Math.ceil(remaining.size / (dates.length - index))));
      // 전략에게 그날 후보 전체의 순서를 받는다. 자리 수(slotsPerDay)를 후보 수만큼 열어 두어
      // 앞 순위가 시간·예산 검사에서 떨어져도 다음 순위로 빈자리를 채울 수 있게 한다.
      const consensus = withPlaceCatalog(catalogue, () => buildConsensus({
        submissions: request.submissions, nights: 0, strategy, allowPartial: false,
        slotsPerDay: Math.max(1, catalogue.length),
      }));
      const ranked = [...consensus.core, ...consensus.excluded.filter(s => s.excluded === 'time' || s.excluded === 'budget')]
        .map(s => s.place.id);
      // 꼭 가기는 전략과 무관하게 먼저 시도한다. 검사(운영·예산·걷기·활동시간)는 우회하지 않는다.
      // My list에만 있는 곳은 전략 순위 뒤에, 여러 명이 담은 곳부터 시도한다.
      const fillers = listed.filter(id => !scheduled.has(id) && eligibleByDate[index].some(p => p.id === id));
      const queue = [...ranked.filter(id => musts.has(id)), ...ranked.filter(id => !musts.has(id)), ...fillers];
      let accepted = [], trial = null;
      const tryAdd = id => {
        const next = validateDay({...limits, date, place_ids: [...accepted, id]}, dataset, profiles, validationOptions);
        // Must-places do not bypass date, cost, last-entry, walking or active-time checks.
        if (next.passed_model_checks) {
          trial = next;
          accepted = next.items.map(item => item.place_id);
        }
      };
      // least_misery는 날짜마다 따로 계산하면 어제까지 누가 손해 봤는지 모른다.
      // 그래서 여행 전체(앞 날짜 + 오늘 통과분)에서 찜이 가장 덜 반영된 멤버의 찜을 먼저 시도한다.
      const keptRate = m => m.picks.filter(id => scheduled.has(id) || accepted.includes(id)).length / Math.max(1, m.picks.length);
      // 1) 1순위 꼭 가기는 자리 수와 상관없이 먼저 시도한다 (기존 consensus의 '전원 1순위는 코어' 정책과 같음).
      for (const id of queue.filter(id => firstMusts.has(id))) tryAdd(id);
      queue.splice(0, queue.length, ...queue.filter(id => !firstMusts.has(id)));
      // 2) 나머지는 pace 자리 수와 고르게 나눈 몫(share)까지만 채운다.
      while (queue.length && accepted.length < share) {
        let i = 0;
        if (strategy === 'least_misery' && !musts.has(queue[0])) {
          const rates = request.submissions.map(keptRate);
          const low = Math.min(...rates);
          const worst = request.submissions.filter((_, k) => rates[k] === low);
          i = Math.max(0, queue.findIndex(id => worst.some(m => m.picks.includes(id))));
        }
        tryAdd(queue.splice(i, 1)[0]);
      }
      // 3) 구성원의 장소로 pace 자리를 다 못 채운 날만, 아무도 담지 않은 AI 후보로 남은 자리를 채운다.
      for (const {id} of aiPicks) {
        if (accepted.length >= slots) break;
        if (!scheduled.has(id) && !accepted.includes(id) && aiEligibleByDate[index].has(id)) tryAdd(id);
      }
      accepted.forEach(id => scheduled.add(id));
      return {date, placeIds: accepted, items: (trial?.items ?? []).map(item => {
        const shopping = item.cost_status === 'not_applicable_shopping' ? ' 쇼핑 구매액은 비용 합계에서 제외됩니다.' : '';
        const added = aiById.get(item.place_id);
        if (added && !picked.has(item.place_id) && !listed.includes(item.place_id)) return {
          placeId: item.place_id, aiAdded: true, filled: false, source: added.source, reasonCode: added.reasonCode,
          reason: REASON_TEXT[added.reasonCode] + ' 방문일 운영 조건, 실시간 영업 확인과 일일 한도 검사 통과.' + shopping,
          startMin: item.start_min, endMin: item.end_min,
        };
        return {
          placeId: item.place_id, aiAdded: false, filled: false, source: 'selected',
          reasonCode: picked.has(item.place_id) ? 'reviewed_date_and_limits' : 'listed_reviewed_date_and_limits',
          reason: (picked.has(item.place_id) ? '선택 장소' : '모두가 찾아온 곳')
            + ' 중 방문일 운영 조건, 실시간 영업 확인과 일일 한도 검사 통과.' + shopping,
          startMin: item.start_min, endMin: item.end_min,
        };
      }), metrics: {
        walkSteps: trial?.totals.estimated_steps ?? 0,
        costKrw: trial?.totals.selected_admission_and_menu_krw ?? 0,
        totalKm: roundKm(trial?.totals.estimated_total_km ?? 0),
      }};
    });
    if (!scheduled.size) throw Error('NO_SCHEDULABLE_REAL_CANDIDATE');
    const aiAdded = [...scheduled].filter(id => !picked.has(id) && !listed.includes(id)).length;
    const unplaced = [...picked].filter(id => !vetoes.has(id) && !scheduled.has(id));
    const omitted = unplaced.length;
    const conflicts = [...musts].filter(id => vetoes.has(id)).length;
    const missingMust = [...musts].some(id => !vetoes.has(id) && !scheduled.has(id));
    const emptyDays = days.filter(day => !day.placeIds.length).length;
    // Explain whether each omitted choice could extend the final schedule on any date.
    // Keep only reasons shared across all dates, never private IDs or member conditions.
    const exclusionReasons = {};
    for (const id of unplaced) {
      const attempts = days.map(day => {
        const record = byId.get(id);
        if (!record) return ['unknown_place'];
        const check = availability(record, day.date, profiles, {allowShopping: true});
        if (!check.eligible_for_model) return check.reasons;
        if (!passed(live, id, day.date)) return live.verdicts.get(`${id}|${day.date}`) ?? ['live_lookup_failed'];
        const trial = validateDay({...limits, date: day.date, place_ids: [...day.placeIds, id]}, dataset, profiles, validationOptions);
        return trial.passed_model_checks ? ['strategy_selection_or_capacity'] : [...new Set(trial.violations.map(v => v.code))];
      });
      const common = attempts[0].filter(code => attempts.every(reasons => reasons.includes(code)));
      for (const code of common.length ? common : ['date_conditions_vary']) exclusionReasons[code] = (exclusionReasons[code] ?? 0) + 1;
    }
    const planning = {
      status: omitted || missingMust || conflicts || emptyDays ? 'needs_review' : 'model_checks_passed',
      schedule_ready: false, exchange_rate: request.exchange_rate, catalog_count: dataset.places.length,
      scheduled_count: scheduled.size, unplaced_count: omitted, must_satisfied: !missingMust && !conflicts,
      must_veto_conflict_count: conflicts, empty_day_count: emptyDays,
      reason_aggregation: 'common_across_dates', exclusion_reason_counts: exclusionReasons,
      live_check: {source: live.source, checked_on: live.checked_on, failed_place_count: live.failedPlaces},
      ai_fill: {source: ai ? ai.source : 'off', added_count: aiAdded},
    };
    const mean = key => days.reduce((total, day) => total + day.metrics[key], 0) / days.length;
    const routes = days.map(day => day.placeIds.map(id => {
      const p = byId.get(id).place; return {lat: p.latitude, lng: p.longitude};
    }));
    return {strategy, days, planning, metrics: {
      walkStepsPerDay: Math.round(mean('walkSteps')), costKrwPerDay: Math.round(mean('costKrw')), totalKmPerDay: roundKm(mean('totalKm')),
    }, explanationSource: 'rules', summary: `${LABELS[strategy]} 전략으로 실제 장소 ${scheduled.size}곳을 배치한 초안입니다.`
      + (aiAdded ? ` 그중 ${aiAdded}곳은 아무도 담지 않았지만 그룹의 취향·예산·체력에 맞춰 ${ai.source === 'ai_added' ? 'AI가' : '규칙이'} 추가했습니다.` : '')
      + (omitted ? ` 운영·일일 한도·전략 선택 조건으로 ${omitted}곳은 미배치했습니다.` : '')
      + (conflicts ? ` 꼭 가기와 거부 조건이 충돌한 장소가 ${conflicts}곳 있어 거부 조건을 우선 적용했습니다.` : '')
      + (missingMust ? ' 꼭 가는 장소 조건이 충족되지 않았습니다.' : '')
      + (emptyDays ? ` 일정이 비어 있는 날짜가 ${emptyDays}일입니다.` : '')
      + ' 비용은 확인된 입장권·대표 메뉴만 포함하며 쇼핑·교통·숙박은 제외합니다. 걸음 수는 장소 사이 이동만 계산한 추정입니다.'
      + ` 환율: 1엔=${request.exchange_rate.krw_per_jpy}원 (${request.exchange_rate.as_of ?? '기준일 미지정'}).`
      + ` 모든 장소는 ${live.source === 'google_places' ? `Google 지도 영업 정보(${live.checked_on} 조회)` : '실시간 영업 확인'}로 폐업·휴무·영업시간 변경이 없는지 확인한 뒤 넣었습니다.`
      + (live.failedPlaces ? ` 실시간 확인을 통과하지 못한 ${live.failedPlaces}곳은 넣지 않았습니다.` : '')
      + ' 끼니 자동 추가와 AI 설명 문장은 사용하지 않았습니다.' + routingSummary(routes)};
  });
  return {candidates};
}

/** Live-check request for every reviewed-eligible place-date of the given IDs. */
function liveRequests(ids, dates, byId, profiles) {
  return ids.flatMap(id => dates.flatMap(date => {
    const record = byId.get(id);
    const check = record && availability(record, date, profiles, {allowShopping: true});
    return check?.eligible_for_model ? [{record, date, window: check.window}] : [];
  }));
}

/** deps.liveCheck: (requests) → {verdicts, source, checked_on}; default Google (live_check.mjs).
 * deps.choose: AI chooser (real_ai.mjs); null turns the AI fill off.
 */
export async function calculateRealCandidates(request, dataset, profiles, routingOptions = {}, deps = {}) {
  const liveCheck = deps.liveCheck ?? defaultLiveCheck();
  const chooser = deps.choose === undefined ? choose : deps.choose;
  const dates = datesFor(request);
  const picked = new Set(request.submissions.flatMap(s => s.picks));
  // 각자 1차 목록에 담은 곳. 여러 명이 담은 곳부터 (같으면 처음 담긴 순서)
  const votes = new Map();
  request.submissions.forEach(s => (s.longlist ?? []).forEach(id => { if (!picked.has(id)) votes.set(id, (votes.get(id) ?? 0) + 1); }));
  const listed = [...votes.keys()].sort((a, b) => votes.get(b) - votes.get(a));
  const byId = new Map(dataset.places.map(r => [r.place.place_id, r]));
  const vetoes = vetoesOf(request);
  const human = [...picked, ...listed].filter(id => !vetoes.has(id));
  // 1) 구성원의 장소부터 실시간 확인한다. 확인 결과로 '꼭 가기인데 못 넣는 곳'을 알아야 비슷한 곳을 찾는다
  const live = await liveCheck(liveRequests(human, dates, byId, profiles));
  let ai = null;
  if (chooser) {
    const limits = limitsFor(request);
    const usable = id => dates.some(date => passed(live, id, date) && availability(byId.get(id), date, profiles, {allowShopping: true}).eligible_for_model);
    const missedMusts = [...mustsOf(request)].filter(id => !vetoes.has(id) && byId.has(id) && !usable(id)).map(id => byId.get(id));
    const taken = new Set([...human, ...vetoes]);
    const candidates = dataset.places.filter(r => !taken.has(r.place.place_id)).flatMap(record => {
      const date = dates.find(d => availability(record, d, profiles, {allowShopping: true}).eligible_for_model);
      if (!date) return [];
      return [{record, costKrw: toEnginePlace(record, availability(record, date, profiles, {allowShopping: true}), limits.krw_per_jpy).cost}];
    });
    const draft = buildPool({candidates, submissions: request.submissions, byId, missedMusts, budgetKrw: limits.budget_krw});
    // 2) AI 후보도 실시간 확인을 통과한 곳만 모델에 보여 준다
    const poolLive = await liveCheck(liveRequests(draft.map(c => c.id), dates, byId, profiles));
    poolLive.verdicts.forEach((v, k) => live.verdicts.set(k, v));
    const pool = draft.filter(c => dates.some(date => passed(live, c.id, date)));
    const empty = Math.max(0, dates.length * slotsPerDayFor(groupTradeoffs(request.submissions).pace) - human.filter(id => byId.has(id) && usable(id)).length);
    if (pool.length && empty) ai = await chooser(pool, Math.min(empty, pool.length));
  }
  const failed = new Set([...live.verdicts].filter(([, v]) => v.length).map(([k]) => k.split('|')[0]));
  live.failedPlaces = [...failed].filter(id => ![...live.verdicts].some(([k, v]) => k.startsWith(id + '|') && !v.length)).length;
  const routed = new Set([...picked, ...listed, ...(ai ? [...ai.picks, ...(ai.backup ?? [])].map(p => p.id) : [])]);
  const points = dataset.places.filter(r => routed.has(r.place.place_id))
    .map(r => ({lat: r.place.latitude, lng: r.place.longitude}));
  // One routing snapshot is reused by every strategy so OSRM work is bounded, not tripled.
  return withRouting(points, () => calculatePrepared(request, dataset, profiles, dates, picked, listed, live, ai), routingOptions);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const request = JSON.parse(fs.readFileSync(0, 'utf8'));
    const {dataset, profiles} = loadInputs();
    process.stdout.write(JSON.stringify(await calculateRealCandidates(request, dataset, profiles)) + '\n');
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
