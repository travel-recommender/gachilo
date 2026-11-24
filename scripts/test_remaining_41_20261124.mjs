import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRuntimeInputs,availability} from './validate_real_schedule.mjs';
import {calculateRealCandidates} from '../backend/engine/real_candidates.mjs';
import {mockLiveCheck} from '../backend/engine/live_check.mjs';
const {dataset,profiles}=loadRuntimeInputs();
const get=id=>dataset.places.find(x=>x.place.place_id===id);
const check=(id,date)=>availability(get(id),date,profiles,{allowShopping:true});

test('special tea ceremony is only available on verified date, with full entrance price',()=>{
 const id='osaka_draft_a270504b6cd8';
 for(const day of ['2026-11-25','2026-11-27','2026-11-28','2026-12-01']) assert.equal(check(id,day).eligible_for_model,false,day);
 const visit=check(id,'2026-11-26');
 assert.equal(visit.eligible_for_model,true);assert.equal(visit.cost_jpy,1800);
 assert.deepEqual(visit.window,[600,960,930]);
 assert.match(get(id).review.visit_notice,/임시휴업/);
});

test('Nintendo and Pokemon are tentative only after Nov 24, and ticket notices remain visible',()=>{
 for(const id of ['branch_pokemon_osaka','branch_nintendo_osaka']){
  assert.equal(check(id,'2026-11-17').eligible_for_model,false);
  assert.equal(check(id,'2026-11-23').eligible_for_model,false);
  assert.equal(check(id,'2026-12-01').eligible_for_model,false);
  for(const date of ['2026-11-25','2026-11-26','2026-11-27','2026-11-28']){
   assert.equal(check(id,date).eligible_for_model,true,id+date);
   assert.equal(check(id,date).reservation_required,true,id+date);
  }
  assert.match(get(id).review.reservation_notice,/직접 정리권/);
 }
});

test('museum requires advance booking and fits only its exact published tour windows',()=>{
 const id='osaka_draft_50b7a6cc608f';
 assert.equal(check(id,'2026-11-26').eligible_for_model,true);
 assert.equal(check(id,'2026-11-26').reservation_required,true);
 assert.deepEqual(check(id,'2026-11-26').windows,[[600,650,600],[660,710,660],[780,830,780],[840,890,840],[900,950,900]]);
 assert.equal(check(id,'2026-11-28').eligible_for_model,false);
 assert.equal(check(id,'2026-12-01').eligible_for_model,false);
 assert.match(get(id).review.reservation_notice,/2일 전/);
});

test('reviewed tea and ticketed shop can be included in all three mock strategies',async()=>{
 const date='2026-11-26';
 for(const id of ['osaka_draft_a270504b6cd8','branch_pokemon_osaka','branch_nintendo_osaka','osaka_draft_50b7a6cc608f']){
  const req={startDate:date,endDate:date,exchange_rate:{krw_per_jpy:'8.6253',as_of:'2026-11-24'},
   submissions:['a','b'].map(memberId=>({memberId,longlist:[id],picks:[id],must:id,veto:null,budgetPerDay:100000,stepLimit:20000,activeMin:720,tradeoffs:{pace:1,distance:0.5,spend:1}}))};
  const {candidates}=await calculateRealCandidates(req,dataset,profiles,{baseUrl:''},{liveCheck:mockLiveCheck('pass'),choose:null});
  assert.equal(candidates.length,3);for(const c of candidates)assert.deepEqual(c.days[0].placeIds,[id],id+': '+c.strategy);
 }
});
