import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPrecheck, precheckPlaces} from './place_precheck.mjs';
import {calculateRealCandidates} from './real_candidates.mjs';
import {loadInputs} from '../../scripts/validate_real_schedule.mjs';
const {dataset, profiles} = loadInputs();
const ids = ['osaka_009', 'osaka_015'], dates = ['2026-10-01', '2026-10-02'];
const context = () => ({ids, dates, dataset, profiles,
  live: {source:'google_places',checked_on:'2026-10-01',fetched:0,reused:0,
    verdicts:new Map(ids.flatMap(id=>dates.map(d=>[`${id}|${d}`,[]])))}});
const response = checks => ({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({checks})}}]})});

test('matching response records AI comparison, never leaks private choices or key',async()=>{
 const c=context();let n=0;
 const out=await precheckPlaces(c,{key:'test-secret-never-an-argument',fetchImpl:async (url,init)=>{
  n++;assert.equal(init.redirect,'error');assert.ok(url.startsWith('https://factchat-cloud.mindlogic.ai/'));
  const msg=JSON.parse(init.body).messages[1].content;
  assert.ok(!msg.includes('osaka_009'));assert.ok(!msg.includes('test-secret-never-an-argument'));
  const input=JSON.parse(msg);assert.equal(input.rows.length,2);assert.deepEqual(input.rows[0].dates,dates);
  return response(buildPrecheck(c).expected);
 }});
 assert.equal(n,1);assert.equal(out.audit.source,'somsom');assert.equal(out.audit.status,'matched');
 assert.equal(out.audit.place_date_count,4);assert.equal(out.audit.allowed_place_date_count,4);
 assert.match(out.audit.evidence_digest,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(out).includes('test-secret'));
});

test('model disagreement cannot unblock known closures or reject existing valid choices',async()=>{
 const c=context();c.live.verdicts.set('osaka_009|2026-10-01',['live_closed_on_visit_date']);
 const expected=buildPrecheck(c).expected;
 const a=await precheckPlaces(c,{key:'k',fetchImpl:async()=>response(expected.map(()=>true))});
 assert.equal(a.audit.source,'rule');assert.equal(a.audit.reason_code,'disagreement');
 assert.equal(a.audit.allowed_place_date_count,3);assert.equal(a.audit.rejected_place_date_count,1);
 assert.deepEqual(c.live.verdicts.get('osaka_009|2026-10-01'),['live_closed_on_visit_date']);
 assert.equal('allowed' in a,false);assert.equal('rejected' in a,false);
});

test('invalid responses fall back without approving AI or stopping candidate calculation',async()=>{
 const c=context();
 for(const content of ['not JSON','{"checks":[true]}','{"checks":["true","true"]}',
    '{"checks":[true,true],"message":"safe"}']){
   const out=await precheckPlaces(c,{key:'k',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content}}]})})});
   assert.equal(out.audit.source,'rule');assert.equal(out.audit.status,'fallback');assert.equal(out.audit.reason_code,'invalid_response');
 }
});

test('missing key, network error, timeout, oversized input and mocks are truthfully distinguished',async()=>{
 const c=context();
 assert.equal((await precheckPlaces(c,{key:'',fetchImpl:()=>assert.fail('no request')})).audit.reason_code,'unavailable');
 assert.equal((await precheckPlaces(c,{key:'k',fetchImpl:async()=>({ok:false})})).audit.reason_code,'unavailable');
 const timeout=await precheckPlaces(c,{key:'k',timeoutMs:5,fetchImpl:(_u,init)=>new Promise((_r,reject)=>init.signal.addEventListener('abort',()=>reject(Error('private'))))});
 assert.equal(timeout.audit.reason_code,'timeout');
 c.ids=Array.from({length:501},(_,i)=>`unknown-${i}`);
 const big=await precheckPlaces(c,{key:'k',fetchImpl:()=>assert.fail('oversized request')});
 assert.equal(big.audit.reason_code,'input_limit');assert.equal(big.audit.source,'rule');
 const mock=context();mock.live.source='mock';
 assert.equal((await precheckPlaces(mock,{fetchImpl:()=>assert.fail('no paid call')})).audit.source,'mock');
});

