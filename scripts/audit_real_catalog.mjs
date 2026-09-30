/** Reproducible integration fixture; no network, personal inputs or live FX quote. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {loadInputs, availability} from './validate_real_schedule.mjs';
import {calculateReal} from '../backend/engine/real.mjs';

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
    },
    audit: dataset.places.map(r => availability(r, '2026-10-01', profiles, {allowShopping: true})),
    ...output,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = auditRealCatalog();
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
  else process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
