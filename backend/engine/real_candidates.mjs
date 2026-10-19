/** Real catalogue → the same shared-candidate contract as the demo, without inventing data. */
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {loadInputs, availability, costKrw, engineCategory, validateDay} from '../../scripts/validate_real_schedule.mjs';
import {buildConsensus} from './consensus.ts';
import {distanceWeightFor, groupTradeoffs, spendCapFor} from './inputs.ts';
import {withPlaceCatalog} from './places.ts';
import {withRouting, routingSummary} from './routing.ts';

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

/** Call the existing strategy implementation separately for each date/strategy.
 * Only picked, date-eligible real places enter its registry, so neither consensus nor scheduling
 * can introduce a demo place or an unreviewed filler. Missing popularity is left missing.
 */
function calculatePrepared(request, dataset, profiles, dates, picked) {
  const byId = new Map(dataset.places.map(r => [r.place.place_id, r]));
  const vetoes = new Set(request.submissions.flatMap(s => s.vetoes ?? (s.veto ? [s.veto] : [])));
  const musts = new Set(request.submissions.flatMap(s => s.musts ?? (s.must ? [s.must] : [])));
  const tradeoffs = groupTradeoffs(request.submissions);
  const limits = {
    budget_krw: spendCapFor(Math.min(...request.submissions.map(s => s.budgetPerDay)), tradeoffs.spend),
    step_limit: Math.min(...request.submissions.map(s => s.stepLimit)),
    active_min: Math.min(...request.submissions.map(s => s.activeMin)),
    krw_per_jpy: request.exchange_rate.krw_per_jpy,
  };
  const validationOptions = {allowShopping: true, candidateMetrics: true, distanceWeight: distanceWeightFor(tradeoffs.distance)};
  const eligibleByDate = dates.map(date => [...picked].filter(id => !vetoes.has(id)).flatMap(id => {
    const record = byId.get(id);
    const check = record && availability(record, date, profiles, {allowShopping: true});
    if (!check?.eligible_for_model) return [];
    const p = record.place;
    return [{id, name: p.name_ko, area: p.area || '', category: engineCategory(p.category),
      lat: p.latitude, lng: p.longitude,
      // Internal budget subtotal only. Shopping purchase spend is excluded, never labelled free.
      cost: check.cost_jpy === null ? 0 : costKrw(check.cost_jpy, limits.krw_per_jpy),
      stayMin: p.stay_min, openFrom: check.window[0], openTo: check.window[1], bagLoad: p.bag_load / 2}];
  }));
  const candidates = STRATEGIES.map(strategy => {
    const scheduled = new Set();
    const days = dates.map((date, index) => {
      const catalogue = eligibleByDate[index].filter(p => !scheduled.has(p.id));
      const consensus = withPlaceCatalog(catalogue, () => buildConsensus({
        submissions: request.submissions, nights: 0, strategy, allowPartial: false,
      }));
      let accepted = [], trial = null;
      for (const selection of consensus.core) {
        const next = validateDay({...limits, date, place_ids: [...accepted, selection.place.id]}, dataset, profiles, validationOptions);
        // Must-places do not bypass date, cost, last-entry, walking or active-time checks.
        if (next.passed_model_checks) {
          trial = next;
          accepted = next.items.map(item => item.place_id);
        }
      }
      accepted.forEach(id => scheduled.add(id));
      return {date, placeIds: accepted, items: (trial?.items ?? []).map(item => ({
        placeId: item.place_id, aiAdded: false, filled: false, source: 'selected',
        reasonCode: 'reviewed_date_and_limits',
        reason: '선택 장소 중 방문일 운영 조건과 일일 한도 검사 통과.'
          + (item.cost_status === 'not_applicable_shopping' ? ' 쇼핑 구매액은 비용 합계에서 제외됩니다.' : ''),
        startMin: item.start_min, endMin: item.end_min,
      })), metrics: {
        walkSteps: trial?.totals.estimated_steps ?? 0,
        costKrw: trial?.totals.selected_admission_and_menu_krw ?? 0,
        totalKm: roundKm(trial?.totals.estimated_total_km ?? 0),
      }};
    });
    if (!scheduled.size) throw Error('NO_SCHEDULABLE_REAL_CANDIDATE');
    const omitted = [...picked].filter(id => !vetoes.has(id) && !scheduled.has(id)).length;
    const missingMust = [...musts].some(id => !scheduled.has(id));
    const emptyDays = days.filter(day => !day.placeIds.length).length;
    const mean = key => days.reduce((total, day) => total + day.metrics[key], 0) / days.length;
    const routes = days.map(day => day.placeIds.map(id => {
      const p = byId.get(id).place; return {lat: p.latitude, lng: p.longitude};
    }));
    return {strategy, days, metrics: {
      walkStepsPerDay: Math.round(mean('walkSteps')), costKrwPerDay: Math.round(mean('costKrw')), totalKmPerDay: roundKm(mean('totalKm')),
    }, explanationSource: 'rules', summary: `${LABELS[strategy]} 전략으로 실제 선택 장소 ${scheduled.size}곳을 배치한 초안입니다.`
      + (omitted ? ` 운영·일일 한도·전략 선택 조건으로 ${omitted}곳은 미배치했습니다.` : '')
      + (missingMust ? ' 꼭 가는 장소 조건이 충족되지 않았습니다.' : '')
      + (emptyDays ? ` 일정이 비어 있는 날짜가 ${emptyDays}일입니다.` : '')
      + ' 비용은 확인된 입장권·대표 메뉴만 포함하며 쇼핑·교통·숙박은 제외합니다. 걸음 수는 장소 사이 이동만 계산한 추정입니다.'
      + ` 환율: 1엔=${request.exchange_rate.krw_per_jpy}원 (${request.exchange_rate.as_of ?? '기준일 미지정'}).`
      + ' 미선택 장소·끼니 자동 추가와 AI 설명은 사용하지 않았습니다.' + routingSummary(routes)};
  });
  return {candidates};
}

export async function calculateRealCandidates(request, dataset, profiles, routingOptions = {}) {
  const dates = datesFor(request);
  const picked = new Set(request.submissions.flatMap(s => s.picks));
  const points = dataset.places.filter(r => picked.has(r.place.place_id))
    .map(r => ({lat: r.place.latitude, lng: r.place.longitude}));
  // One routing snapshot is reused by every strategy so OSRM work is bounded, not tripled.
  return withRouting(points, () => calculatePrepared(request, dataset, profiles, dates, picked), routingOptions);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const request = JSON.parse(fs.readFileSync(0, 'utf8'));
    const {dataset, profiles} = loadInputs();
    process.stdout.write(JSON.stringify(await calculateRealCandidates(request, dataset, profiles)) + '\n');
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
