/** Seeded offline comparison; --osrm additionally uses the caller's own foot server. */
import {withTripConditions,routingExposureWeight} from '../backend/engine/conditions.ts';
import {buildSchedule} from '../backend/engine/schedule.ts';
import {travelBurdenTotals,distKm} from '../backend/engine/routing.ts';
import {prepareShelteredRoutes,selectShelteredRoute,pair,loadShelterData} from '../backend/engine/sheltered-routing.ts';
let seed=1030;
function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;}
const sums={off:0,on:0,walkOff:0,walkOn:0,extraOff:0,extraOn:0};let improved=0,worse=0,equal=0,changed=0,kept=0;
for(let k=0;k<300;k++){
 const places=Array.from({length:6},(_,i)=>({id:String(i),name:String(i),area:'synthetic',lat:34.67+random()*.006,lng:135.5+random()*.006,category:i<3?'shopping':'culture',bagLoad:i<3?(1+Math.floor(random()*2))/2:0,cost:100,stayMin:20,openFrom:540,openTo:1260}));
 const selections=places.map(place=>({place,tier:'core',votes:1,mustOf:null,participants:[]}));
 const off=buildSchedule(selections,1,{considerBags:false}).plans[0],on=buildSchedule(selections,1,{considerBags:true}).plans[0];
 const p=plan=>plan.items.map(i=>i.place);
 const a=travelBurdenTotals(p(off)),b=travelBurdenTotals(p(on));
 if(a.carryingCost-b.carryingCost>1e-9)improved++;else if(b.carryingCost-a.carryingCost>1e-9)worse++;else equal++;
 if(p(off).map(x=>x.id).join()!=p(on).map(x=>x.id).join())changed++;
 if(on.items.length===6&&off.items.length===6)kept++;
 sums.off+=a.carryingCost;sums.on+=b.carryingCost;sums.walkOff+=a.walkKm;sums.walkOn+=b.walkKm;sums.extraOff+=a.bagExtra;sums.extraOn+=b.bagExtra;
}
const round=x=>Math.round(x*10000)/10000;
const output={scenario:'300 synthetic 6-place groups, 3 purchases; seed 1030; no empirical fatigue claim',
 baggage:{groups:300,keptAll:kept,orderChanged:changed,improved,worse,equal,means:Object.fromEntries(Object.entries(sums).map(([k,v])=>[k,round(v/300)]))},
 limitations:['Experimental coefficient 0.35 with relative bag points; not kg, fare, or measured fatigue.','Same-visit baseline guard rejects worsening trip cost; global optimality is not claimed.','No rain-speed reduction, transit timetable, safe passage, or navigation UI guarantee.']};
if(process.argv.includes('--osrm')){
 const baseUrl=process.env.OSRM_FOOT_URL;
 if(!baseUrl||!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(baseUrl))throw Error('Set own local OSRM_FOOT_URL');
 const points=[{lat:34.6695,lng:135.502},{lat:34.673,lng:135.502}];
 const q=points.map(p=>`${p.lng},${p.lat}`).join(';');
 const response=await fetch(`${baseUrl}/table/v1/foot/${q}?annotations=distance,duration`);
 const table=await response.json();if(table.code!=='Ok')throw Error('OSRM unavailable');
 const base=new Map();points.forEach((a,i)=>points.forEach((b,j)=>base.set(pair(a,b),{source:'osrm-foot',km:table.distances[i][j]/1000})));
 const data=loadShelterData();const routes=await prepareShelteredRoutes(points,base,{baseUrl,data},distKm);
 const options=routes.get(pair(points[0],points[1]));if(!options?.length)throw Error('Roof annotations unavailable');
 const dry=selectShelteredRoute(options,0),rain=selectShelteredRoute(options,1);
 const summarize=r=>({km:r.km,min:r.min,coveredKm:round(r.coveredKm),unknownKm:round(r.unknownKm),coveredWayIds:r.coveredWayIds,via:r.via??null});
 output.weather={scenario:'Same actual OSRM pair, p=0 versus p=1 (controlled forecast, not a forecast claim)',
 mapTimestamp:data.osm_timestamp,pbfSha256:data.source_pbf_sha256,from:points[0],to:points[1],dry:summarize(dry),rain:summarize(rain)};
 const heat=withTripConditions({source:'controlled test',status:'forecast',fetched_at:null,days:[{date:'2026-08-01',status:'forecast',probability:0,max_temperature_c:35}]},'2026-08-01',()=>selectShelteredRoute(options,routingExposureWeight()));
 output.weather.heat=summarize(heat);
 output.weather.scenario+='; heat case uses synthetic daily max 35°C with 0% rain (not a summer forecast)';
}
console.log(JSON.stringify(output,null,2));
