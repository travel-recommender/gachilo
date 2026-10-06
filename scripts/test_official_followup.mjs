import test from 'node:test';
import assert from 'node:assert/strict';
import {loadInputs, availability, validateDay} from './validate_real_schedule.mjs';
const {dataset, profiles} = loadInputs();
const record = id => dataset.places.find(r => r.place.place_id === id);
const check = (id, date) => availability(record(id), date, profiles, {allowShopping: true});

test('weekday CENTRUM price is rejected on weekend, holiday and regular closure dates', () => {
  const id = 'osaka_draft_5f45ffb4d766';
  assert.equal(check(id, '2026-10-01').cost_jpy, 4800);
  assert.equal(check(id, '2026-10-01').eligible_for_model, true);
  for (const date of ['2026-10-03','2026-10-12']) {
    assert.ok(check(id,date).reasons.includes('price_not_applicable_on_visit_date'));
  }
  assert.ok(check(id,'2026-10-05').reasons.includes('closed_on_visit_date'));
});
test('new lunch and ramen prices retain their meal window and branch identity', () => {
  for (const [id, cost, end] of [['osaka_025',3740,960],['osaka_026',1180,1320],['osaka_draft_d0e6cdcb566f',880,900]]) {
    const result = validateDay({date:'2026-10-01',place_ids:[id],krw_per_jpy:'9.5',budget_krw:100000,step_limit:20000,active_min:720},dataset,profiles);
    assert.equal(result.passed_model_checks,true);
    assert.equal(result.items[0].cost_jpy,cost);
    assert.ok(result.items[0].end_min <= end);
  }
  assert.equal(record('osaka_026').place.name_ko,'이치란 도톤보리 별관');
  assert.equal(check('osm_node_2546559085','2026-10-01').eligible_for_model,false);
});
test('published price does not clear uncertain operations and shopping stays outside cost', () => {
  for (const id of ['osaka_draft_6789f7f9c22f','osaka_draft_d580756db04a']) {
    assert.ok(check(id,'2026-10-02').reasons.includes('visit_confirmation_required'));
  }
  const jazz=record('osaka_draft_4af3a5a14578');
  assert.equal(jazz.place.opening_hours,null);
  assert.ok(availability(jazz,'2026-10-02',profiles).reasons.includes('opening_hours_missing'));
  const shopping=check('osaka_draft_e51bbe99124a','2026-10-01');
  assert.equal(shopping.eligible_for_model,true);
  assert.equal(shopping.cost_jpy,null);
  assert.equal(record('osaka_draft_e51bbe99124a').place.cost,null);
});
