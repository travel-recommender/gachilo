import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {availability, validateDay} from './validate_real_schedule.mjs';
import {schedulableDetails} from '../backend/engine/schedulable.mjs';
import {calculateRealCandidates} from '../backend/engine/real_candidates.mjs';
import {mockLiveCheck} from '../backend/engine/live_check.mjs';
// This test exercises the pinned week-13 snapshot even when a newer catalog is active.
const dataset=JSON.parse(fs.readFileSync(new URL('../data/final/osaka_catalog_20261123.json',import.meta.url)));
const profiles=JSON.parse(fs.readFileSync(new URL('../data/final/osaka_profiles_20261123.json',import.meta.url)));
const record=id=>dataset.places.find(r=>r.place.place_id===id);
const check=(id,date)=>availability(record(id),date,profiles,{allowShopping:true});
const dates=['2026-11-16','2026-11-17','2026-11-18','2026-11-19'];
const ids=['osaka_006','osaka_draft_73505422b2e6','osaka_draft_316598fb77c9','branch_namba_walk',
 'branch_sushiro_namba_amza','branch_sushiro_umeda_chayamachi'];

test('only individually reviewed places become selectable and past snapshots remain unchanged',()=>{
 const old=JSON.parse(fs.readFileSync(new URL('../data/final/osaka_catalog_20261116.json',import.meta.url)));
 const oldProfiles=JSON.parse(fs.readFileSync(new URL('../data/final/osaka_profiles_20261116.json',import.meta.url)));
 const prior=schedulableDetails(dates,old,oldProfiles).placeIds;
 const current=schedulableDetails(dates,dataset,profiles).placeIds;
 assert.deepEqual(current.filter(id=>!prior.includes(id)).sort(),[...ids].sort());
 for(const row of dataset.places.filter(r=>!ids.includes(r.place.place_id)))
  assert.deepEqual(row,old.places.find(r=>r.place.place_id===row.place.place_id));
 for(const id of ids)assert.equal(record(id).review.schedule_ready,false);
});
test('museum Mondays and shopping-centre November closure are respected individually',()=>{
 assert.equal(check('osaka_draft_316598fb77c9','2026-11-16').eligible_for_model,false);
 assert.equal(check('osaka_draft_316598fb77c9','2026-11-17').cost_jpy,500);
 assert.equal(check('osaka_draft_316598fb77c9','2026-11-23').eligible_for_model,true);
 assert.equal(check('osaka_draft_316598fb77c9','2026-11-24').eligible_for_model,false);
 assert.equal(check('branch_namba_walk','2026-11-17').eligible_for_model,true);
 assert.equal(check('branch_namba_walk','2026-11-18').eligible_for_model,false);
 assert.ok(check('branch_namba_walk','2026-11-18').reasons.includes('closed_on_visit_date'));
 for(const id of ids)assert.equal(check(id,'2026-12-01').eligible_for_model,false);
});
test('shopping walk and sushi estimate disclose their actual scope',()=>{
 assert.equal(profiles.places.osaka_006.window_basis,'editorial_visit_window_not_business_hours');
 for(const id of ids.slice(4)){
  assert.equal(check(id,'2026-11-17').cost_jpy,1500);
  assert.match(check(id,'2026-11-17').cost_basis,/10접시/);
  assert.match(record(id).review.branch_collection.aliases,/초밥/);
  assert.equal(record(id).review.meal_role,'meal');
 }
});
test('reviewed sushi can be scheduled, and budget limits still apply',async()=>{
 const id='branch_sushiro_namba_amza';
 const request={startDate:'2026-11-17',endDate:'2026-11-17',exchange_rate:{krw_per_jpy:'9.5'},
   submissions:['a','b','c'].map(memberId=>({memberId,longlist:[id],picks:[id],must:id,veto:null,
    budgetPerDay:100000,stepLimit:20000,activeMin:720,tradeoffs:{pace:0.5,distance:0.5,spend:1}}))};
 const out=await calculateRealCandidates(request,dataset,profiles,{baseUrl:''},{liveCheck:mockLiveCheck('pass'),choose:null});
 for(const c of out.candidates)assert.ok(c.days.flatMap(d=>d.placeIds).includes(id));
 const low=validateDay({date:'2026-11-17',place_ids:[id],krw_per_jpy:'9.5',budget_krw:100,step_limit:20000,active_min:720},dataset,profiles,{allowShopping:true});
 assert.ok(low.violations.some(v=>v.code==='budget_exceeded'));
});
