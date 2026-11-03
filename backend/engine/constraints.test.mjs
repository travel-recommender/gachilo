import test from 'node:test';
import assert from 'node:assert/strict';
import {withTripConditions,withConditionDay,withConditionDate,withConditionStart,withShelterPreference,rainProbability,routingExposureWeight,hasShelterWeather,routingColdPreference,bagExtraCost,weatherDescription} from './conditions.ts';
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
  withConditionDay(1,()=>withConditionDay(1,()=>assert.equal(rainProbability(),0)));
  withConditionDate('2026-10-02',()=>withConditionDay(0,()=>assert.equal(rainProbability(),p)));
  withConditionStart('2026-10-02',()=>withConditionDay(0,()=>assert.equal(rainProbability(),0)));
  assert.equal(rainProbability(),p);
 })));
 assert.equal(rainProbability(),null);
 withTripConditions(weather(null),date,()=>assert.match(weatherDescription(),/미확인/));
});
test('only exact OSM edge evidence counts; venue indoor flags and unmatched nodes do not',()=>{
 const edges=roofEdges(data);const r=annotateRoute(raw(true),edges);
 assert.equal(r.coveredKm,0.4);assert.equal(r.unknownKm,0.2);assert.deepEqual(r.coveredWayIds,[123]);
 assert.equal(annotateRoute(raw(true),new Map()).coveredKm,0);
 assert.equal(roofEdges({...data,ways:data.ways.map(w=>({...w,tags:{indoor:'yes',tourism:'museum'}}))}).size,0);
 assert.equal(roofEdges({...data,ways:data.ways.map(w=>({...w,tags:{indoor:'yes',highway:'footway'}}))}).size,1);
 assert.equal(roofEdges({...data,ways:data.ways.map(w=>({...w,tags:{indoor:'yes',highway:'footway',access:'private'}}))}).size,0);
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

test('soft rain preference falls back to feasible base routes instead of losing required visits',async()=>{
 const {dataset:source,profiles}=loadInputs();const dataset=structuredClone(source);
 const ids=['osaka_009','osaka_015'];
 ids.forEach((id,i)=>Object.assign(dataset.places.find(r=>r.place.place_id===id).place,{latitude:[a,b][i].lat,longitude:[a,b][i].lng}));
 const req={startDate:date,endDate:date,exchange_rate:{krw_per_jpy:'9.5'},
 submissions:ids.map((id,i)=>({memberId:String(i),longlist:ids,picks:ids,must:id,veto:null,budgetPerDay:100000,stepLimit:750,activeMin:720,tradeoffs:{pace:1,distance:0.5,spend:1}}))};
 const dry=await calculateRealCandidates({...req,weather:weather(0)},dataset,profiles,options);
 const results=await Promise.all([weather(1),hotWeather(38)].map(w=>calculateRealCandidates({...req,weather:w},dataset,profiles,options)));
 assert.ok(dry.candidates.every(c=>c.days[0].placeIds.length===2));
 for(const rain of results) assert.ok(rain.candidates.every(c=>c.days[0].placeIds.length===2&&c.days[0].metrics.walkSteps<=750&&c.planning.must_satisfied));
 for(const rain of results) assert.ok(rain.candidates.every(c=>c.summary.includes('실내·지붕 우회 선호를 적용하지 않았습니다')));
});

const hotWeather=(temperature,p=0)=>({...weather(p),days:[{date,status:'forecast',probability:p,max_temperature_c:temperature},{date:'2026-10-02',status:'forecast',probability:0,max_temperature_c:25}]});
test('heat without rain triggers sheltered detours, date isolation and honest added-time notice',async()=>{
 for(const p of [0,null])await withTripConditions(hotWeather(35,p),date,()=>withRouting([a,b],()=>{
  assert.equal(routingExposureWeight(),1);assert.equal(travel(a,b).km,0.6);
  withConditionDay(1,()=>assert.equal(travel(a,b).km,0.5));
  const summary=conditionSummary([{date,points:[a,b]}]);
  assert.match(summary,/날씨 경로 안내: 폭염/);assert.match(summary,/추가 약 1분/);
  assert.match(summary,/이 시간은 일정에 반영/);assert.match(summary,/냉난방 여부는 알 수 없/);
  assert.match(summary,/35°C/);
 },options));
 await withTripConditions(hotWeather(38,0.8),date,()=>withRouting([a,b],()=>{
  assert.equal(routingExposureWeight(),1);assert.match(conditionSummary([{date,points:[a,b]}]),/날씨 경로 안내: 비·폭염/);
 },options));
});
test('subthreshold, invalid or missing heat and missing shelter data retain original route without a detour notice',async()=>{
 for(const t of [34.9,null,NaN,Infinity,100,'38'])await withTripConditions(hotWeather(t),date,()=>withRouting([a,b],()=>{
  assert.equal(hasShelterWeather(),false);assert.equal(travel(a,b).km,0.5);
  assert.doesNotMatch(conditionSummary([{date,points:[a,b]}]),/날씨 경로 안내:/);
 },options));
 for(const t of [35,40])await withTripConditions(hotWeather(t),date,()=>withRouting([a,b],()=>{
  assert.equal(travel(a,b).km,0.5);assert.doesNotMatch(conditionSummary([{date,points:[a,b]}]),/날씨 경로 안내:/);
 },{...options,shelterData:null}));
});

test('cold prefers proven indoor passage, not an open-sided roof; absent indoor data keeps baseline',async()=>{
 const indoor={...data,ways:data.ways.map(w=>({...w,tags:{highway:'footway',indoor:'yes'}}))};
 await withTripConditions(hotWeather(5),date,()=>withRouting([a,b],()=>{
  assert.equal(routingColdPreference(),true);assert.equal(travel(a,b).km,0.6);assert.equal(travel(a,b).indoorKm,0.4);
  assert.match(conditionSummary([{date,points:[a,b]}]),/날씨 경로 안내: 추위/);
  withConditionDay(1,()=>assert.equal(travel(a,b).km,0.5));
 },{...options,shelterData:indoor}));
 await withTripConditions(hotWeather(-2,0.9),date,()=>withRouting([a,b],()=>{
  assert.equal(travel(a,b).km,0.5);
  assert.doesNotMatch(conditionSummary([{date,points:[a,b]}]),/날씨 경로 안내:/);
 },options));
 await withTripConditions(hotWeather(5.1),date,()=>withRouting([a,b],()=>{
  assert.equal(travel(a,b).km,0.5);assert.equal(routingColdPreference(),false);
 },{...options,shelterData:indoor}));
});

test('dry dates and disabled/unsuitable shelter preference preserve Table values when Route differs',async()=>{
 const differing={...options,fetchImpl:async url=>{
  const response=await fixture(url);const d=await response.json();
  if(url.includes('/table/')){d.distances=[[0,450],[450,0]];d.durations=[[0,360],[360,0]];}
  return Response.json(d);
 }};
 await withTripConditions(weather(1),date,()=>withRouting([a,b],()=>{
  assert.equal(travel(a,b).km,0.6);
  assert.match(conditionSummary([{date,points:[a,b]}]),/추가 약 2분/);
  for(const run of [fn=>withConditionDay(1,fn),fn=>withShelterPreference(false,fn)])run(()=>{
   const move=travel(a,b);assert.equal(move.km,0.45);assert.equal(move.min,6);assert.equal(move.via,undefined);
  });
  withShelterPreference(false,()=>assert.doesNotMatch(conditionSummary([{date,points:[a,b]}]),/날씨 경로 안내:/));
 },differing));
 await withTripConditions(hotWeather(0),date,()=>withRouting([a,b],()=>{
  assert.equal(travel(a,b).km,0.45);assert.equal(travel(a,b).min,6);
 },differing)); // roof alone is unsuitable on a cold day
});
test('normal queries are reused across roof/indoor kinds while opposite directions remain distinct',async()=>{
 const indoorVia={lat:via.lat,lng:via.lng-0.0002};
 const mixed={...data,ways:[...data.ways,{...data.ways[0],osm_way_id:124,nodes:[5,6],
  geometry:[indoorVia,indoorVia],tags:{highway:'footway',indoor:'yes'}}]};
 const calls=[];
 const routes=new Map([[pair(a,b),{km:0.5,source:'osrm-foot'}],[pair(b,a),{km:0.5,source:'osrm-foot'}]]);
 await prepareShelteredRoutes([a,b],routes,{baseUrl:options.baseUrl,data:mixed,kinds:['covered','indoor'],fetchImpl:async url=>{
  calls.push(new URL(url).pathname.split('/').at(-1));return fixture(url);
 }},distKm);
 assert.equal(calls.filter(p=>p===pair(a,b)).length,1);
 assert.equal(calls.filter(p=>p===pair(b,a)).length,1);
 assert.equal(calls.filter(p=>p.split(';').length===3).length,4);
 assert.ok(calls.length<=32);
});
test('candidate generation bounds distance work before any Route requests',async()=>{
 const points=Array.from({length:20},(_,i)=>({...a,lat:a.lat+i*0.00001}));
 const routes=new Map(points.flatMap(a=>points.filter(b=>a!==b).map(b=>[pair(a,b),{km:0.5,source:'osrm-foot'}])));
 let distanceCalls=0,requests=0;
 await prepareShelteredRoutes(points,routes,{baseUrl:options.baseUrl,data,fetchImpl:async()=>{requests++;throw Error('offline');}},(a,b)=>{distanceCalls++;return distKm(a,b);});
 assert.ok(distanceCalls<=128*data.ways.length*2);
 assert.ok(requests<=16);
});

test('a shelter detour must also stay within the Table baseline allowance',async()=>{
 const opts={...options,fetchImpl:async url=>{
  const d=await (await fixture(url)).json();
  if(url.includes('/table/')){d.distances=[[0,400],[400,0]];d.durations=[[0,300],[300,0]];}
  return Response.json(d);
 }};
 await withTripConditions(weather(1),date,()=>withRouting([a,b],()=>{
  assert.equal(travel(a,b).km,0.4);assert.equal(travel(a,b).via,undefined);
  assert.doesNotMatch(conditionSummary([{date,points:[a,b]}]),/날씨 경로 안내:/);
 },opts));
});


test('Table-eligible second detour survives a cheaper candidate outside the Table limits',async()=>{
 const roofVia={lat:34.6715,lng:135.502},indoorVia={...roofVia,lng:135.5017};
 const mixed={...data,ways:[{...data.ways[0],geometry:[roofVia,roofVia]},{osm_way_id:456,nodes:[5,6],
  geometry:[indoorVia,indoorVia],tags:{highway:'footway',indoor:'yes'}}]};
 const opts={...options,shelterData:mixed,fetchImpl:async url=>{
  const d=await (await fixture(url)).json();
  if(url.includes('/table/')){d.distances=[[0,500],[500,0]];d.durations=[[0,420],[420,0]];}
  else {
   const coords=new URL(url).pathname.split('/').at(-1).split(';');
   const isIndoor=coords.length===3 && coords[1]===`${indoorVia.lng},${indoorVia.lat}`;
   const detour=coords.length===3;
   const distance=detour?(isIndoor?600:700):600;
   d.routes=[{distance,duration:480,geometry:raw().geometry,legs:[{annotation:detour?
    (isIndoor?{nodes:[1,5,6,4],distance:[150,300,150]}:{nodes:[1,2,3,4],distance:[10,680,10]}):
    {nodes:[8,9],distance:[distance]}}]}];
  }
  return Response.json(d);
 }};
 // Mixed trip prepares both roof and indoor candidates. Rain day chooses within Table allowance.
 const forecast={...weather(1),days:[...weather(1).days,{date:'2026-10-03',status:'forecast',max_temperature_c:0}]};
 await withTripConditions(forecast,date,()=>withRouting([a,b],()=>{
  const move=travel(a,b);assert.equal(move.km,0.6);assert.deepEqual(move.via,indoorVia);
  assert.match(conditionSummary([{date,points:[a,b]}]),/추가 약 1분/);
  withConditionDay(1,()=>assert.equal(travel(a,b).km,0.5));
 },opts));
});

test('Table time and distance limits are applied before ranking sheltered alternatives',()=>{
 const normal={...annotateRoute(raw(),roofEdges(data)),min:10};
 const first={...normal,km:0.65,min:13,coveredKm:0.6,unknownKm:0.05};
 const second={...normal,km:0.6,min:8,coveredKm:0.5,unknownKm:0.1};
 assert.equal(selectShelteredRoute([normal,first,second],1,false,{km:0.5,min:5}),second);
 // A stricter Route response must not reject a candidate allowed by the actual Table baseline.
 assert.equal(selectShelteredRoute([{...normal,km:0.4,unknownKm:0.4},second],1,false,{km:0.5,min:7}),second);
});

test('fixed shelter data is read once; injected empty and alternate data remain isolated',async t=>{
 const fs=(await import('node:fs')).default;
 const module=await import('./sheltered-routing.ts?cache-regression');
 const read=t.mock.method(fs,'readFileSync',()=>JSON.stringify(data));
 const base=new Map([[pair(a,b),{km:0.5,source:'osrm-foot'}]]);
 const opts={baseUrl:options.baseUrl,fetchImpl:fixture};
 const first=await module.prepareShelteredRoutes([a,b],base,opts,distKm);
 const second=await module.prepareShelteredRoutes([a,b],base,opts,distKm);
 assert.ok(first.size>0);assert.deepEqual(second,first);assert.equal(read.mock.callCount(),1);
 assert.equal((await module.prepareShelteredRoutes([a,b],base,{...opts,data:null},distKm)).size,0);
 assert.equal((await module.prepareShelteredRoutes([a,b],base,{...opts,data:{...data,ways:[]}},distKm)).size,0);
 const injected=await module.prepareShelteredRoutes([a,b],base,{...opts,data},distKm);
 assert.deepEqual(injected,first);assert.equal(read.mock.callCount(),1);
});
