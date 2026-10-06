/** Actual catalogue adapter: selected IDs only, no popularity or automatic fillers. */
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {loadInputs, availability, validateDay} from '../../scripts/validate_real_schedule.mjs';

export function calculateReal(request, dataset, profiles) {
  const submissions = request.submissions;
  const dates = [];
  for (let t = Date.parse(request.startDate + 'T00:00:00Z'); t <= Date.parse(request.endDate + 'T00:00:00Z'); t += 86400000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  if (!dates.length || dates.length > 30 || !submissions?.length) throw Error('invalid saved trip');
  const limits = {
    budget_krw: Math.min(...submissions.map(s => s.budgetPerDay)),
    step_limit: Math.min(...submissions.map(s => s.stepLimit)),
    active_min: Math.min(...submissions.map(s => s.activeMin)),
    krw_per_jpy: request.exchange_rate.krw_per_jpy,
  };
  const vetoed = new Set(submissions.map(s => s.veto).filter(Boolean));
  const must = new Set(submissions.map(s => s.must).filter(Boolean));
  const picked = [...new Set(submissions.flatMap(s => s.picks))];
  const candidates = picked.filter(id => !vetoed.has(id));
  const votes = id => submissions.filter(s => s.picks.includes(id)).length;
  candidates.sort((a, b) => Number(must.has(b)) - Number(must.has(a)) || votes(b) - votes(a) || a.localeCompare(b));
  const byId = new Map(dataset.places.map(r => [r.place.place_id, r]));
  const days = dates.map(date => ({date, placeIds: []}));
  const details = new Map(), failures = [];
  for (const id of candidates) {
    const record = byId.get(id);
    const attempts = [];
    let chosen = null;
    // Try every visit day; keep the valid day with the lowest elapsed time.
    for (const day of days) {
      const check = record ? availability(record, day.date, profiles, {allowShopping: true}) : {reasons: ['unknown_place_id']};
      if (check.reasons.length) { attempts.push(new Set(check.reasons)); continue; }
      if (day.placeIds.length >= 30) { attempts.push(new Set(['daily_place_limit'])); continue; }
      const trial = validateDay({...limits, date: day.date, place_ids: [...day.placeIds, id]}, dataset, profiles, {allowShopping: true});
      if (!trial.passed_model_checks) { attempts.push(new Set(trial.violations.map(v => v.code))); continue; }
      if (!chosen || trial.totals.elapsed_from_0900_min < chosen.trial.totals.elapsed_from_0900_min) chosen = {day, trial};
    }
    if (chosen) {
      chosen.day.placeIds = chosen.trial.items.map(item => item.place_id);
      details.set(chosen.day.date, chosen.trial);
    } else {
      // A reason represents the whole trip only when it blocks every visit date.
      // Mixed failures (e.g. closed Tuesday, no room Wednesday) have no single cause.
      const common = [...attempts[0]].filter(reason => attempts.every(day => day.has(reason)));
      failures.push({id, reasons: common.length ? common : ['date_conditions_vary']});
    }
  }
  const scheduled = new Set(days.flatMap(day => day.placeIds));
  const missingMust = [...must].some(id => !scheduled.has(id));
  // Only aggregate diagnostics are shared. No submitter IDs, individual choices, veto IDs or limits.
  const reasons = {};
  for (const failure of failures) for (const reason of failure.reasons) reasons[reason] = (reasons[reason] || 0) + 1;
  const complete = scheduled.size > 0 && !missingMust && failures.length === 0;
  return {
    result: {strategy: 'average', days,
      summary: `실제 수집 장소 ${dataset.places.length}곳 중 선택한 장소만 계산한 초안입니다. ${scheduled.size}곳 배치, ${failures.length}곳은 운영·가격·일일 한도 확인으로 미배치했습니다.`
        + (missingMust ? ' 꼭 가는 장소 조건이 충족되지 않았습니다.' : '')
        + ' 비용은 확인된 입장권·대표 메뉴만 포함하며 쇼핑·교통·숙박은 제외합니다. 이동·걸음 수는 추정입니다.'},
    planning: {
      status: complete ? 'model_checks_passed' : 'needs_review', schedule_ready: false,
      selection_policy: 'must_then_selection_count_then_id; selected_only; veto_excluded',
      exchange_rate: request.exchange_rate, catalog_count: dataset.places.length,
      scheduled_count: scheduled.size, unplaced_count: failures.length,
      must_satisfied: !missingMust, exclusion_reason_counts: reasons,
      days: days.map(day => {
        const trial = details.get(day.date);
        return {date: day.date, items: trial?.items || [], totals: trial?.totals || null};
      }),
      limitations: ['No popularity scores or unselected places are used.',
        'Validated only within the reviewed date range; unknown prices, hours and reservations are excluded.',
        'Shopping spend is not applicable to the budget subtotal; null never means free admission.',
        'Travel uses distance × 1.35 and estimated transit; lodging access, venue walking, queues and weather are not included.',
        'Starts at 09:00 Japan time. Stay estimates use the upper end of the team ranges.'],
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const request = JSON.parse(fs.readFileSync(0, 'utf8'));
    const {dataset, profiles} = loadInputs();
    process.stdout.write(JSON.stringify(calculateReal(request, dataset, profiles)) + '\n');
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
