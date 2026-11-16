import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadRuntimeInputs, availability, validateDay} from './validate_real_schedule.mjs';
import {schedulableDetails} from '../backend/engine/schedulable.mjs';
import {calculateRealCandidates} from '../backend/engine/real_candidates.mjs';
import {mockLiveCheck} from '../backend/engine/live_check.mjs';
const {dataset,profiles}=loadRuntimeInputs();
const ids=['osaka_001','osaka_005','branch_usj'];
const record=id=>dataset.places.find(r=>r.place.place_id===id);
const dates=['2026-11-16','2026-11-17','2026-11-18','2026-11-19'];

test('three reviewed landmarks are selectable without promoting the other held records',()=>{
 const result=schedulableDetails(dates,dataset,profiles);
 for(const id of ids){assert.ok(result.placeIds.includes(id));assert.equal(result.unavailableReasons[id],undefined);assert.equal(record(id).review.schedule_ready,false);}
 const oldDataset=JSON.parse(fs.readFileSync(new URL('../data/final/osaka_catalog_20261112.json',import.meta.url)));
 const oldProfiles=JSON.parse(fs.readFileSync(new URL('../data/final/osaka_profiles_20261104.json',import.meta.url)));
 const before=schedulableDetails(dates,oldDataset,oldProfiles).placeIds;
 assert.deepEqual(result.placeIds.filter(id=>!before.includes(id)).sort(),[...ids].sort());
 for(const row of dataset.places.filter(r=>!ids.includes(r.place.place_id))) assert.deepEqual(row,oldDataset.places.find(r=>r.place.place_id===row.place.place_id));
 assert.equal(result.placeIds.length,118);
});
test('USJ price is dated, unknown dates stay blocked, and real closures are preserved',()=>{
 for(const date of ['2026-11-17','2026-11-18','2026-11-19']){
  const a=availability(record('branch_usj'),date,profiles,{allowShopping:true});
  assert.equal(a.eligible_for_model,true);assert.equal(a.cost_jpy,9900);
 }
 for(const date of ['2026-11-16','2026-11-20','2026-12-01'])assert.equal(availability(record('branch_usj'),date,profiles).eligible_for_model,false);
 const only16=schedulableDetails(['2026-11-16'],dataset,profiles);
 assert.match(only16.unavailableReasons.branch_usj,/2026-11-17~2026-11-19/);
 assert.equal(availability(record('osaka_012'),'2026-11-17',profiles).eligible_for_model,false);
 assert.ok(schedulableDetails(['2026-12-01'],dataset,profiles).placeIds.length===0);
 assert.ok(!schedulableDetails(dates,dataset,profiles).placeIds.includes('branch_kaiyukan'));
});
test('public viewing and market planning windows do not claim all shops are open',()=>{
 assert.notEqual(record('osaka_001').place.latitude,34.668926);
 assert.equal(profiles.places.osaka_001.window_basis,'editorial_visit_window_not_business_hours');
 assert.equal(profiles.places.osaka_005.window_basis,'editorial_visit_window_not_business_hours');
 assert.match(record('osaka_005').place.opening_hours,/공통 영업시간 아님/);
 assert.match(profiles.places.osaka_005.cost_basis,/구매액 별도/);
});
test('the real engine can place each landmark under all strategies; budget remains enforced',async()=>{
 for(const id of ids){
  const request={startDate:'2026-11-17',endDate:'2026-11-17',exchange_rate:{krw_per_jpy:'9.5'},
   submissions:['a','b','c'].map(memberId=>({memberId,longlist:[id],picks:[id],must:id,veto:null,budgetPerDay:150000,stepLimit:20000,activeMin:720,tradeoffs:{pace:0.5,distance:0.5,spend:1}}))};
  const result=await calculateRealCandidates(request,dataset,profiles,{baseUrl:''},{liveCheck:mockLiveCheck('pass'),choose:null});
  assert.equal(result.candidates.length,3);
  for(const c of result.candidates) assert.ok(c.days.flatMap(d=>d.placeIds).includes(id),id+':'+c.strategy);
 }
 const request={date:'2026-11-17',place_ids:['branch_usj'],krw_per_jpy:'9.5',budget_krw:50000,step_limit:20000,active_min:720};
 assert.ok(validateDay(request,dataset,profiles,{allowShopping:true}).violations.some(v=>v.code==='budget_exceeded'));
});
