import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {queryWalkingRoute, estimateWalkingRoute, withRouting, travel, distKm, routingSummary} from './routing.ts';
import {buildSchedule} from './schedule.ts';
import {calculateCandidates} from './candidates.mjs';
import {calculateRealWithRouting} from './real.mjs';
import {allPlaces} from './places.ts';
import {loadInputs, availability} from '../../scripts/validate_real_schedule.mjs';

const a = {lat:34.67, lng:135.50}, b = {lat:34.671, lng:135.501};
const far = {lat:34.7, lng:135.51};
const waypoint = p => ({distance:2, location:[p.lng,p.lat]});
const options = fetchImpl => ({baseUrl:'http://localhost:5001', fetchImpl});
const response = data => new Response(JSON.stringify(data));
const routeBody = {code:'Ok', waypoints:[waypoint(a),waypoint(b)], routes:[{distance:900, duration:720}]};
const table = points => ({code:'Ok', sources:points.map(waypoint), destinations:points.map(waypoint),
  distances:points.map((_,i)=>points.map((_,j)=>i===j?0:900)),
  durations:points.map((_,i)=>points.map((_,j)=>i===j?0:720))});
const matrixFetch = url => {
  const coords = new URL(url).pathname.split('/').at(-1).split(';').map(s=>{
    const [lng,lat] = s.split(',').map(Number); return {lng,lat};
  });
  return response(table(coords));
};

test('Route uses longitude,latitude, a foot server and meters/seconds conversion', async () => {
  const result = await queryWalkingRoute(a,b,options(async (url,init) => {
    assert.match(url,/\/route\/v1\/foot\/135.5,34.67;135.501,34.671\?/);
    assert.equal(new URL(url).searchParams.get('radiuses'),'100;100');
    assert.ok(init.signal); return response(routeBody);
  }));
  assert.deepEqual(result,{km:0.9,min:12,source:'osrm-foot'});
});

test('disabled and invalid configuration never sends a request', async () => {
  for (const [url,reason] of [['','not_configured'],['file:///etc/passwd','invalid_config'],
    ['https://router.project-osrm.org','invalid_config'],['https://routing.openstreetmap.de/routed-foot','invalid_config'],
    ['http://user:password@localhost','invalid_config']]) {
    const result = await queryWalkingRoute(a,b,{baseUrl:url,fetchImpl:()=>{throw Error('must not call');}});
    assert.equal(result.fallbackReason,reason);
    assert.equal(result.km,distKm(a,b)*1.35);
  }
});

test('offline, HTTP failure, bad JSON, no route and invalid numbers use the old walking formula', async () => {
  const cases = [
    [async()=>{throw Error('offline');},'unavailable'],
    [async()=>new Response('upstream failed',{status:503}),'http_error'],
    [async()=>new Response('<html>oops</html>'),'invalid_response'],
    [async()=>response({code:'NoRoute'}),'no_route'],
    [async()=>response({...routeBody,routes:[]}),'invalid_response'],
    ...[null,-1,'900',0].map(n=>[async()=>response({...routeBody,routes:[{distance:n,duration:720}]}),n===null?'no_route':'invalid_response']),
    [async()=>response({...routeBody,waypoints:[{...waypoint(a),distance:500},waypoint(b)]}),'invalid_response'],
  ];
  for (const [fetchImpl,reason] of cases) {
    assert.deepEqual(await queryWalkingRoute(a,b,options(fetchImpl)),estimateWalkingRoute(a,b,reason));
  }
});

test('actual fetch bounds both header and body stalls and returns fallback', async t => {
  const server = createServer((req,res) => {
    if (req.url.startsWith('/body/')) { res.writeHead(200,{'Content-Type':'application/json'});res.write('{'); }
    // /headers intentionally never responds.
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();});
  for (const path of ['headers','body']) {
    const start = Date.now();
    const got = await queryWalkingRoute(a,b,{baseUrl:`http://127.0.0.1:${server.address().port}/${path}`,timeoutMs:80});
    assert.equal(got.fallbackReason,'timeout'); assert.ok(Date.now()-start < 1500);
  }
});

test('matrix is requested once, preserves direction, null cells fall back and transit stays estimated', async () => {
  let calls = 0;
  await withRouting([a,b,far,a],() => {
    assert.equal(travel(a,b).km,0.9);assert.equal(travel(a,b).min,12);
    assert.equal(travel(b,a).km,1.1);assert.equal(travel(b,a).min,15);
    assert.equal(travel(a,far).source,'transit-estimate');
    assert.equal(travel(a,far).km,distKm(a,far)*1.35);
    assert.equal(travel(a,far).walkKm,0.7);
    assert.equal(travel(a,{lat:34.671,lng:135.502}).fallbackReason,'outside_snapshot');
    assert.match(routingSummary([[a,b,far]]),/OSRM 도보 1구간.*대중교통 추정 1구간/);
    for (let i=0;i<20;i++) travel(a,b);
  }, options(async url => {
    calls++; assert.equal(new URL(url).pathname.split('/').at(-1).split(';').length,3);
    const data = table([a,b,far]); data.distances[1][0]=1100;data.durations[1][0]=900;
    return response(data);
  }));
  assert.equal(calls,1);assert.equal(travel(a,b).source,'distance-estimate');
  const data = table([a,b]);data.distances[0][1]=null;data.durations[0][1]=null;
  await withRouting([a,b],()=>{
    assert.equal(travel(a,b).fallbackReason,'no_route');assert.equal(travel(b,a).source,'osrm-foot');
  },options(async()=>response(data)));
});

