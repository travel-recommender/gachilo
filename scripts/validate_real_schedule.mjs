/** Week 5 day validator, also reused by the opt-in real catalogue server adapter. Node 24+. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {buildSchedule} from '../backend/engine/schedule.ts';
import {travel, kmToSteps} from '../backend/engine/consensus.ts';

const sourceURL = new URL('../data/week5/live_20260923/processed/osaka_places_150_fresh.json', import.meta.url);
const profilesURL = new URL('../data/week5/schedule_profiles_20260930.json', import.meta.url);
export const loadInputs = () => ({
  dataset: JSON.parse(fs.readFileSync(sourceURL, 'utf8')),
  profiles: JSON.parse(fs.readFileSync(profilesURL, 'utf8')),
});
const categories = {명소: 'landmark', 문화: 'culture', 자연: 'nature', 쇼핑: 'shopping', 카페: 'cafe', 식사: 'food'};
const shoppingRecord = r => r.place.category === '쇼핑'
  || ['구로몬시장', '신사이바시스지 상점가', '아메리카무라', '신세카이'].includes(r.place.name_ko)
  || ['shopping_spend_excluded', 'exclude_personal_shopping_spend'].includes(r.review.planning_cost_policy);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
  && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const dayOfWeek = date => new Date(date + 'T00:00:00Z').getUTCDay();
const previousDay = date => new Date(Date.parse(date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);

// Decimal integer arithmetic, same positive ROUND_HALF_UP rule as the API.
export function costKrw(jpy, rate) {
  if (!Number.isSafeInteger(jpy) || jpy < 0) throw Error('cost_jpy must be a nonnegative integer');
  if (typeof rate !== 'string' || !/^\d{1,6}(\.\d{1,6})?$/.test(rate) || Number(rate) <= 0) {
    throw Error('krw_per_jpy must be a positive decimal string (up to 6 decimal places)');
  }
  const [whole, fraction = ''] = rate.split('.');
  const scale = 10n ** BigInt(fraction.length);
  const numerator = BigInt(jpy) * BigInt(whole + fraction);
  const won = Number((2n * numerator + scale) / (2n * scale));
  if (!Number.isSafeInteger(won)) throw Error('converted price exceeds safe integer range');
  return won;
}

export function availability(record, date, profiles, {allowShopping = false} = {}) {
  if (!validDate(date)) throw Error('date must be a real YYYY-MM-DD date in Japan');
  const p = record.place, profile = profiles.places[p.place_id];
  const reasons = [...(record.review.recommendation_blockers || [])];
  if (!p.address) reasons.push('address_missing');
  if (!p.opening_hours) reasons.push('opening_hours_missing');
  const shopping = shoppingRecord(record);
  const override = profile?.exceptions?.[date];
  // Keep the catalogue's ordinary price; dated free-admission rules apply only to this visit.
  const visitCost = override && Object.hasOwn(override, 'cost_jpy') ? override.cost_jpy : p.cost;
  if (shopping ? !allowShopping : !Number.isSafeInteger(visitCost) || visitCost < 0) reasons.push('cost_unknown_or_not_applicable');
  if (!Number.isSafeInteger(p.stay_min) || p.stay_min <= 0) reasons.push('stay_min_invalid');
  if (![0, 1, 2].includes(p.bag_load)) reasons.push('bag_load_invalid');
  if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)
      || p.latitude < -90 || p.latitude > 90 || p.longitude < -180 || p.longitude > 180) reasons.push('coordinates_invalid');
  if (!categories[p.category]) reasons.push('category_unknown');
  if (!profile) reasons.push('structured_date_profile_missing');
  if (date < profiles.valid_from || date > profiles.valid_through) reasons.push('outside_reviewed_date_range');
  let window = null;
  if (profile) {
    if (profile.valid_from && date < profile.valid_from || profile.valid_through && date > profile.valid_through) {
      reasons.push('outside_place_reviewed_date_range');
    }
    if (profile.requires_visit_confirmation) reasons.push('visit_confirmation_required');
    if (profile.entry_time_reservation) reasons.push('entry_time_reservation_required');
    if (profile.uncertain_dates?.includes(date)) reasons.push('closure_notice_year_unconfirmed');
    const weekday = dayOfWeek(date);
    const holiday = profiles.japan_holidays.includes(date);
    if (profile.holiday_hours_unconfirmed && holiday) reasons.push('holiday_hours_unconfirmed');
    // A weekday-only price cannot imply that the restaurant itself is closed.
    if (profile.price_unavailable_weekdays?.includes(weekday)
        || profile.price_unavailable_holidays && holiday) reasons.push('price_not_applicable_on_visit_date');
    let closed = profile.closed_weekdays?.includes(weekday) || false;
    if (profile.closed_holidays && holiday) closed = true;
    if (profile.holiday_moves_closure && closed && holiday) closed = false;
    const yesterday = previousDay(date);
    if (profile.holiday_moves_closure && profiles.japan_holidays.includes(yesterday)
        && profile.closed_weekdays?.includes(dayOfWeek(yesterday))) closed = true;
    // A dated official opening also overrides a regular weekly closure.
    if (typeof override?.closed === 'boolean') closed = override.closed;
    if (closed) reasons.push('closed_on_visit_date');
    window = profile.window;
    if (profile.weekday_window && !holiday && weekday >= 1 && weekday <= 5) window = profile.weekday_window;
    const tomorrow = new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    if (profile.extended_weekdays?.includes(weekday) || profile.extend_before_holiday && profiles.japan_holidays.includes(tomorrow)) window = profile.extended_window;
    if (override?.window) window = override.window;
    if (!Array.isArray(window) || window.length !== 3 || !window.every(Number.isInteger)
        || window[0] < 0 || window[1] > 1440 || window[0] >= window[1]
        || window[2] < window[0] || window[2] > window[1]) reasons.push('invalid_time_window');
  }
  return {place_id: p.place_id, name_ko: p.name_ko, reasons: [...new Set(reasons)], window,
    cost_jpy: shopping ? null : visitCost,
    cost_basis: profile?.cost_basis ?? null, source_urls: profile?.source_urls ?? [],
    eligible_for_model: reasons.length === 0, schedule_ready: false};
}

/** One Japan-local day. All requested IDs must be kept; omissions fail validation. */
export function validateDay(request, dataset, profiles, options = {}) {
  if (!validDate(request.date)) throw Error('date must be a real YYYY-MM-DD date in Japan');
  if (!Array.isArray(request.place_ids) || request.place_ids.length === 0
      || request.place_ids.some(id => typeof id !== 'string')
      || new Set(request.place_ids).size !== request.place_ids.length) throw Error('place_ids must be a nonempty list of unique IDs');
  for (const key of ['budget_krw', 'step_limit', 'active_min']) {
    if (!Number.isSafeInteger(request[key]) || request[key] < 0) throw Error(key + ' must be a nonnegative integer');
  }
  costKrw(0, request.krw_per_jpy); // Validate the rate even if all candidates are blocked.
  const byId = new Map(dataset.places.map(r => [r.place.place_id, r]));
  const rejected = [], accepted = [], windows = new Map(), visitCosts = new Map();
  for (const id of request.place_ids) {
    const r = byId.get(id);
    if (!r) { rejected.push({place_id: id, reasons: ['unknown_place_id']}); continue; }
    const check = availability(r, request.date, profiles, options);
    if (!check.eligible_for_model) { rejected.push(check); continue; }
    windows.set(id, check.window);
    visitCosts.set(id, check.cost_jpy);
    const p = r.place;
    accepted.push({place: {
      id, name: p.name_ko, area: p.area || '', category: categories[p.category],
      lat: p.latitude, lng: p.longitude, cost: options.allowShopping && shoppingRecord(r) ? 0 : costKrw(check.cost_jpy, request.krw_per_jpy),
      stayMin: p.stay_min, openFrom: check.window[0], openTo: check.window[1],
      bagLoad: p.bag_load / 2,
      // No invented popularity/exposure/arcade values: the scheduling function does not use them.
    }, votes: 1, mustOf: null, tier: 'core', participants: []});
  }
  const built = buildSchedule(accepted, 1, {fillMeals: false, considerBags: true});
  const plan = built.plans[0];
  const violations = rejected.map(r => ({code: 'place_not_eligible', place_id: r.place_id, reasons: r.reasons}));
  let walkingKm = 0, previous = null;
  const items = plan.items.map(item => {
    const movement = previous ? travel(previous, item.place) : {km: 0, min: 0, walkKm: 0, mode: 'walk'};
    walkingKm += movement.walkKm;
    const [open, close, lastEntry] = windows.get(item.place.id);
    if (item.startMin < open || item.endMin > close || item.startMin > lastEntry) {
      violations.push({code: 'opening_or_last_entry_violation', place_id: item.place.id});
    }
    previous = item.place;
    const record = byId.get(item.place.id);
    const shopping = shoppingRecord(record);
    return {place_id: item.place.id, name_ko: item.place.name, start_min: item.startMin, end_min: item.endMin,
      stay_min: item.place.stayMin, move_min: movement.min, move_mode: movement.mode,
      cost_jpy: shopping ? null : visitCosts.get(item.place.id), cost_krw: shopping ? null : item.place.cost,
      cost_status: shopping ? 'not_applicable_shopping' : 'known',
      cost_basis: profiles.places[item.place.id].cost_basis};
  });
  const included = new Set(items.map(item => item.place_id));
  for (const id of request.place_ids) {
    if (!included.has(id)) violations.push({code: 'requested_place_not_scheduled', place_id: id});
  }
  const steps = kmToSteps(walkingKm);
  const elapsed = items.length ? items.at(-1).end_min - 540 : 0; // Include waiting after 09:00.
  if (plan.cost > request.budget_krw) violations.push({code: 'budget_exceeded'});
  if (steps > request.step_limit) violations.push({code: 'step_limit_exceeded'});
  if (elapsed > request.active_min) violations.push({code: 'active_minutes_exceeded'});
  return {date: request.date, passed_model_checks: violations.length === 0, schedule_ready: false,
    input: request, items, rejected, dropped: built.dropped.map(r => r.place.id), violations,
    totals: {selected_admission_and_menu_krw: plan.cost, estimated_walking_km: walkingKm,
      estimated_steps: steps, elapsed_from_0900_min: elapsed},
    limitations: [
      'This day-validator result is an experiment; the opt-in real catalogue server wraps it in a saved draft.',
      'Costs cover the stated adult admission/menu only; transport, lodging, extra meals and shopping are excluded.',
      'JPY→KRW rate is a caller-supplied simulation value, not a live quote.',
      'Travel uses straight-line distance × 1.35 and a transit heuristic, not routing or timetables.',
      'Walk count excludes movement inside venues and to/from accommodation; elapsed time starts at 09:00.',
      'Stay times are team estimates. Weather, entry queues and unannounced closures are not verified.',
    ]};
}

