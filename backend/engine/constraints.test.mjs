import test from 'node:test';
import assert from 'node:assert/strict';
import {withTripConditions,withConditionDay,withConditionDate,rainProbability,bagExtraCost,weatherDescription} from './conditions.ts';
import {withRouting,travel,travelBurdenTotals,conditionSummary,distKm} from './routing.ts';
import {roofEdges,annotateRoute,selectShelteredRoute,loadShelterData,prepareShelteredRoutes,pair} from './sheltered-routing.ts';
import {buildSchedule} from './schedule.ts';
import {calculateRealCandidates} from './real_candidates.mjs';
import {loadInputs} from '../../scripts/validate_real_schedule.mjs';
const date='2026-10-01';
const weather=p=>({source:'test',status:'forecast',fetched_at:null,days:[{date,status:'forecast',probability:p},{date:'2026-10-02',status:'forecast',probability:0}]});
const a={lat:34.67,lng:135.502},b={lat:34.673,lng:135.502},via={lat:34.671,lng:135.501};
const data={schema_version:1,osm_timestamp:'2026-10-12T20:21:35Z',ways:[{osm_way_id:123,nodes:[2,3],geometry:[via,{...via,lat:34.672}],tags:{highway:'pedestrian',covered:'yes'}}]};
const raw=(covered=false)=>({distance:covered?600:500,duration:covered?480:420,
 geometry:{coordinates:[[a.lng,a.lat],[b.lng,b.lat]]},legs:[{annotation:covered?{nodes:[1,2,3,4],distance:[100,400,100]}:{nodes:[8,9],distance:[500]}}]});
const waypoint=p=>({distance:1,location:[p.lng,p.lat]});
const fixture=async url=>{
 const points=new URL(url).pathname.split('/').at(-1).split(';').map(s=>{const [lng,lat]=s.split(',').map(Number);return {lng,lat};});
 return new Response(JSON.stringify(url.includes('/table/')?{code:'Ok',sources:points.map(waypoint),destinations:points.map(waypoint),distances:points.map((_,i)=>points.map((_,j)=>i===j?0:500)),durations:points.map((_,i)=>points.map((_,j)=>i===j?0:420))}:
 {code:'Ok',waypoints:points.map(waypoint),routes:[raw(points.length===3)]}));
};
const options={baseUrl:'http://localhost:5001',fetchImpl:fixture,shelterData:data};

