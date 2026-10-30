import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateRealCandidates} from './real_candidates.mjs';
import {loadInputs} from '../../scripts/validate_real_schedule.mjs';
const {dataset, profiles} = loadInputs();
const request = (ids, extra = {}) => ({startDate:'2026-10-01',endDate:'2026-10-01',
  exchange_rate:{krw_per_jpy:'9.5',as_of:'2026-09-30'},
  submissions:['private-a','private-b','private-c'].map(memberId => ({memberId,longlist:ids,picks:ids,
    must:null,veto:null,budgetPerDay:100000,stepLimit:20000,activeMin:720,
    tradeoffs:{pace:1,distance:0.5,spend:1},...extra}))});
const run = r => calculateRealCandidates(r,dataset,profiles,{baseUrl:''});


test('planning counts only unplaced non-veto choices and retains dated FX provenance',async()=>{
  const r=request(['osaka_012','osaka_001','osaka_015']);
  r.startDate='2026-10-06';r.endDate='2026-10-07';
  r.exchange_rate.source='synthetic test source';
  for(const c of (await run(r)).candidates){
    assert.equal(c.planning.scheduled_count,c.days.flatMap(d=>d.placeIds).length);
    assert.equal(c.planning.unplaced_count,1);
    assert.equal(c.planning.status,'needs_review');
    assert.equal(c.planning.schedule_ready,false);
    assert.equal(c.planning.reason_aggregation,'common_across_dates');
    assert.deepEqual(c.planning.exchange_rate,r.exchange_rate);
    // The museum closed on the first day but scheduled on the second is not an exclusion.
    assert.equal(c.planning.exclusion_reason_counts.closed_on_visit_date,undefined);
    assert.ok(Object.keys(c.planning.exclusion_reason_counts).length>0);
  }
  for(const c of (await run(request(['osaka_015']))).candidates){
    assert.equal(c.planning.status,'model_checks_passed');
    assert.equal(c.planning.unplaced_count,0);
    assert.deepEqual(c.planning.exclusion_reason_counts,{});
  }
  const long=request(['osaka_015']);long.endDate='2026-10-02';
  for(const c of (await run(long)).candidates){
    assert.equal(c.planning.status,'needs_review');
    assert.equal(c.planning.empty_day_count,1);
  }
});

test('shared Place conversion preserves shopping policies and dated price exceptions',async()=>{
  const {toEnginePlace}=await import('../../scripts/validate_real_schedule.mjs');
  const base=dataset.places.find(r=>r.place.place_id==='osaka_015');
  for(const change of [
    r=>r.place.category='쇼핑',
    r=>r.place.name_ko='구로몬시장',
    r=>r.review.planning_cost_policy='shopping_spend_excluded',
    r=>r.review.planning_cost_policy='exclude_personal_shopping_spend',
  ]){
    const record=structuredClone(base);change(record);
    const converted=toEnginePlace(record,{window:[540,1200,1170],cost_jpy:5000},'9.5');
    assert.equal(converted.cost,0);
    assert.equal(converted.id,base.place.place_id);
  }
  assert.equal(toEnginePlace(base,{window:[540,1200,1170],cost_jpy:123},'9.5').cost,1169);
  assert.equal(toEnginePlace(base,{window:[540,1200,1170],cost_jpy:0},'9.5').cost,0);
});


test('exclusion diagnostics distinguish changing dates, common blockers and ordinary missing must',async()=>{
  const fixture=structuredClone(profiles);
  fixture.places.osaka_009={...fixture.places.osaka_009,exceptions:{
    '2026-10-01':{closed:true},'2026-10-02':{closed:false,cost_jpy:100000},
  }};
  const r=request(['osaka_009','osaka_015'],{must:'osaka_009',budgetPerDay:0});
  r.endDate='2026-10-02';
  for(const c of (await calculateRealCandidates(r,dataset,fixture,{baseUrl:''})).candidates){
    assert.deepEqual(c.planning.exclusion_reason_counts,{date_conditions_vary:1});
    assert.equal(c.planning.must_veto_conflict_count,0);
    assert.equal(c.planning.must_satisfied,false);
    assert.match(c.summary,/꼭 가는 장소 조건이 충족되지/);
    assert.doesNotMatch(c.summary,/충돌/);
  }
  fixture.places.osaka_009.exceptions['2026-10-02'].closed=true;
  for(const c of (await calculateRealCandidates(r,dataset,fixture,{baseUrl:''})).candidates){
    assert.deepEqual(c.planning.exclusion_reason_counts,{closed_on_visit_date:1});
  }
});