export function makeReport(dataset, profiles) {
  const date = '2026-10-01';
  const audit = dataset.places.map(record => availability(record, date, profiles));
  const scenarios = [
    ['castle_museum_park', ['osaka_009', 'osaka_012', 'osaka_015']],
    ['umeda_observatories_lunch', ['osaka_007', 'osaka_008', 'osaka_028']],
    ['parks_and_lunch', ['osaka_019', 'osaka_draft_26a5e809355e', 'osaka_017']],
    ['tenshiba_walk', ['osaka_018']],
  ].map(([name, place_ids]) => ({name, ...validateDay({date, place_ids,
    krw_per_jpy: '9.2', budget_krw: 50000, step_limit: 15000, active_min: 600}, dataset, profiles)}));
  return {reviewed_at: profiles.checked_at, audited_date: date,
    source_sha256: createHash('sha256').update(JSON.stringify(dataset)).digest('hex'),
    profiles_sha256: createHash('sha256').update(JSON.stringify(profiles)).digest('hex'),
    summary: {total_records: audit.length, with_date_profile: Object.keys(profiles.places).length,
      eligible_for_offline_model: audit.filter(r => r.eligible_for_model).length,
      production_schedule_ready: dataset.places.filter(r => r.review.schedule_ready).length,
      scenarios_passed: scenarios.filter(r => r.passed_model_checks).length,
      distinct_scheduled_places: new Set(scenarios.flatMap(s => s.items.map(p => p.place_id))).size},
    audit, scenarios};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const {dataset, profiles} = loadInputs();
    if (process.argv[2] === '--report') {
      const output = makeReport(dataset, profiles);
      if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(output, null, 2) + '\n', 'utf8');
      else process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    } else if (process.argv[2] === '--request' && process.argv[3]) {
      const request = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
      const result = validateDay(request, dataset, profiles);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      if (!result.passed_model_checks) process.exitCode = 2;
    } else {
      process.stderr.write('Usage: node ' + fileURLToPath(import.meta.url) + ' --report [output.json] | --request input.json\n');
      process.exitCode = 1;
    }
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