test('bag cost never becomes negative after multiple purchases and ignores invalid loads',()=>{
 assert.ok(Math.abs(bagExtraCost(1,3)-1.05)<1e-12); // 0.35 × 3
 for(const x of [-1,NaN,Infinity,null])assert.equal(bagExtraCost(1,x),0);
 assert.ok(bagExtraCost(2,3)>bagExtraCost(2,2));
});
test('buying later reduces carried burden while physical cost and opening rules remain intact',()=>{
 const place=(id,lat,bagLoad)=>({id,name:id,lat,lng:135.5,area:'test',category:bagLoad?'shopping':'culture',bagLoad,cost:10,stayMin:30,openFrom:540,openTo:1260});
 const shop=place('shop',34.67,1),museum=place('museum',34.673,0),cafe=place('cafe',34.671,0);
 const sels=[shop,museum,cafe].map(place=>({place,tier:'core',participants:[],votes:1,mustOf:null}));
 const off=buildSchedule(sels,1,{considerBags:false}).plans[0];const on=buildSchedule(sels,1,{considerBags:true}).plans[0];
 assert.equal(on.items.at(-1).place.id,'shop');assert.equal(on.cost,off.cost);
 assert.ok(travelBurdenTotals(on.items.map(i=>i.place)).bagExtra<travelBurdenTotals(off.items.map(i=>i.place)).bagExtra);
 assert.deepEqual(new Set(on.items.map(i=>i.place.id)),new Set(off.items.map(i=>i.place.id)));
 assert.ok(on.items.every(i=>i.startMin>=i.place.openFrom&&i.endMin<=i.place.openTo));
});
test('request-local weather uses each Japan date, nesting and concurrent trips do not leak',async()=>{
 await Promise.all([0.2,0.9].map(p=>withTripConditions(weather(p),date,async()=>{
  await new Promise(r=>setTimeout(r,2));assert.equal(rainProbability(),p);
  withConditionDay(1,()=>assert.equal(rainProbability(),0));
  withConditionDate('2026-10-02',()=>withConditionDay(0,()=>assert.equal(rainProbability(),0)));
  assert.equal(rainProbability(),p);
 })));
 assert.equal(rainProbability(),null);
 withTripConditions(weather(null),date,()=>assert.match(weatherDescription(),/미확인/));
});
test('only exact OSM edge evidence counts; venue indoor flags and unmatched nodes do not',()=>{
 const edges=roofEdges(data);const r=annotateRoute(raw(true),edges);
 assert.equal(r.coveredKm,0.4);assert.equal(r.unknownKm,0.2);assert.deepEqual(r.coveredWayIds,[123]);
 assert.equal(annotateRoute(raw(true),new Map()).coveredKm,0);
 assert.equal(roofEdges({...data,ways:data.ways.map(w=>({...w,tags:{indoor:'yes',highway:'footway'}}))}).size,0);
 const bad=raw(true);bad.legs[0].annotation.distance.pop();assert.equal(annotateRoute(bad,edges),null);
 const short=raw(true);short.distance=1000;assert.equal(annotateRoute(short,edges),null);
});
test('rain cost chooses bounded roof detour; dry, unknown and excessive detours retain baseline',()=>{
 const edges=roofEdges(data),base=annotateRoute(raw(),edges),roof=annotateRoute(raw(true),edges);
 assert.equal(selectShelteredRoute([base,roof],0),base);
 assert.equal(selectShelteredRoute([base,roof],null),base);
 assert.equal(selectShelteredRoute([base,roof],0.8),roof);
 for(const d of [{...roof,km:0.8},{...roof,min:20},{...roof,km:1.3}])assert.equal(selectShelteredRoute([base,d],1),base);
});
test('actual route snapshot applies forecast date to metrics and rejects network-failed roof evidence',async()=>{
 await withTripConditions(weather(0.8),date,()=>withRouting([a,b],()=>{
  const wet=travel(a,b);assert.equal(wet.km,0.6);assert.equal(wet.min,8);assert.equal(wet.coveredKm,0.4);
  withConditionDay(1,()=>assert.equal(travel(a,b).km,0.5));
  assert.match(conditionSummary([{date,points:[a,b]}]),/우회 1구간/);
 },options));
 await withTripConditions(weather(0.8),date,()=>withRouting([a,b],()=>assert.equal(travel(a,b).km,0.5),
 {...options,fetchImpl:async url=>url.includes('/table/')?fixture(url):Promise.reject(Error('offline'))}));
});
test('roof data missing or weather unknown sends no extra Route calls',async()=>{
 let calls=0;const opts={...options,fetchImpl:async url=>{calls++;return fixture(url);}};
 for(const p of [0,null])await withTripConditions(weather(p),date,()=>withRouting([a,b],()=>assert.equal(travel(a,b).km,0.5),opts));
 assert.equal(calls,2);
 await withTripConditions(weather(1),date,()=>withRouting([a,b],()=>assert.equal(travel(a,b).km,0.5),{...opts,shelterData:null}));
 assert.equal(calls,3);
});
test('checked-in roof snapshot is attributed, nonempty, exact-node data, independent of venue catalogue',()=>{
 const d=loadShelterData();assert.ok(d.ways.length>100);assert.equal(d.license,'ODbL-1.0');assert.match(d.source_pbf_sha256,/^[a-f0-9]{64}$/);
 assert.ok(d.ways.some(w=>w.osm_way_id===410957183));assert.ok(roofEdges(d).size>100);
});
test('real three-strategy API includes auditable conditions while keeping hard limits and API fields',async()=>{
 const {dataset,profiles}=loadInputs();const ids=['osaka_009','osaka_015','osaka_017'];
 const req={startDate:date,endDate:date,exchange_rate:{krw_per_jpy:'9.5'},weather:weather(0.8),
 submissions:['a','b'].map(memberId=>({memberId,longlist:ids,picks:ids,must:null,veto:null,budgetPerDay:100000,stepLimit:20000,activeMin:720,tradeoffs:{pace:1,distance:0.5,spend:1}}))};
 const out=await calculateRealCandidates(req,dataset,profiles,{baseUrl:''});
 assert.equal(out.candidates.length,3);
 for(const c of out.candidates){assert.match(c.summary,/2026-10-01 80%/);assert.match(c.summary,/지붕 미확인/);assert.ok(c.days[0].metrics.walkSteps<=20000);assert.equal(c.planning.schedule_ready,false);assert.ok(!('weather' in c));}
});

test('roof detour is included in real hard step limits instead of hiding extra walking',async()=>{
 const {dataset:source,profiles}=loadInputs();const dataset=structuredClone(source);
 const ids=['osaka_009','osaka_015'];
 ids.forEach((id,i)=>Object.assign(dataset.places.find(r=>r.place.place_id===id).place,{latitude:[a,b][i].lat,longitude:[a,b][i].lng}));
 const req={startDate:date,endDate:date,exchange_rate:{krw_per_jpy:'9.5'},
 submissions:ids.map((id,i)=>({memberId:String(i),longlist:ids,picks:ids,must:id,veto:null,budgetPerDay:100000,stepLimit:750,activeMin:720,tradeoffs:{pace:1,distance:0.5,spend:1}}))};
 const dry=await calculateRealCandidates({...req,weather:weather(0)},dataset,profiles,options);
 const rain=await calculateRealCandidates({...req,weather:weather(1)},dataset,profiles,options);
 assert.ok(dry.candidates.every(c=>c.days[0].placeIds.length===2));
 assert.ok(rain.candidates.every(c=>c.days[0].placeIds.length===1&&c.days[0].metrics.walkSteps<=750&&!c.planning.must_satisfied));
});
