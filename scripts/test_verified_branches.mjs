import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {availability,validateDay,toEnginePlace} from './validate_real_schedule.mjs';
import {isMeal,buildSchedule} from '../backend/engine/schedule.ts';
import {travel} from '../backend/engine/routing.ts';
import {calculateRealCandidates} from '../backend/engine/real_candidates.mjs';
const read=f=>JSON.parse(fs.readFileSync(new URL('../data/final/'+f,import.meta.url)));
const data=read('osaka_catalog_20261026.json'), profiles=read('osaka_profiles_20261026.json');
const verification=read('branch_verification_20261026.json');
const records=new Map(data.places.map(r=>[r.place.place_id,r]));
const eligible=Object.values(verification.places).filter(v=>v.status==='eligible_for_dated_demo');
const held=Object.values(verification.places).filter(v=>v.status==='held');
const available=(id,date='2026-10-27')=>availability(records.get(id),date,profiles,{allowShopping:true});
const request=(ids,date='2026-10-27')=>({date,place_ids:ids,budget_krw:100000,step_limit:20000,active_min:720,krw_per_jpy:'8.6253'});
const enginePlace=(id,date='2026-10-27')=>toEnginePlace(records.get(id),available(id,date),'8.6253');

test('51 verified branches each pass dated scheduling and all three real candidate strategies',async()=>{
  assert.equal(eligible.length,51);
  for(const entry of eligible){
    const id=entry.place_id, check=available(id);
    assert.equal(check.eligible_for_model,true,id+': '+check.reasons);
    const day=validateDay(request([id]),data,profiles,{allowShopping:true});
    assert.equal(day.passed_model_checks,true,id+': '+JSON.stringify(day.violations));
    assert.deepEqual(day.items.map(p=>p.place_id),[id]);
    const req={startDate:'2026-10-27',endDate:'2026-10-27',exchange_rate:{krw_per_jpy:'8.6253',as_of:'2026-09-30'},
      submissions:['a','b'].map(memberId=>({memberId,longlist:[id],picks:[id],must:id,veto:null,budgetPerDay:100000,stepLimit:20000,activeMin:720,tradeoffs:{pace:1,distance:0.5,spend:1}}))};
    const {candidates}=await calculateRealCandidates(req,data,profiles,{baseUrl:''});
    assert.equal(candidates.length,3);
    for(const c of candidates) assert.deepEqual(c.days[0].placeIds,[id],id+' '+c.strategy);
  }
});

test('four held branches cannot be scheduled or silently priced as free',()=>{
  assert.equal(held.length,4);
  for(const e of held){
    assert.equal(available(e.place_id).eligible_for_model,false);
    const d=validateDay(request([e.place_id]),data,profiles,{allowShopping:true});
    assert.equal(d.items.length,0);assert.equal(d.passed_model_checks,false);
    assert.equal(records.get(e.place_id).place.cost,null);
  }
});

test('dated closures, holidays, entry tickets and review horizon remain enforced',()=>{
  const closed=(id,date,reason)=>assert.ok(available(id,date).reasons.includes(reason),id+' '+date);
  assert.equal(available('branch_551_honten','2026-11-03').eligible_for_model,true);
  closed('branch_551_honten','2026-11-10','closed_on_visit_date');
  closed('branch_551_honten','2026-11-17','closed_on_visit_date');
  closed('branch_551_namba_walk','2026-11-18','closed_on_visit_date');
  for(const id of ['branch_pokemon_osaka','branch_nintendo_osaka']){
    closed(id,'2026-11-17','closed_on_visit_date');
    for(const date of ['2026-11-18','2026-11-23','2026-11-30'])closed(id,date,'visit_confirmation_required');
  }
  closed('branch_nintendo_osaka','2026-10-31','visit_confirmation_required');
  closed('branch_nintendo_osaka','2026-11-03','visit_confirmation_required');
  closed('branch_daiso_shinsaibashi','2026-11-03','holiday_hours_unconfirmed');
  assert.equal(available('branch_daiso_shinsaibashi','2026-10-27').window[0],540);
  assert.equal(available('branch_daiso_shinsaibashi','2026-10-31').window[0],570);
  assert.equal(available('branch_hankyu_mens_osaka','2026-10-27').window[0],660);
  assert.equal(available('branch_hankyu_mens_osaka','2026-10-31').window[0],600);
  assert.equal(available('branch_donki_dotonbori','2026-11-06').window[0],540);
  assert.equal(available('branch_donki_dotonbori_midosuji','2026-11-19').window[0],540);
  closed('branch_gu_shinsaibashi','2026-12-01','outside_place_reviewed_date_range');
});

