import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadRuntimeInputs,availability,validateDay} from './validate_real_schedule.mjs';
import {calculateRealCandidates} from '../backend/engine/real_candidates.mjs';
import {mockLiveCheck} from '../backend/engine/live_check.mjs';
// 새로 검증한 장소가 배치되는지만 본다. 실시간 확인은 모두 통과, AI 채우기는 끈다
const offline={liveCheck:mockLiveCheck('pass'),choose:null};
const {dataset,profiles}=loadRuntimeInputs();
const evidence=JSON.parse(fs.readFileSync(new URL('../data/final/catalog_verification_20261104.json',import.meta.url)));
const byId=new Map(dataset.places.map(r=>[r.place.place_id,r]));
const available=(id,date='2026-11-04')=>availability(byId.get(id),date,profiles,{allowShopping:true});
const request=id=>({date:'2026-11-04',place_ids:[id],budget_krw:100000,step_limit:30000,active_min:900,krw_per_jpy:'9.0'});

test('newly verified places actually fit all three candidate strategies',async()=>{
 const promoted=Object.entries(evidence.updates).filter(([,e])=>e.status==='eligible_for_dated_demo');
 assert.equal(promoted.length,11);
 for(const [id] of promoted){
  assert.equal(available(id).eligible_for_model,true,id+': '+available(id).reasons);
  const result=validateDay(request(id),dataset,profiles,{allowShopping:true});
  assert.equal(result.passed_model_checks,true,id+': '+JSON.stringify(result.violations));
  const req={startDate:'2026-11-04',endDate:'2026-11-04',exchange_rate:{krw_per_jpy:'9.0'},
   submissions:['a','b'].map(memberId=>({memberId,longlist:[id],picks:[id],must:id,veto:null,budgetPerDay:100000,stepLimit:30000,activeMin:900,tradeoffs:{pace:1,distance:.5,spend:1}}))};
  const {candidates}=await calculateRealCandidates(req,dataset,profiles,{baseUrl:''},offline);
  assert.equal(candidates.length,3);
  for(const c of candidates)assert.deepEqual(c.days[0].placeIds,[id],id+' '+c.strategy);
 }
});
test('November HEP closure, reservation holds and review horizon are not bypassed',()=>{
 assert.equal(available('osaka_008','2026-11-18').eligible_for_model,true);
 assert.ok(available('osaka_008','2026-11-19').reasons.includes('closed_on_visit_date'));
 assert.equal(available('osaka_008','2026-11-20').eligible_for_model,true);
 assert.ok(available('osaka_002').reasons.includes('entry_time_reservation_required'));
 for(const id of ['osaka_draft_7c98da5a96f9','osaka_draft_9cd21dc062f7','osm_node_2546559085'])assert.equal(available(id).eligible_for_model,false);
 assert.equal(available('branch_komeda_namba_sennichimae','2026-11-03').eligible_for_model,false);
 assert.equal(available('branch_komeda_namba_sennichimae','2026-12-01').eligible_for_model,false);
});
test('branch hours, weekday differences, last orders and surcharge boundary survive normalization',()=>{
 assert.deepEqual(available('branch_komeda_namba_sennichimae').window,[480,1320,1320]);
 assert.deepEqual(available('branch_komeda_kitte_osaka').window,[480,1260,1230]);
 assert.equal(available('branch_doutor_umeda_city','2026-11-06').window[0],450);
 assert.equal(available('branch_doutor_umeda_city','2026-11-07').window[0],540);
 assert.equal(available('branch_doutor_umeda_city','2026-11-23').window[0],540);
 assert.equal(available('branch_matsuya_nankai_namba').window[1],1320);
 assert.equal(available('branch_marugame_umeda').window[2],1350);
});
test('public menu reference prices are estimates; branch-specific Komeda price stays distinct',async()=>{
 const cafe=validateDay(request('branch_doutor_shinsaibashi_station'),dataset,profiles,{allowShopping:true});
 assert.equal(cafe.items[0].cost_status,'estimate');
 assert.match(cafe.items[0].cost_basis,/지점/);
 assert.equal(validateDay(request('branch_komeda_namba_sennichimae'),dataset,profiles,{allowShopping:true}).items[0].cost_status,'known');
 for(const id of ['branch_starbucks_ebisubashi','branch_sushiro_namba_amza']){
  assert.equal(byId.get(id).place.cost,null);assert.equal(available(id).eligible_for_model,false);
 }
});
test('all new collected locations remain searchable but cannot be silently scheduled',()=>{
 assert.equal(dataset.places.length,238);assert.equal(new Set(byId.keys()).size,238);
 assert.equal(evidence.additions.length,13);
 for(const r of evidence.additions){
  const id=r.place.place_id;assert.ok(byId.has(id));assert.equal(available(id).eligible_for_model,false);
  assert.equal(validateDay(request(id),dataset,profiles,{allowShopping:true}).items.length,0);
 }
 assert.equal(byId.get('branch_kaldi_namba_city').place.category,'쇼핑');
 for(const r of dataset.places)assert.equal(r.review.schedule_ready,false);
});
