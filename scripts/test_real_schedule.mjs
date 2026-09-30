import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {availability, costKrw, loadInputs, makeReport, validateDay} from './validate_real_schedule.mjs';
const {dataset, profiles} = loadInputs();
const record = id => dataset.places.find(r => r.place.place_id === id);
const request = (place_ids, extra = {}) => ({date: '2026-10-01', place_ids,
  krw_per_jpy: '9.2', budget_krw: 50000, step_limit: 15000, active_min: 600, ...extra});
const run = (ids, extra = {}, d = dataset, p = profiles) => validateDay(request(ids, extra), d, p);

test('JPY conversion is decimal half-up and rejects null/invalid rates', () => {
  assert.equal(costKrw(1200, '9.2'), 11040);
  assert.equal(costKrw(715, '9.2'), 6578);
  assert.equal(costKrw(1, '9.5'), 10);
  assert.equal(costKrw(0, '9.2'), 0);
  for (const cost of [null, true, -1, NaN, 1.2]) assert.throws(() => costKrw(cost, '9.2'));
  for (const rate of [null, 9.2, '0', '-1', 'NaN', 'Infinity']) assert.throws(() => costKrw(1, rate));
});
test('dated free admission changes both JPY and KRW totals without changing the catalogue', () => {
  const id='osaka_draft_ce3b8d452a0e';
  const regular=run([id]);
  assert.equal(regular.items[0].cost_jpy,430);
  const free=run([id],{date:'2026-10-03',budget_krw:0});
  assert.equal(free.passed_model_checks,true);
  assert.equal(free.items[0].cost_jpy,0);
  assert.equal(free.items[0].cost_krw,0);
  assert.equal(free.totals.selected_admission_and_menu_krw,0);
  assert.equal(record(id).place.cost,430);
  assert.equal(run(['osaka_011'],{date:'2026-10-21',budget_krw:0}).passed_model_checks,true);
  assert.equal(run(['osaka_011'],{date:'2026-10-20',budget_krw:0}).passed_model_checks,false);
});
test('exhibition end date and special Monday opening are enforced independently', () => {
  const id='osaka_draft_ce3b8d452a0e';
  assert.equal(run([id],{date:'2026-11-02'}).passed_model_checks,true);
  assert.equal(run([id],{date:'2026-11-03',budget_krw:0}).passed_model_checks,true);
  assert.ok(availability(record(id),'2026-11-04',profiles).reasons.includes('outside_place_reviewed_date_range'));
  assert.ok(availability(record(id),'2026-10-13',profiles).reasons.includes('closed_on_visit_date'));
  assert.equal(run([id],{date:'2026-10-12'}).passed_model_checks,true);
});
test('invalid dated prices fail closed, including explicit null instead of a fallback price', () => {
  const id='osaka_draft_ce3b8d452a0e';
  for (const cost of [null,-1,1.5,'0',true]) {
    const p=structuredClone(profiles);p.places[id].exceptions['2026-10-03'].cost_jpy=cost;
    assert.equal(run([id],{date:'2026-10-03'},dataset,p).passed_model_checks,false);
  }
});
test('corrected shopping category keeps spend null and applies the agreed short stay', () => {
  const id='osaka_draft_5a243c3857f7';
  const result=validateDay(request([id]),dataset,profiles,{allowShopping:true});
  assert.equal(result.passed_model_checks,true);
  assert.equal(result.items[0].cost_jpy,null);
  assert.equal(result.items[0].stay_min,30);
  assert.equal(record(id).place.bag_load,2);
});
test('restaurant menu scope and unresolved holiday hours are not widened', () => {
  const agora=run(['osaka_draft_2f89be830b8c']);
  assert.equal(agora.passed_model_checks,true);
  assert.ok(agora.items[0].start_min>=840 && agora.items[0].end_min<=1020);
  const saizeriya=run(['osaka_draft_2eb759c40909']);
  assert.equal(saizeriya.items[0].cost_jpy,300);
  assert.ok(saizeriya.items[0].end_min<=1320);
  assert.ok(availability(record('osaka_draft_873f1e0cf834'),'2026-11-03',profiles).reasons.includes('holiday_hours_unconfirmed'));
});
test('historical museum closes Tuesday and shifts a holiday closure to Wednesday', () => {
  const r = record('osaka_012');
  assert.ok(availability(r, '2026-10-06', profiles).reasons.includes('closed_on_visit_date'));
  assert.equal(availability(r, '2026-11-03', profiles).eligible_for_model, true);
  assert.ok(availability(r, '2026-11-04', profiles).reasons.includes('closed_on_visit_date'));
});
test('uncertain HEP notice year is not silently interpreted as open or permanently closed', () => {
  assert.ok(availability(record('osaka_008'), '2026-10-15', profiles).reasons.includes('closure_notice_year_unconfirmed'));
  assert.equal(availability(record('osaka_008'), '2026-10-16', profiles).eligible_for_model, true);
});
test('Umeda maintenance exception overrides the normal closing and last-entry time', () => {
  assert.deepEqual(availability(record('osaka_007'), '2026-11-08', profiles).window, [570,1140,1110]);
});
test('reservations and irregular closures are kept out until date confirmation', () => {
  assert.equal(run(['osaka_002']).items.length, 0);
  assert.equal(run(['osaka_draft_243b34cd6761']).items.length, 0);
  assert.equal(run(['osaka_002']).passed_model_checks, false);
});
test('one missing candidate fails the whole request and is not discarded as a success', () => {
  const result=run(['osaka_009','osaka_001']);
  assert.equal(result.passed_model_checks,false);
  assert.ok(result.rejected.some(r=>r.place_id==='osaka_001'));
  assert.ok(result.violations.some(r=>r.code==='requested_place_not_scheduled'));
});
test('unknown and shopping-not-applicable prices never become zero', () => {
  assert.ok(availability(record('osaka_001'),'2026-10-01',profiles).reasons.includes('cost_unknown_or_not_applicable'));
  assert.ok(availability(record('osaka_021'),'2026-10-01',profiles).reasons.includes('cost_unknown_or_not_applicable'));
  const result=run(['osaka_015']);
  assert.equal(result.passed_model_checks,true);
  assert.equal(result.totals.selected_admission_and_menu_krw,0);
});
test('Cherry Jam lunch price cannot fund a dinner visit and Monday is excluded', () => {
  const result=run(['osaka_draft_26a5e809355e']);
  assert.equal(result.passed_model_checks,true);
  assert.equal(result.items[0].cost_krw,9016);
  assert.ok(result.items[0].start_min>=690 && result.items[0].end_min<=900);
  assert.equal(run(['osaka_draft_26a5e809355e'],{date:'2026-10-05'}).passed_model_checks,false);
});
test('budget, steps, and elapsed-time limits are checked independently after scheduling', () => {
  for (const [limits,code] of [[{budget_krw:0},'budget_exceeded'],[{step_limit:0},'step_limit_exceeded'],[{active_min:1},'active_minutes_exceeded']]) {
    const result=run(['osaka_009','osaka_012'],limits);
    assert.equal(result.passed_model_checks,false);
    assert.ok(result.violations.some(v=>v.code===code));
  }
});
test('last-entry time is checked even when stay could finish before closing', () => {
  const modified=structuredClone(profiles);
  modified.places.osaka_009.window=[0,1080,539];
  assert.ok(run(['osaka_009'],{},dataset,modified).violations.some(v=>v.code==='opening_or_last_entry_violation'));
});
test('time-dropped requested places invalidate the result', () => {
  const modified=structuredClone(dataset);
  modified.places.find(r=>r.place.place_id==='osaka_009').place.stay_min=721;
  const result=run(['osaka_009'],{},modified);
  assert.deepEqual(result.dropped,['osaka_009']);
  assert.equal(result.passed_model_checks,false);
});
test('unsupported dates, invalid dates, duplicate IDs and malformed constraints fail explicitly', () => {
  assert.equal(run(['osaka_009'],{date:'2027-01-01'}).passed_model_checks,false);
  for (const date of ['2026-02-30','2026-10-01T00:00:00Z','']) assert.throws(()=>run(['osaka_009'],{date}));
  assert.throws(()=>run(['osaka_009','osaka_009']));
  assert.throws(()=>run([]));
  assert.throws(()=>run(['osaka_009'],{active_min:NaN}));
  assert.equal(run(['does-not-exist']).passed_model_checks,false);
});
test('source data stay unchanged, every profile has evidence, and no demo filler enters schedules', () => {
  const before=JSON.stringify(dataset);
  const report=makeReport(dataset,profiles);
  assert.equal(JSON.stringify(dataset),before);
  assert.equal(report.summary.total_records,150);
  assert.equal(report.summary.production_schedule_ready,0);
  assert.equal(report.summary.scenarios_passed,4);
  const ids=new Set(dataset.places.map(r=>r.place.place_id));
  for (const [id,p] of Object.entries(profiles.places)) {
    assert.ok(ids.has(id));assert.ok(p.source_urls.length);
    assert.ok(p.source_urls.every(u=>u.startsWith('https://')));
  }
  for (const scenario of report.scenarios) {
    assert.ok(scenario.items.every(p=>ids.has(p.place_id)&&scenario.input.place_ids.includes(p.place_id)));
    assert.equal(scenario.schedule_ready,false);
  }
});
test('committed validation report is reproducible from the current source and profiles', () => {
  const saved=JSON.parse(fs.readFileSync(new URL('../data/week5/schedule_validation_20260930.json',import.meta.url),'utf8'));
  assert.deepEqual(makeReport(dataset,profiles),saved);
});
