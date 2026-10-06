import test from 'node:test';
import assert from 'node:assert/strict';
import {loadInputs, availability, validateDay} from './validate_real_schedule.mjs';

const {dataset, profiles} = loadInputs();
const records = new Map(dataset.places.map(r => [r.place.place_id, r]));
const check = (id, date) => availability(records.get(id), date, profiles, {allowShopping:true});

test('newly reviewed park and bridge are usable only within their reviewed date range', () => {
  for (const id of ['osaka_draft_2941efc9ac2d', 'osaka_draft_f0f97440bedc']) {
    assert.ok(check(id, '2026-10-05').reasons.includes('outside_place_reviewed_date_range'));
    assert.equal(check(id, '2026-10-07').eligible_for_model, true);
    assert.equal(check(id, '2026-10-07').cost_jpy, 0);
    assert.equal(check(id, '2026-10-07').schedule_ready, false);
  }
});

test('Comfort Zone pasta is constrained to lunch and does not authorize closed or holiday dates', () => {
  const id = 'osaka_draft_8cb9705b2793';
  assert.ok(check(id, '2026-10-06').reasons.includes('closed_on_visit_date'));
  assert.ok(check(id, '2026-10-12').reasons.includes('holiday_hours_unconfirmed'));
  for (const date of ['2026-10-07','2026-10-10','2026-10-11']) {
    const result = validateDay({date, place_ids:[id], krw_per_jpy:'9.5',
      budget_krw:100000,step_limit:20000,active_min:720}, dataset, profiles);
    assert.equal(result.passed_model_checks, true);
    assert.equal(result.items[0].cost_jpy, 1150);
    assert.ok(result.items[0].start_min >= 720 && result.items[0].start_min <= 780);
    assert.ok(result.items[0].end_min <= 840);
  }
});

test('fixed kart price and non-null hours cannot bypass booking, licence, or conflicting sources', () => {
  const kart = check('osaka_draft_300825840acb','2026-10-07');
  assert.equal(kart.eligible_for_model,false);
  assert.ok(kart.reasons.includes('entry_time_reservation_required'));
  assert.ok(kart.reasons.includes('driving_eligibility_confirmation_required'));
  assert.ok(check('osaka_draft_f22cfa23d646','2026-10-07').reasons.includes('hours_conflict'));
  assert.ok(check('osaka_draft_c341bbd2440a','2026-10-07').reasons.includes('address_conflict'));
});

test('an opening-time profile does not turn an unknown price or ended exhibition into an eligible visit', () => {
  const nagara = check('osaka_draft_e102a263e5a8','2026-10-07');
  assert.deepEqual(nagara.window,[540,1020,1020]);
  assert.ok(!nagara.reasons.includes('hours_conflict'));
  assert.ok(nagara.reasons.includes('cost_unknown_or_not_applicable'));
  const artcourt = check('osaka_draft_c99cbfbd0f92','2026-10-18');
  assert.ok(artcourt.reasons.includes('outside_place_reviewed_date_range'));
  assert.ok(artcourt.reasons.includes('cost_unknown_or_not_applicable'));
});