test('split lunch/dinner opening windows never schedule a visit across the break',()=>{
  const p=enginePlace('branch_fukutaro_umeda');
  assert.deepEqual(p.openingWindows,[[660,900,900],[1020,1380,1320]]);
  // A preceding activity finishes at 14:30; a 90-minute visit cannot bridge 15–17h.
  const before={...p,id:'fixture-before',name:'fixture',category:'culture',mealRole:undefined,stayMin:330,openingWindows:[[540,1260,1260]]};
  const selection=place=>({place,votes:1,mustOf:null,tier:'core',participants:[]});
  const day=buildSchedule([before,p].map(selection),1,{fillMeals:false}).plans[0];
  assert.ok(day.items.some(i=>i.place.id===p.id));
  for(const item of day.items.filter(i=>i.place.id===p.id))
    assert.ok(p.openingWindows.some(([o,c,l])=>item.startMin>=o && item.endMin<=c && item.startMin<=l));
  const result=validateDay(request([p.id]),data,profiles,{allowShopping:true});
  assert.equal(result.items[0].cost_status,'estimate');
  assert.match(result.items[0].cost_basis,/확정 메뉴 가격 아님/);
});

test('takeout is not a meal; last entry blocks an otherwise possible visit',()=>{
  assert.equal(isMeal(enginePlace('branch_551_takashimaya_osaka')),false);
  assert.equal(isMeal(enginePlace('branch_551_honten')),true);
  const p={...enginePlace('branch_gu_shinsaibashi'),openingWindows:[[540,1260,539]]};
  // The scheduler also protects against arrival after last entry, independent of closing time.
  const result=buildSchedule([{place:p,votes:1,mustOf:null,tier:'core',participants:[]}],1,{fillMeals:false});
  assert.equal(result.plans[0].items.length,0);
});

test('same-building transfer is explicit, and separate building wings are not conflated',()=>{
  const a=enginePlace('branch_gu_links_umeda'),b=enginePlace('branch_daiso_links_umeda');
  assert.equal(a.buildingId,b.buildingId);assert.ok(a.buildingId);
  assert.deepEqual(travel(a,b),{km:0,min:5,mode:'walk',walkKm:0,source:'indoor-estimate'});
  const north=enginePlace('branch_muji_grandfront'),south=enginePlace('branch_montbell_umekita');
  assert.notEqual(north.buildingId,south.buildingId);
  assert.notEqual(travel(north,south).source,'indoor-estimate');
});

test('shared candidate summary reports the same indoor transfer and estimated cost as its schedule',async()=>{
 const calculate=async ids=>calculateRealCandidates({startDate:'2026-10-27',endDate:'2026-10-27',exchange_rate:{krw_per_jpy:'8.6253',as_of:'2026-09-30'},
   submissions:['a','b'].map(memberId=>({memberId,longlist:ids,picks:ids,must:null,veto:null,budgetPerDay:100000,stepLimit:20000,activeMin:720,tradeoffs:{pace:1,distance:0.5,spend:1}}))},data,profiles,{baseUrl:''});
 const ids=['branch_gu_links_umeda','branch_daiso_links_umeda'];
 for(const c of (await calculate(ids)).candidates){
   assert.deepEqual(new Set(c.days[0].placeIds),new Set(ids));
   assert.equal(c.days[0].items[1].startMin-c.days[0].items[0].endMin,5);
   assert.equal(c.metrics.walkStepsPerDay,0);
   assert.match(c.summary,/같은 건물 내부 이동 1구간은 각 5분 추정/);
   assert.doesNotMatch(c.summary,/시설 내부 이동은 포함하지/);
 }
 for(const c of (await calculate(['branch_fukutaro_umeda'])).candidates){
   assert.match(c.summary,/공식 평균예산 추정/);
   assert.match(c.days[0].items[0].reason,/공식 평균예산/);
 }
});
