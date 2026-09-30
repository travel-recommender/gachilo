import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {auditRealCatalog} from './audit_real_catalog.mjs';
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
