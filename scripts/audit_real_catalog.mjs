/** Reproducible integration fixture; no network, personal inputs or live FX quote. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {loadInputs, availability, validateDay} from './validate_real_schedule.mjs';
import {calculateReal} from '../backend/engine/real.mjs';

// A crowded group itinerary cannot measure whether each record works on its own.
// Keep date availability, single-place validation and seven-day capacity separate.
export function auditIndividualPlaces(dataset, profiles, dates) {
  return dataset.places.map(record => {
    const checks = dates.map(date => ({date,
      ...availability(record, date, profiles, {allowShopping: true})}));
    const eligible = checks.filter(check => check.eligible_for_model);
    let example = null;
    const failures = [];
    for (const {date} of eligible) {
      const result = validateDay({date, place_ids: [record.place.place_id],
        krw_per_jpy: '9.5', budget_krw: 100000, step_limit: 20000, active_min: 720},
      dataset, profiles, {allowShopping: true});
      if (result.passed_model_checks) {
        example = {date, items: result.items, totals: result.totals}; break;
      }
      failures.push({date, violations: result.violations});
    }
    const excluded = new Map();
    for (const {date, reasons, eligible_for_model} of checks) {
      if (eligible_for_model) continue;
      const key = JSON.stringify(reasons);
      if (!excluded.has(key)) excluded.set(key, {dates: [], reasons});
      excluded.get(key).dates.push(date);
    }
    return {place_id: record.place.place_id, name_ko: record.place.name_ko,
      eligible_dates: eligible.map(check => check.date),
      excluded_date_groups: [...excluded.values()],
      passed_individual_model: example !== null, example, failures,
      schedule_ready: false};
  });
}

export function auditRealCatalog() {
  const {dataset, profiles} = loadInputs();
  const selected = dataset.places.map(r => r.place.place_id);
  const snapshot = {
    startDate: '2026-10-01', endDate: '2026-10-07',
    exchange_rate: {krw_per_jpy: '9.5', as_of: '2026-09-30', source: '하나은행 고시환율 형식 테스트용 가상값; 실제 고시 아님', live_quote: false, provenance_status: 'test_fixture'},
    submissions: Array.from({length: 6}, (_, i) => ({picks: selected.slice(i * 25, (i + 1) * 25), must: null, veto: null,
      budgetPerDay: 100000, stepLimit: 20000, activeMin: 720})),
  };
  const output = calculateReal(snapshot, dataset, profiles);
  const dates = Array.from({length: 7}, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  const individual = auditIndividualPlaces(dataset, profiles, dates);
  const scheduledIds = new Set(output.result.days.flatMap(day => day.placeIds));
  return {
    source_sha256: createHash('sha256').update(JSON.stringify(dataset)).digest('hex'),
    profiles_sha256: createHash('sha256').update(JSON.stringify(profiles)).digest('hex'),
    purpose: 'All 150 source IDs submitted as six synthetic participants; this is not a 150-place production-readiness certificate.',
    summary: {
      total_records: selected.length, selected_ids: selected.length,
      address_missing: dataset.places.filter(r => !r.place.address).length,
      opening_hours_missing: dataset.places.filter(r => !r.place.opening_hours).length,
      with_date_profile: Object.keys(profiles.places).length,
      eligible_on_20261001_with_shopping_excluded_from_cost: dataset.places.filter(r => availability(r, '2026-10-01', profiles, {allowShopping: true}).eligible_for_model).length,
      scheduled_over_seven_days: output.planning.scheduled_count,
      not_scheduled: output.planning.unplaced_count,
      passed_individual_model: individual.filter(r => r.passed_individual_model).length,
      excluded_on_all_seven_dates: individual.filter(r => r.eligible_dates.length === 0).length,
      eligible_but_failed_individual_model: individual.filter(r => r.eligible_dates.length && !r.passed_individual_model).length,
      passed_individually_but_not_scheduled_in_group: individual.filter(r => r.passed_individual_model && !scheduledIds.has(r.place_id)).length,
    },
    individual_validation: {dates, rate_is_test_fixture: true,
      meaning: 'Each place is tried separately; this does not mean all places fit one trip or are production-ready.',
      places: individual},
    audit: dataset.places.map(r => availability(r, '2026-10-01', profiles, {allowShopping: true})),
    ...output,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = auditRealCatalog();
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
  else process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