test('AI_MOCK with a real live source skips the AI request and records the existing fallback',async()=>{
 const previous=process.env.AI_MOCK;
 process.env.AI_MOCK='1';
 try {
  const out=await precheckPlaces(context(),{key:'test',fetchImpl:()=>assert.fail('no paid call')});
  assert.equal(out.audit.source,'rule');
  assert.equal(out.audit.status,'fallback');
  assert.equal(out.audit.reason_code,'unavailable');
 } finally {
  if(previous===undefined) delete process.env.AI_MOCK; else process.env.AI_MOCK=previous;
 }
});

test('routing preparation overlaps precheck but scheduling waits for precheck', {timeout:5000}, async()=>{
 const events=[];
 let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const request={startDate:dates[0],endDate:dates[0],exchange_rate:{krw_per_jpy:'9.5',as_of:'2026-09-30'},
  submissions:['a','b'].map(memberId=>({memberId,longlist:ids,picks:ids,must:ids[0],veto:null,
   budgetPerDay:100000,stepLimit:20000,activeMin:720,tradeoffs:{pace:1,distance:0.5,spend:1}}))};
 const result=await calculateRealCandidates(request,dataset,profiles,{baseUrl:'http://routing.invalid',
  fetchImpl:async()=>{events.push('routing');release();return {ok:false};}}, {
  liveCheck:async reqs=>({source:'google_places',checked_on:'2026-10-01',fetched:0,reused:0,
   verdicts:new Map(reqs.map(r=>[`${r.record.place.place_id}|${r.date}`,[]]))}),
  precheckOptions:{key:'k',fetchImpl:async(_url,init)=>{
   events.push('precheck-start');
   const input=JSON.parse(JSON.parse(init.body).messages[1].content);
   await gate;
   events.push('precheck-end');
   return response(input.rows.map(r=>r.dataReady&&r.livePassed));
  }},
  choose:async pool=>{events.push('fill');return {source:'rule_added',picks:pool.map(c=>({id:c.id,reasonCode:'budget_fits'}))};},
 });
 assert.ok(events.indexOf('precheck-start')<events.indexOf('routing'));
 assert.ok(events.indexOf('routing')<events.indexOf('precheck-end'));
 assert.ok(events.indexOf('fill')>events.indexOf('precheck-end'));
 assert.equal(result.candidates[0].planning.ai_precheck.status,'matched');
});

test('precheck runs after live lookup and before AI fill, without changing A/B/C across success, failure, or disagreement',async()=>{
 const events=[];
 const request={startDate:dates[0],endDate:dates[1],exchange_rate:{krw_per_jpy:'9.5',as_of:'2026-09-30'},
  submissions:['a','b'].map(memberId=>({memberId,longlist:ids,picks:ids,must:ids[0],veto:null,
   budgetPerDay:100000,stepLimit:20000,activeMin:720,tradeoffs:{pace:1,distance:0.5,spend:1}}))};
 async function run(mode){
  return calculateRealCandidates(request,dataset,profiles,{baseUrl:''},{
   liveCheck:async reqs=>{events.push('live');return {source:'google_places',checked_on:'2026-10-01',fetched:0,reused:0,
     verdicts:new Map(reqs.map(r=>[`${r.record.place.place_id}|${r.date}`,[]]))};},
   precheckOptions:{key:'k',fetchImpl:async(_url,init)=>{
    events.push('precheck');const x=JSON.parse(JSON.parse(init.body).messages[1].content);
    if(mode==='error')return {ok:false};
    return response(x.rows.map(r=>mode==='disagreement'?false:r.dataReady&&r.livePassed));
   }},
   choose:async pool=>{events.push('fill');return {source:'rule_added',picks:pool.map(c=>({id:c.id,reasonCode:'budget_fits'}))};},
  });
 }
 const good=await run('good'),failed=await run('error'),disagree=await run('disagreement');
 const strip=x=>x.candidates.map(({planning,...c})=>({...c,planning:((({ai_precheck,...p})=>p)(planning))}));
 assert.deepEqual(strip(failed),strip(good));assert.deepEqual(strip(disagree),strip(good));
 assert.equal(good.candidates[0].planning.ai_precheck.source,'somsom');
 assert.equal(failed.candidates[0].planning.ai_precheck.source,'rule');
 assert.equal(disagree.candidates[0].planning.ai_precheck.reason_code,'disagreement');
 assert.ok(events.indexOf('precheck')>events.indexOf('live'));assert.ok(events.indexOf('fill')>events.indexOf('precheck'));
 assert.equal(good.candidates.length,3);
 for(const c of good.candidates)assert.deepEqual(c.planning.ai_precheck,good.candidates[0].planning.ai_precheck);
});
