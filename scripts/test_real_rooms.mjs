import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {auditRealCatalog, auditIndividualPlaces} from './audit_real_catalog.mjs';
import {calculateReal} from '../backend/engine/real.mjs';
import {loadInputs, availability} from './validate_real_schedule.mjs';
const {dataset,profiles}=loadInputs();
const record=id=>dataset.places.find(r=>r.place.place_id===id);
function trip(ids,extra={}) {
  const sub={picks:ids,must:null,veto:null,budgetPerDay:100000,stepLimit:20000,activeMin:720,...extra};
  return {startDate:'2026-10-01',endDate:'2026-10-01',submissions:[sub,structuredClone(sub)],exchange_rate:{krw_per_jpy:'9.5'}};
}
const run=request=>calculateReal(request,dataset,profiles);
test('unknown prices and reservation requirements exclude a selected must',()=>{
  const p=run(trip(['osaka_001','osaka_002'],{must:'osaka_002'}));
  assert.equal(p.planning.scheduled_count,0);assert.equal(p.planning.must_satisfied,false);
});
test('the weakest member daily time constraint is hard',()=>{
  const r=trip(['osaka_009']);r.submissions[1].activeMin=1;
  assert.equal(run(r).planning.scheduled_count,0);
});
test('budget rejects paid admission and retains free selected park',()=>{
  const p=run(trip(['osaka_009','osaka_015'],{budgetPerDay:0}));
  assert.deepEqual(p.result.days[0].placeIds,['osaka_015']);
  assert.equal(p.planning.status,'needs_review');
});
test('closed first day is retried on the second date',()=>{
  const r=trip(['osaka_012']);r.startDate='2026-10-06';r.endDate='2026-10-07';
  const p=run(r);assert.deepEqual(p.result.days[0].placeIds,[]);
  assert.deepEqual(p.result.days[1].placeIds,['osaka_012']);
});
test('a partially unreviewed trip does not blame every omitted place on its date range',()=>{
  const r=trip(dataset.places.map(row=>row.place.place_id));
  r.startDate='2026-11-15';r.endDate='2026-12-14';
  const p=run(r).planning;
  assert.equal(p.scheduled_count,44);assert.equal(p.unplaced_count,106);
  assert.equal(p.exclusion_reason_counts.outside_reviewed_date_range,undefined);
  assert.equal(p.exclusion_reason_counts.cost_unknown_or_not_applicable,79);
  assert.equal(p.exclusion_reason_counts.structured_date_profile_missing,91);
});
test('a wholly unreviewed trip retains the date-range reason',()=>{
  const r=trip(['osaka_015']);r.startDate='2026-12-01';r.endDate='2026-12-02';
  assert.deepEqual(run(r).planning.exclusion_reason_counts,{outside_reviewed_date_range:1});
});
test('closed on one day and over the time limit on another is a mixed failure',()=>{
  const r=trip(['osaka_012'],{activeMin:1});r.startDate='2026-10-06';r.endDate='2026-10-07';
  assert.equal(run(r).planning.scheduled_count,0);
  assert.deepEqual(run(r).planning.exclusion_reason_counts,{date_conditions_vary:1});
  r.endDate=r.startDate;
  assert.deepEqual(run(r).planning.exclusion_reason_counts,{closed_on_visit_date:1});
});
test('museum holiday closure and late opening are normalized',()=>{
  const id='osaka_draft_1cbe7e7894c8';
  assert.ok(availability(record(id),'2026-11-03',profiles).reasons.includes('closed_on_visit_date'));
  const sky=record('osaka_draft_d7da3fdbeaf6');
  assert.deepEqual(availability(sky,'2026-10-02',profiles).window,[600,1200,1170]);
  assert.deepEqual(availability(sky,'2026-10-11',profiles).window,[600,1200,1170]);
  assert.ok(availability(sky,'2026-11-04',profiles).reasons.includes('closed_on_visit_date'));
});
test('all selected eligible IDs are unique across days and never replaced with demo places',()=>{
  const ids=['osaka_009','osaka_015','osaka_017','osaka_018','osaka_019'];
  const r=trip(ids);r.endDate='2026-10-03';const p=run(r);
  const scheduled=p.result.days.flatMap(d=>d.placeIds);
  assert.equal(scheduled.length,new Set(scheduled).size);
  assert.deepEqual(new Set(scheduled),new Set(ids));
});
test('committed all-catalogue integration fixture matches the current data',()=>{
  const actual=auditRealCatalog();
  assert.equal(actual.summary.selected_ids,150);
  assert.equal(actual.summary.scheduled_over_seven_days+actual.summary.not_scheduled,150);
  assert.deepEqual(actual,JSON.parse(fs.readFileSync(new URL('../data/week5/real_catalog_integration_20260930.json',import.meta.url),'utf8')));
});
test('individual checks retry a closed first date and expose a real scheduling failure',()=>{
  const museum=record('osaka_012');
  const tooLong=structuredClone(record('osaka_015'));tooLong.place.stay_min=721;
  const rows=auditIndividualPlaces({places:[museum,tooLong]},profiles,['2026-10-06','2026-10-07']);
  assert.equal(rows[0].example.date,'2026-10-07');
  assert.deepEqual(rows[0].excluded_date_groups[0].dates,['2026-10-06']);
  assert.ok(rows[0].excluded_date_groups[0].reasons.includes('closed_on_visit_date'));
  assert.equal(rows[1].eligible_dates.length,2);
  assert.equal(rows[1].passed_individual_model,false);
  assert.equal(rows[1].failures.length,2);
});
test('Whity closes on the reviewed odd-month third Thursday, not the even-month one',()=>{
  const p=dataset.places.find(r=>r.place.name_ko==='화이티 우메다');
  const check=date=>availability(p,date,profiles,{allowShopping:true});
  assert.equal(check('2026-10-15').eligible_for_model,true);
  assert.ok(check('2026-11-19').reasons.includes('closed_on_visit_date'));
  assert.equal(check('2026-11-20').eligible_for_model,true);
});
test('uncertain shopping closure and irregular holidays remain excluded',()=>{
  const wiste=record('osaka_draft_11050de606b0');
  assert.ok(availability(wiste,'2026-10-08',profiles,{allowShopping:true}).reasons.includes('closure_notice_year_unconfirmed'));
  assert.equal(availability(wiste,'2026-10-09',profiles,{allowShopping:true}).eligible_for_model,true);
  assert.ok(availability(record('osaka_draft_481d9742f9c2'),'2026-10-01',profiles,{allowShopping:true}).reasons.includes('visit_confirmation_required'));
});
test('department-store common windows and tea-shop closed days are respected',()=>{
  assert.deepEqual(availability(record('osaka_draft_daa353940c61'),'2026-10-01',profiles,{allowShopping:true}).window,[600,1110,1110]);
  assert.deepEqual(availability(record('osaka_draft_dc3ec67cb8d1'),'2026-10-01',profiles,{allowShopping:true}).window,[600,1200,1200]);
  const tea=record('osaka_draft_96e588e49f58');
  for(const date of ['2026-10-05','2026-10-06']) assert.ok(availability(tea,date,profiles).reasons.includes('closed_on_visit_date'));
  assert.equal(availability(tea,'2026-10-07',profiles).eligible_for_model,true);
});
test('GARB weekday menu price is never used on weekends or holidays',()=>{
  const id='osaka_draft_23d3d20ef739';
  const weekday=run(trip([id]));
  assert.equal(weekday.planning.scheduled_count,1);
  const item=weekday.planning.days[0].items[0];
  assert.equal(item.cost_jpy,1250);assert.ok(item.end_min<=900);
  for(const date of ['2026-10-03','2026-10-04','2026-10-12']){
    const check=availability(record(id),date,profiles);
    assert.ok(check.reasons.includes('price_not_applicable_on_visit_date'));
    assert.ok(!check.reasons.includes('closed_on_visit_date'));
    const r=trip([id]);r.startDate=date;r.endDate=date;
    assert.equal(run(r).planning.scheduled_count,0);
  }
});
