import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRuntimeInputs, availability} from './validate_real_schedule.mjs';
import {calculateRealCandidates} from '../backend/engine/real_candidates.mjs';
import {mockLiveCheck} from '../backend/engine/live_check.mjs';
import {readFileSync} from 'node:fs';

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

test('remaining food review honors split hours, closed days, snack role and expiry',()=>{
 const kirinji='osaka_draft_98a4211ed755', kadoya='osaka_draft_3b1acd991668';
 const papalina='osaka_draft_f8831852f028', maywinds='osaka_draft_d996a4118ab0', kitchen='osaka_draft_f729469c78c5';
 const snacks=['branch_wanaka_dotonbori','branch_wanaka_sennichimae'];
 assert.deepEqual(check(kirinji,'2026-11-25').windows,[[690,990,990],[1080,1320,1320]]);
 assert.equal(check(kadoya,'2026-11-25').eligible_for_model,false);
 assert.equal(check(kadoya,'2026-11-26').eligible_for_model,true);
 assert.equal(check(papalina,'2026-11-24').eligible_for_model,false);
 assert.equal(check(papalina,'2026-11-25').eligible_for_model,true);
 assert.equal(check(maywinds,'2026-11-29').eligible_for_model,false);
 assert.equal(check(kitchen,'2026-11-25').eligible_for_model,false);
 assert.equal(check(kitchen,'2026-11-26').eligible_for_model,true);
 for(const id of snacks){
  assert.equal(check(id,'2026-11-25').eligible_for_model,true);
  assert.equal(check(id,'2026-12-01').eligible_for_model,false);
  assert.equal(record(id).review.meal_role,'snack');
  assert.match(record(id).review.dated_verification.cost_basis,/참고/);
 }
});

test('reported closed ramen branch is removed only from new snapshot',()=>{
 const id='osaka_draft_20aa5444aadd';
 const old=JSON.parse(readFileSync(new URL('../data/final/osaka_catalog_character_20261123.json',import.meta.url)));
 assert.ok(old.places.some(r=>r.place.place_id===id));
 assert.equal(record(id),undefined);
 assert.equal(profiles.places[id],undefined);
 assert.ok(dataset.retired_records.some(r=>r.place_id===id && r.source_urls.length>=2));
});

test('second food review respects identity, meal purpose and opening limits',()=>{
 const mercy='osaka_draft_c341bbd2440a', saijiki='osaka_draft_7eda017e1ded';
 const coco='branch_coco_namba_ebisubashi', rikuroNamba='branch_rikuro_namba_honten';
 const beard='branch_beardpapa_namba_walk', mizukake='branch_mizukakechaya_namba';
 const endo='osaka_draft_3d97f36846d0', vie='branch_viedefrance_bentencho';
 for(const id of [mercy,saijiki,coco,rikuroNamba,beard,mizukake,endo,vie]){
  assert.equal(check(id,'2026-11-25').eligible_for_model,true,id);
  assert.equal(check(id,'2026-12-01').eligible_for_model,false,id);
  assert.ok(record(id).review.dated_verification.cost_basis);
 }
 assert.equal(check(mercy,'2026-11-28').eligible_for_model,false);
 assert.equal(check(saijiki,'2026-11-30').eligible_for_model,false);
 assert.deepEqual(check(mizukake,'2026-11-25').window,[960,1380,1350]);
 assert.equal(record(beard).review.meal_role,'snack');
 assert.equal(record(rikuroNamba).review.meal_role,'snack');
 assert.equal(record(vie).review.meal_role,'snack');
 assert.equal(check(endo,'2026-11-29').eligible_for_model,false);
 assert.equal(record(beard).review.dated_verification.coordinates.kind,'map_listing_reference_not_entrance');
 assert.match(record(mercy).review.notes.join(' '),/2-4-5/);
});

test('each reviewed meal can be scheduled through all three strategies',async()=>{
 for(const id of [bistro,sushi,casa,rikuro,ramen,'osaka_draft_c341bbd2440a','osaka_draft_7eda017e1ded',
   'branch_rikuro_namba_honten','branch_coco_namba_ebisubashi','branch_beardpapa_namba_walk','branch_mizukakechaya_namba',
   'osaka_draft_3d97f36846d0','branch_viedefrance_bentencho']){
  const request={startDate:'2026-11-25',endDate:'2026-11-25',exchange_rate:{krw_per_jpy:'9.5',as_of:'2026-11-24'},
   submissions:['a','b'].map(memberId=>({memberId,longlist:[id],picks:[id],must:id,veto:null,
     budgetPerDay:100000,stepLimit:20000,activeMin:720,tradeoffs:{pace:1,distance:0.5,spend:1}}))};
  const {candidates}=await calculateRealCandidates(request,dataset,profiles,{baseUrl:''},
   {liveCheck:mockLiveCheck('pass'),choose:null});
  assert.equal(candidates.length,3);
  for(const candidate of candidates) assert.ok(candidate.days[0].placeIds.includes(id),candidate.strategy);
 }
});
