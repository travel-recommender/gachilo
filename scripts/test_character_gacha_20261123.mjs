import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {availability, loadRuntimeInputs, validateDay} from './validate_real_schedule.mjs';
import {calculateRealCandidates} from '../backend/engine/real_candidates.mjs';
import {mockLiveCheck} from '../backend/engine/live_check.mjs';
import {schedulableDetails} from '../backend/engine/schedulable.mjs';
const {dataset,profiles}=loadRuntimeInputs();
const prior=JSON.parse(fs.readFileSync(new URL('../data/final/osaka_catalog_20261123.json',import.meta.url)));
const priorProfiles=JSON.parse(fs.readFileSync(new URL('../data/final/osaka_profiles_20261123.json',import.meta.url)));
const ids=['gacha_shinsaibashi_parco','gacha_hep_five','chiikawa_land_umeda'];
const get=id=>dataset.places.find(x=>x.place.place_id===id);
const check=(id,date)=>availability(get(id),date,profiles,{allowShopping:true});
test('new catalog keeps prior records and exposes three distinct shops',()=>{
 assert.equal(dataset.places.length,prior.places.length+2);
 for(const row of prior.places){
  if(row.place.place_id==='osm_node_2546559085') { assert.equal(get(row.place.place_id),undefined); continue; }
  const actual=get(row.place.place_id); assert.ok(actual);
  if(!['osaka_004','branch_kiddyland_umeda','branch_kura_sennichimae','branch_kura_dotonbori','branch_wanaka_sennichimae','branch_wanaka_dotonbori'].includes(row.place.place_id))assert.deepEqual(actual,row);
 }
 for(const id of ids){
  const row=get(id);assert.equal(row.place.category,'쇼핑');assert.equal(row.place.cost,null);
  assert.match(row.review.branch_collection.aliases,/가챠|치이카와/);
  assert.equal(row.review.dated_verification.coordinates.kind,'reviewed_building_reference_not_entrance');
  assert.match(row.field_sources.cost.note,/개인 구매액/);
  assert.equal(check(id,'2026-11-17').eligible_for_model,true);
 }
 const selected=schedulableDetails(['2026-11-16','2026-11-17','2026-11-18','2026-11-19'],dataset,profiles).placeIds;
 ids.forEach(id=>assert.ok(selected.includes(id)));
});
test('Kura branch estimates are explicit and budget limits remain enforced',()=>{
 for (const id of ['branch_kura_sennichimae','branch_kura_dotonbori']){
  const c=check(id,'2026-11-17'); assert.equal(c.eligible_for_model,true);assert.equal(c.cost_jpy,1450);
  assert.match(c.cost_basis,/10개 가정/);assert.match(get(id).review.branch_collection.aliases,/초밥/);
  const low=validateDay({date:'2026-11-17',place_ids:[id],krw_per_jpy:'9.5',budget_krw:100,step_limit:20000,active_min:720},dataset,profiles,{allowShopping:true});
  assert.ok(low.violations.some(v=>v.code==='budget_exceeded'));
 }
 assert.equal(check('branch_kura_dotonbori','2026-11-23').eligible_for_model,false);
});
test('Amerikamura is a street walk with no invented shop-wide opening hours',()=>{
 assert.equal(check('osaka_004','2026-11-17').eligible_for_model,true);
 assert.equal(profiles.places.osaka_004.window_basis,'editorial_visit_window_not_business_hours');
 assert.match(get('osaka_004').place.opening_hours,/개별 상점/);
 assert.equal(check('osaka_004','2026-12-01').eligible_for_model,false);
});
test('closed main branch is absent in new catalog while the annex and old snapshot remain',()=>{
 assert.ok(prior.places.find(r=>r.place.place_id==='osm_node_2546559085'));
 assert.equal(get('osm_node_2546559085'),undefined);
 assert.ok(get('osaka_026'));
});
test('takoyaki aliases do not silently promote places with unverified prices',()=>{
 for(const id of ['branch_wanaka_sennichimae','branch_wanaka_dotonbori']){
  assert.match(get(id).review.branch_collection.aliases,/타코야끼/);
  assert.equal(check(id,'2026-11-17').eligible_for_model,false);
 }
});
test('official 18 November and 19 November closures apply per date',()=>{
 assert.equal(priorProfiles.places.branch_kiddyland_umeda.exceptions['2026-11-18'],undefined);
 assert.ok(check('branch_kiddyland_umeda','2026-11-18').reasons.includes('closed_on_visit_date'));
 assert.ok(check('chiikawa_land_umeda','2026-11-18').reasons.includes('closed_on_visit_date'));
 assert.ok(check('gacha_hep_five','2026-11-19').reasons.includes('closed_on_visit_date'));
 assert.equal(check('branch_kiddyland_umeda','2026-11-17').eligible_for_model,true);
 assert.equal(check('gacha_hep_five','2026-11-18').eligible_for_model,true);
 assert.equal(check('gacha_shinsaibashi_parco','2026-12-01').eligible_for_model,false);
});
test('each new store can be included in all candidate strategies',async()=>{
 for (const id of ids){
  const request={startDate:'2026-11-17',endDate:'2026-11-17',exchange_rate:{krw_per_jpy:'9.5'},
   submissions:['a','b','c'].map(memberId=>({memberId,longlist:[id],picks:[id],must:id,veto:null,
    budgetPerDay:100000,stepLimit:20000,activeMin:720,tradeoffs:{pace:0.5,distance:0.5,spend:1}}))};
  const result=await calculateRealCandidates(request,dataset,profiles,{baseUrl:''},{liveCheck:mockLiveCheck('pass'),choose:null});
  for(const c of result.candidates)assert.ok(c.days.flatMap(day=>day.placeIds).includes(id),id+' '+c.strategy);
 }
});
