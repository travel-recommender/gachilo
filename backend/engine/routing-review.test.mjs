import test from 'node:test';
import assert from 'node:assert/strict';
import {withRouting, travel, queryWalkingRoute, routingLimitations, estimateWalkingRoute} from './routing.ts';
import {buildSchedule} from './schedule.ts';
import {allPlaces, setCustomPlaces, makeCustomPlace} from './places.ts';
import {calculateRealWithRouting} from './real.mjs';
import {loadInputs, availability, validateDay} from '../../scripts/validate_real_schedule.mjs';

const a = {lat:34.67,lng:135.5};
const offset = km => ({lat:a.lat + km / 1.35 / 111,lng:a.lng});
const b = offset(0.3), c = offset(1.05);
const waypoint = p => ({distance:2,location:[p.lng,p.lat]});
const table = points => ({code:'Ok',sources:points.map(waypoint),destinations:points.map(waypoint),
  distances:points.map((_,i)=>points.map((_,j)=>i===j?0:900)),
  durations:points.map((_,i)=>points.map((_,j)=>i===j?0:720))});
const response = data => new Response(JSON.stringify(data));
const options = fetchImpl => ({baseUrl:'http://localhost:5001',fetchImpl});

test('one distant snapped waypoint does not discard the other table routes', async()=>{
  const data = table([a,b,c]); data.sources[2].distance=500; data.destinations[2].distance=500;
  let calls=0;
  await withRouting([a,b,c],()=>{
    assert.equal(travel(a,b).source,'osrm-foot');
    assert.equal(travel(b,a).source,'osrm-foot');
    assert.equal(travel(a,c).source,'distance-estimate');
    assert.equal(travel(c,b).fallbackReason,'invalid_response');
  },options(async url=>{
    calls++; assert.equal(new URL(url).searchParams.has('radiuses'),false);
    return response(data);
  }));
  assert.equal(calls,1);
});

test('valid zero-meter and zero-second routes between distinct points remain OSRM results', async()=>{
  const data=table([a,b]); data.distances[0][1]=0; data.durations[0][1]=0;
  data.sources[1].location=data.destinations[1].location=waypoint(a).location;
  await withRouting([a,b],()=>{
    assert.equal(travel(a,b).source,'osrm-foot');assert.equal(travel(a,b).km,0);assert.equal(travel(a,b).min,0);
    assert.match(routingLimitations([[a,b]]),/foot OSRM 1, distance × 1.35 walking estimate 0/);
  },options(async()=>response(data)));
  assert.deepEqual(await queryWalkingRoute(a,b,options(async()=>response({code:'Ok',
    waypoints:data.sources,routes:[{distance:0,duration:0}]}))),{km:0,min:0,source:'osrm-foot'});
});

test('distance-only or duration-only zero falls back in both Route and Table responses', async()=>{
  for (const [distance,duration] of [[0,600],[900,0]]) {
    const data=table([a,b]);data.distances[0][1]=distance;data.durations[0][1]=duration;
    await withRouting([a,b],()=>{
      const move=travel(a,b);
      assert.equal(move.source,'distance-estimate');assert.equal(move.fallbackReason,'invalid_response');
      assert.ok(move.km>0);assert.ok(move.min>0);
      assert.equal(travel(b,a).source,'osrm-foot','valid reverse route remains usable');
    },options(async()=>response(data)));
    const route=await queryWalkingRoute(a,b,options(async()=>response({code:'Ok',
      waypoints:data.sources,routes:[{distance,duration}]})));
    assert.equal(route.source,'distance-estimate');assert.equal(route.fallbackReason,'invalid_response');
  }
});

test('short straight-line detours retain a consistent transit distance and schedule duration', async()=>{
  const data=table([a,b]);data.distances[0][1]=1400;data.durations[0][1]=1080;
  await withRouting([a,b],()=>{
    const move=travel(a,b);
    assert.equal(move.mode,'transit');assert.equal(move.source,'transit-estimate');
    assert.equal(move.km,1.4);assert.ok(move.walkKm<=move.km);assert.equal(move.min,13);
    const items=buildSchedule([selection(place('start',a)),selection(place('end',b))],1,
      {fillMeals:false}).plans[0].items;
    assert.equal(items[1].moveKm,1.4);assert.equal(items[1].moveMin,13);
    assert.equal(items[1].startMin-items[0].endMin,13);
    assert.equal(travel(b,a).mode,'walk','directional OSRM routes need not have the same mode');
  },options(async()=>response(data)));
  const old=travel(a,b);
  assert.equal(old.mode,'walk');assert.equal(old.km,estimateWalkingRoute(a,b).km);
});

test('mode uses routed walking distance, including detours and both sides of the threshold', async()=>{
  const near=offset(1.15), far=offset(1.25), data=table([a,near,far]);
  data.distances[0][1]=3000;data.distances[0][2]=1300;
  data.distances[1][0]=1200;data.distances[2][0]=1100;
  await withRouting([a,near,far],()=>{
    for(const [p,routeKm] of [[near,3],[far,1.3]]) {
      assert.equal(travel(a,p).mode,'transit');assert.equal(travel(a,p).walkKm,0.7);
      assert.equal(travel(a,p).km,Math.max(estimateWalkingRoute(a,p).km,routeKm));
    }
    assert.equal(travel(near,a).mode,'walk');assert.equal(travel(near,a).km,1.2);
    assert.equal(travel(far,a).mode,'walk');assert.equal(travel(far,a).km,1.1);
  },options(async()=>response(data)));
  assert.equal(travel(a,near).mode,'walk');assert.equal(travel(a,far).mode,'transit');
});

