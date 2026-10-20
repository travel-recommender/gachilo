import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateRealCandidates} from './real_candidates.mjs';
import {allPlaces, findPlace, withPlaceCatalog} from './places.ts';
import {loadInputs, availability, validateDay} from '../../scripts/validate_real_schedule.mjs';
const {dataset, profiles} = loadInputs();
const request = (ids, extra = {}) => ({startDate:'2026-10-01',endDate:'2026-10-01',
  exchange_rate:{krw_per_jpy:'9.5',as_of:'2026-09-30'},
  submissions:['private-a','private-b','private-c'].map(memberId => ({memberId,longlist:ids,picks:ids,
    must:null,veto:null,budgetPerDay:100000,stepLimit:20000,activeMin:720,
    tradeoffs:{pace:1,distance:0.5,spend:1},...extra}))});
const run = r => calculateRealCandidates(r,dataset,profiles,{baseUrl:''});

test('actual IDs, times, dates, metrics and private projection are independently verifiable',async()=>{
  const r=request(['osaka_009','osaka_015','osaka_017']);
  const {candidates}=await run(r);
  assert.deepEqual(candidates.map(c=>c.strategy),['average','least_misery','fairness']);
  for (const c of candidates) {
    const d=c.days[0]; assert.ok(d.placeIds.length>1);
    assert.ok(d.placeIds.every(id=>r.submissions[0].picks.includes(id)));
    const v=validateDay({date:d.date,place_ids:d.placeIds,budget_krw:100000,step_limit:20000,active_min:720,krw_per_jpy:'9.5'},dataset,profiles,{allowShopping:true,candidateMetrics:true,distanceWeight:1.2});
    assert.equal(v.passed_model_checks,true);
    assert.deepEqual(d.items.map(i=>[i.placeId,i.startMin,i.endMin]),v.items.map(i=>[i.place_id,i.start_min,i.end_min]));
    assert.equal(d.metrics.walkSteps,v.totals.estimated_steps);
    assert.equal(d.metrics.costKrw,v.totals.selected_admission_and_menu_krw);
    assert.equal(d.metrics.totalKm,Math.round(v.totals.estimated_total_km*100)/100);
    assert.ok(d.items.every(i=>!i.aiAdded&&!i.filled&&i.source==='selected'));
    for(const key of ['private-a','private-b','private-c','budgetPerDay','participants','mustOf']) assert.ok(!JSON.stringify(c).includes(key));
  }
});

test('date closures and unreviewed records cannot bypass the real day validator',async()=>{
  const r=request(['osaka_012','osaka_001','osaka_002','osaka_015']);
  r.startDate='2026-10-06';r.endDate='2026-10-07';
  for(const c of (await run(r)).candidates){
    assert.ok(!c.days[0].placeIds.includes('osaka_012'));
    assert.ok(c.days[1].placeIds.includes('osaka_012'));
    const ids=c.days.flatMap(d=>d.placeIds);
    assert.equal(ids.length,new Set(ids).size);
    assert.ok(!ids.includes('osaka_001')&&!ids.includes('osaka_002'));
    for(const d of c.days) for(const id of d.placeIds){
      assert.ok(availability(dataset.places.find(r=>r.place.place_id===id),d.date,profiles,{allowShopping:true}).eligible_for_model);
    }
    assert.match(c.summary,/미배치/);
  }
});

test('veto, zero budget and the weakest time/step limit remain hard constraints',async()=>{
  const r=request(['osaka_009','osaka_015'],{budgetPerDay:0,must:'osaka_009'});
  r.submissions[1]={...r.submissions[1],picks:['osaka_015'],must:null,veto:'osaka_009'};
  for(const c of (await run(r)).candidates){
    assert.deepEqual(c.days[0].placeIds,['osaka_015']);assert.equal(c.metrics.costKrwPerDay,0);
    assert.match(c.summary,/꼭 가기.*거부.*충돌/);
    assert.doesNotMatch(c.summary,/꼭 가는 장소 조건이 충족되지/);
    assert.equal(c.planning.must_veto_conflict_count,1);
    assert.equal(c.planning.must_satisfied,false);
    assert.equal(c.planning.status,'needs_review');
    assert.ok(!JSON.stringify(c).includes('osaka_009'));
  }
  r.submissions[1].activeMin=1;
  await assert.rejects(run(r),/NO_SCHEDULABLE_REAL_CANDIDATE/);
});

