import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRuntimeInputs, availability} from './validate_real_schedule.mjs';
import {calculateRealCandidates} from '../backend/engine/real_candidates.mjs';
import {mockLiveCheck} from '../backend/engine/live_check.mjs';

const {dataset,profiles}=loadRuntimeInputs();
const bistro='osaka_draft_89458a1abeda', sushi='osaka_draft_7d6ecfb032b6', casa='osaka_draft_ff20bd4cf6b7', rikuro='branch_rikuro_daimaru_umeda', ramen='osaka_draft_1cdebcaa6534', bee='osaka_draft_94d63b518da4';
const record=id=>dataset.places.find(r=>r.place.place_id===id);
const check=(id,date)=>availability(record(id),date,profiles,{allowShopping:true});

test('reviewed meals use correct opening dates and stay blocked outside review',()=>{
 assert.equal(check(bistro,'2026-11-25').eligible_for_model,true);
 assert.equal(check(bistro,'2026-11-28').eligible_for_model,false);
 assert.equal(check(bistro,'2026-11-19').eligible_for_model,false);
 assert.deepEqual(check(bistro,'2026-11-25').window,[690,840,810]);
 assert.deepEqual(check(sushi,'2026-11-25').window,[660,1260,1200]);
 assert.deepEqual(check(casa,'2026-11-25').window,[420,720,720]);
 assert.equal(check(rikuro,'2026-11-25').eligible_for_model,true);
 assert.equal(record(rikuro).review.meal_role,'snack');
 assert.equal(record(rikuro).review.dated_verification.coordinates.kind,'reviewed_building_reference_not_entrance');
 assert.equal(check(ramen,'2026-11-25').eligible_for_model,true);
 assert.match(record(ramen).review.branch_collection.aliases,/라멘/);
 assert.equal(check(bee,'2026-11-25').eligible_for_model,false);
 assert.ok(check(bee,'2026-11-25').reasons.includes('official_indefinite_closure'));
 assert.ok(!check(bee,'2026-11-25').reasons.includes('google_maps_permanently_closed'));
});

test('each reviewed meal can be scheduled through all three strategies',async()=>{
 for(const id of [bistro,sushi,casa,rikuro,ramen]){
  const request={startDate:'2026-11-25',endDate:'2026-11-25',exchange_rate:{krw_per_jpy:'9.5',as_of:'2026-11-24'},
   submissions:['a','b'].map(memberId=>({memberId,longlist:[id],picks:[id],must:id,veto:null,
     budgetPerDay:100000,stepLimit:20000,activeMin:720,tradeoffs:{pace:1,distance:0.5,spend:1}}))};
  const {candidates}=await calculateRealCandidates(request,dataset,profiles,{baseUrl:''},
   {liveCheck:mockLiveCheck('pass'),choose:null});
  assert.equal(candidates.length,3);
  for(const candidate of candidates) assert.ok(candidate.days[0].placeIds.includes(id),candidate.strategy);
 }
});