const place = (id,p,category='landmark',stayMin=30) => ({...p,id,name:id,area:'test',category,
  cost:0,stayMin,openFrom:540,openTo:1260,bagLoad:0});
const selection = p => ({place:p,votes:1,mustOf:null,tier:'core',participants:[]});

test('meal filler and next-place proximity use one geographic distance scale', async t=>{
  const near=place('near-food',b,'food'), far=place('far-food',c,'food');
  const vetoed=new Set(allPlaces().map(p=>p.id));
  setCustomPlaces([near,far]);t.after(()=>setCustomPlaces([]));
  const data=table([a,b,c]);data.distances[0][1]=1190;data.distances[0][2]=100;
  await withRouting([a,b,c],()=>{
    assert.ok(travel(a,b).km>travel(a,c).km,'routed km would change geographic proximity ordering');
    const meals=buildSchedule([selection(place('start',a,'landmark',150)),selection(place('end',a))],1,
      {fillMeals:true,vetoed}).plans[0].items;
    assert.equal(meals[1].place.id,'near-food');
    const ordered=buildSchedule([selection(place('start',a)),selection(place('far',c)),selection(place('near',b))],1,
      {fillMeals:false}).plans[0].items;
    assert.deepEqual(ordered.map(x=>x.place.id),['start','near','far']);
  },options(async()=>response(data)));
});

function realFixture() {
  const {dataset,profiles}=loadInputs();
  const records=dataset.places.filter(r=>availability(r,'2026-10-07',profiles,{allowShopping:true}).eligible_for_model)
    .slice(0,2).map(r=>structuredClone(r));
  records.forEach((r,i)=>{r.place.latitude=[a,b][i].lat;r.place.longitude=[a,b][i].lng;r.place.stay_min=30;});
  const ids=records.map(r=>r.place.place_id);
  const request={startDate:'2026-10-07',endDate:'2026-10-07',exchange_rate:{krw_per_jpy:'9.5'},
    submissions:[{picks:ids,must:null,veto:null,budgetPerDay:1000000,stepLimit:20000,activeMin:720}]};
  return {dataset:{places:records},profiles,ids,request};
}

test('real result and day validator report final route sources when disabled, failed or partially routed', async()=>{
  const {dataset,profiles,ids,request}=realFixture();
  for(const routing of [{baseUrl:''},options(async()=>{throw Error('offline');}),options(async()=>{
    const data=table([a,b]);data.distances[0][1]=data.distances[1][0]=null;return response(data);
  })]) {
    const result=await calculateRealWithRouting(request,dataset,profiles,routing);
    assert.match(result.planning.limitations.join(' '),/No walking legs use OSRM/);
    await withRouting([a,b],()=>{
      const day=validateDay({date:'2026-10-07',place_ids:ids,krw_per_jpy:'9.5',budget_krw:1000000,
        step_limit:20000,active_min:720},dataset,profiles,{allowShopping:true});
      assert.match(day.limitations.join(' '),/No walking legs use OSRM/);
    },routing);
  }
  const data=table([a,b,c]);data.distances[1][2]=null;
  await withRouting([a,b,c],()=>{
    assert.match(routingLimitations([[a,b,c]]),/foot OSRM 1, distance × 1.35 walking estimate 1/);
  },options(async()=>response(data)));
});

test('detour reclassification prevents a false real-catalogue walking-limit failure', async()=>{
  const {dataset,profiles,request}=realFixture();request.submissions[0].stepLimit=1000;
  const data=table([a,b]);data.distances[0][1]=data.distances[1][0]=3000;
  const result=await calculateRealWithRouting(request,dataset,profiles,options(async()=>response(data)));
  assert.equal(result.planning.scheduled_count,2);
  assert.equal(result.planning.exclusion_reason_counts.step_limit_exceeded,undefined);
  assert.match(result.result.summary,/대중교통 추정 1구간/);
});

test('invalid real catalogue coordinates are rejected without aborting valid selections', async()=>{
  const {dataset,profiles,request}=realFixture();dataset.places[1].place.latitude=null;
  const result=await calculateRealWithRouting(request,dataset,profiles,options(()=>{throw Error('one valid point needs no table');}));
  assert.equal(result.planning.scheduled_count,1);
  assert.equal(result.planning.exclusion_reason_counts.coordinates_invalid,1);
});

test('invalid direct coordinates fail explicitly; catalogue/custom-place inputs and valid pairs remain usable', async()=>{
  for(const bad of [null,{lat:'34.67',lng:135.5},{lat:NaN,lng:135.5},{lat:91,lng:135.5}]) {
    assert.throws(()=>travel(a,bad),/Invalid routing coordinates/);
    await assert.rejects(queryWalkingRoute(a,bad),/Invalid routing coordinates/);
    await withRouting([a,b,bad],()=>assert.equal(travel(a,b).source,'osrm-foot'),options(async()=>response(table([a,b]))));
  }
  for(const p of [...allPlaces(),makeCustomPlace({name:'test',category:'cafe',area:'unknown'})]) {
    assert.ok(Number.isFinite(travel(a,p).km));
  }
});

test('timeout values above 3000ms are explicit invalid configuration without a request', async()=>{
  const got=await queryWalkingRoute(a,b,{baseUrl:'http://localhost:5001',timeoutMs:5000,
    fetchImpl:()=>{throw Error('must not request');}});
  assert.equal(got.fallbackReason,'invalid_config');
});