test('empty selections and wholly unreviewed dates fail instead of saving empty candidates',async()=>{
  await assert.rejects(run(request([])),/NO_SCHEDULABLE_REAL_CANDIDATE/);
  const r=request(['osaka_015']);r.startDate=r.endDate='2026-12-01';
  await assert.rejects(run(r),/NO_SCHEDULABLE_REAL_CANDIDATE/);
});

test('dated free admission and shopping exclusion keep their cost meaning',async()=>{
  const r=request(['osaka_draft_ce3b8d452a0e'],{budgetPerDay:0});r.startDate=r.endDate='2026-10-03';
  for(const c of (await run(r)).candidates) assert.equal(c.metrics.costKrwPerDay,0);
  for(const c of (await run(request(['osaka_022'],{budgetPerDay:0}))).candidates){
    assert.equal(c.metrics.costKrwPerDay,0);assert.match(c.days[0].items[0].reason,/쇼핑 구매액.*제외/);
    assert.ok(!c.days[0].items[0].reason.includes('무료'));
  }
});

test('catalogue scopes isolate overlapping calculations and restore demo lookups on failure',async()=>{
  const demo=allPlaces();assert.ok(findPlace('glico'));
  await Promise.all(['a','b'].map(id=>withPlaceCatalog([{id}],async()=>{
    await Promise.resolve();assert.equal(findPlace('glico'),undefined);assert.deepEqual(allPlaces(),[{id}]);
  })));
  assert.throws(()=>withPlaceCatalog([],()=>{assert.deepEqual(allPlaces(),[]);throw Error('failed');}));
  assert.strictEqual(allPlaces(),demo);assert.ok(findPlace('glico'));
});

test('selected-only catalogue never adds demo fillers, even with a 30-day trip',async()=>{
  const r=request(['osaka_015']);r.endDate='2026-10-30';
  for(const c of (await run(r)).candidates){
    assert.deepEqual(c.days.flatMap(d=>d.placeIds),['osaka_015']);assert.equal(c.days.length,30);
    assert.equal(c.metrics.costKrwPerDay,0);assert.match(c.summary,/비어 있는 날짜가 29일/);
  }
});

test('real strategy selection is not three renamed average results; pace also changes capacity',async()=>{
  // Synthetic records are in-memory test fixtures, never promoted to the real catalogue.
  const records=['문화','문화','문화','자연','자연','명소','명소'].map((category,i)=>{
    const r=structuredClone(dataset.places.find(r=>r.place.place_id==='osaka_015'));
    Object.assign(r.place,{place_id:String(i),name_ko:'fixture-'+i,category,cost:[2000,3000,5000,7000,0,3000,7000][i],
      latitude:34.6,longitude:135.5,stay_min:30});
    r.review.stay_policy.representative=30;return r;
  });
  const fixtureProfiles={...profiles,places:Object.fromEntries(records.map(r=>[r.place.place_id,{window:[540,1260,1230]}]))};
  const r=request([]);r.exchange_rate.krw_per_jpy='1';
  const picks=[['1','3','4'],['2','5','6'],['0','1','4','5']];
  r.submissions.forEach((s,i)=>Object.assign(s,{picks:picks[i],budgetPerDay:[11000,10000,17000][i],tradeoffs:{pace:0,distance:0.5,spend:1}}));
  const runFixture=()=>calculateRealCandidates(r,{places:records},fixtureProfiles,{baseUrl:''});
  const low=await runFixture();
  assert.deepEqual(low.candidates.map(c=>c.days[0].placeIds),[['1','4'],['1','0'],['1','4']]);
  r.submissions.forEach(s=>s.tradeoffs.pace=1);
  const high=await runFixture();
  assert.ok(high.candidates[0].days[0].placeIds.length>low.candidates[0].days[0].placeIds.length);
});