test('malformed table and oversized snapshots fail closed without leaking another calculation', async () => {
  await withRouting([a,b],()=>assert.equal(travel(a,b).fallbackReason,'invalid_response'),options(async()=>response({code:'Ok',distances:[]})));
  await withRouting(Array.from({length:201},(_,i)=>({lat:34+i/1000,lng:135})),()=>{
    assert.equal(travel(a,b).fallbackReason,'too_many_places');
  },options(async()=>{throw Error('must not fetch');}));
  await Promise.all([900,600].map(distance=>withRouting([a,b],async()=>{
    await new Promise(resolve=>setTimeout(resolve,5));assert.equal(travel(a,b).km,distance/1000);
  },options(async()=>{const data=table([a,b]);data.distances[0][1]=distance;return response(data);})))) ;
  assert.equal(travel(a,b).source,'distance-estimate');
  await assert.rejects(withRouting([a,b],()=>{throw Error('calculation failure');},options(matrixFetch)),/calculation failure/);
  assert.equal(travel(a,b).source,'distance-estimate');
});

test('schedule arrival, walking and total metrics use the same route snapshot', async () => {
  const selections = [a,b].map((p,i)=>({place:{...p,id:`p${i}`,name:`p${i}`,area:'test',category:'landmark',
    stayMin:30,openFrom:540,openTo:1260,cost:0,bagLoad:0},votes:1,mustOf:null,tier:'core',participants:[]}));
  await withRouting([a,b],()=>{
    const plan=buildSchedule(selections,1,{fillMeals:false}).plans[0];
    assert.equal(plan.items[1].startMin-plan.items[0].endMin,12);
    assert.equal(plan.walkKm,0.9);assert.equal(plan.totalKm,0.9);assert.equal(plan.totalMoveMin,12);
  },options(matrixFetch));
});

test('three shared candidates prefetch once including fillers and publish actual route sources', async () => {
  const members=[{id:'a',name:'A'},{id:'b',name:'B'}];
  const request={members,startDate:'2026-10-07',endDate:'2026-10-07',submissions:members.map(m=>({memberId:m.id,
    longlist:['glico','hozenji','kuromon'],picks:['glico','hozenji','kuromon'],must:null,veto:null,
    budgetPerDay:100000,stepLimit:20000,activeMin:720}))};
  let calls=0;
  const got=await calculateCandidates(request,undefined,options(async url=>{calls++;return matrixFetch(url);}));
  assert.equal(calls,1);assert.equal(got.candidates.length,3);
  for (const c of got.candidates) {
    assert.match(c.summary,/OSRM 도보 [1-9]/);
    const places=c.days[0].placeIds.map(id=>allPlaces().find(p=>p.id===id));
    const walk=places.slice(1).reduce((sum,p,i)=>sum+(distKm(places[i],p)*1.35<=1.2?0.9:0.7),0);
    assert.equal(c.metrics.walkStepsPerDay,Math.round(Math.round(walk*10)/10*1000/0.7));
  }
});

test('real selected catalogue uses OSRM in hard walking constraints; no-route uses existing estimate', async () => {
  const {dataset,profiles}=loadInputs();
  const good=dataset.places.filter(r=>availability(r,'2026-10-07',profiles,{allowShopping:true}).eligible_for_model);
  const first=structuredClone(good[0]), second=structuredClone(good[1]);
  [first,second].forEach((r,i)=>{
    r.place.latitude=[a,b][i].lat;r.place.longitude=[a,b][i].lng;r.place.stay_min=30;
  });
  const ids=[first.place.place_id,second.place.place_id];
  const sub={picks:ids,must:null,veto:null,budgetPerDay:1000000,stepLimit:1000,activeMin:720};
  const request={startDate:'2026-10-07',endDate:'2026-10-07',submissions:[sub],exchange_rate:{krw_per_jpy:'9.5'}};
  const small={places:[first,second]};
  const got=await calculateRealWithRouting(request,small,profiles,options(matrixFetch));
  assert.equal(got.planning.scheduled_count,1);
  assert.equal(got.planning.exclusion_reason_counts.step_limit_exceeded,1);
  const fallback=await calculateRealWithRouting(request,small,profiles,options(async()=>response({code:'NoTable'})));
  assert.equal(fallback.planning.scheduled_count,2);
  assert.match(fallback.result.summary,/직선거리×1.35 도보 추정 1구간/);
});
