/** Roof evidence is matched by OSM node pairs, never by a venue's indoor flag. */
import fs from 'node:fs';
type Point = {lat:number; lng:number};
type Way = {osm_way_id:number; nodes:number[]; geometry:Point[]; tags:Record<string,string>};
export type ShelterData = {schema_version:number; osm_timestamp:string; ways:Way[]};
export type ShelteredRoute = {km:number; min:number; source:'osrm-foot'; coveredKm:number;
  unknownKm:number; indoorKm:number; coveredWayIds:number[]; via?:Point; geometry:Point[]};
const key = (p:Point) => `${p.lng},${p.lat}`;
const edge = (a:number,b:number) => a < b ? `${a}:${b}` : `${b}:${a}`;
export const pair = (a:Point,b:Point) => `${key(a)};${key(b)}`;

let cachedData: ShelterData | null | undefined;
export function loadShelterData(): ShelterData | null {
  if(cachedData!==undefined) return cachedData;
  try { cachedData=JSON.parse(fs.readFileSync(new URL('../../data/sheltered_paths.json',import.meta.url),'utf8')); }
  catch { cachedData=null; }
  return cachedData??null;
}

function validWay(w:Way):boolean {
  return Number.isSafeInteger(w?.osm_way_id) && w.osm_way_id>0
    && Array.isArray(w.nodes) && w.nodes.length>=2 && w.nodes.every(n=>Number.isSafeInteger(n)&&n>0)
    && Array.isArray(w.geometry) && w.nodes.length===w.geometry.length
    && w.geometry.every(p=>Number.isFinite(p?.lat)&&Number.isFinite(p?.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180)
    && (['yes','arcade','colonnade'].includes(w.tags?.covered) || w.tags?.indoor==='yes')
    && ['footway','pedestrian','path'].includes(w.tags?.highway)
    && !['access','foot'].some(k=>['no','private','customers','permit','delivery'].includes(w.tags[k]))
    && !Object.keys(w.tags).some(k=>k.includes('conditional')||['opening_hours','construction'].includes(k));
}
type ShelterEdge = {wayId:number;indoor:boolean};
export function roofEdges(data:ShelterData): Map<string,ShelterEdge> {
  return buildEdges(validWays(data));
}
function validWays(data:ShelterData):Way[] {
  return data?.schema_version===1 && Array.isArray(data.ways)?data.ways.filter(validWay):[];
}
function buildEdges(ways:Way[]):Map<string,ShelterEdge> {
  const edges = new Map<string,ShelterEdge>();
  for (const w of ways) {
    for (let i=1;i<w.nodes.length;i++) {
      const key=edge(w.nodes[i-1],w.nodes[i]);
      if(!edges.has(key) || w.tags.indoor==='yes') edges.set(key,{wayId:w.osm_way_id,indoor:w.tags.indoor==='yes'});
    }
  }
  return edges;
}

export function annotateRoute(route:any, edges:Map<string,ShelterEdge>): ShelteredRoute | null {
  if (!Number.isFinite(route?.distance) || route.distance <= 0 || !Number.isFinite(route.duration) || route.duration <= 0
    || !Array.isArray(route.legs) || !Array.isArray(route.geometry?.coordinates)) return null;
  let total=0, covered=0, indoor=0; const ids=new Set<number>();
  for (const leg of route.legs) {
    const a=leg.annotation;
    if (!Array.isArray(a?.nodes) || !Array.isArray(a?.distance) || a.nodes.length!==a.distance.length+1) return null;
    for (let i=0;i<a.distance.length;i++) {
      const d=a.distance[i];
      if (!Number.isFinite(d) || d<0 || !Number.isSafeInteger(a.nodes[i]) || !Number.isSafeInteger(a.nodes[i+1])) return null;
      total+=d; const way=edges.get(edge(a.nodes[i],a.nodes[i+1]));
      if (way !== undefined) {covered+=d;if(way.indoor)indoor+=d;ids.add(way.wayId);}
    }
  }
  if (Math.abs(total-route.distance)>Math.max(2,route.distance*0.01)) return null;
  const geometry=route.geometry.coordinates.map((p:any)=>({lng:p[0],lat:p[1]}));
  if (geometry.length<2 || geometry.some((p:Point)=>!Number.isFinite(p.lat)||!Number.isFinite(p.lng)
      ||Math.abs(p.lat)>90||Math.abs(p.lng)>180)) return null;
  return {km:route.distance/1000,min:Math.round(route.duration/60),source:'osrm-foot',
    coveredKm:covered/1000,indoorKm:indoor/1000,unknownKm:Math.max(0,route.distance-covered)/1000,coveredWayIds:[...ids],geometry};
}

/** Selection cost: distance + max(p(rain), heat preference) × distance without shelter evidence.
 * Unknown edges are conservatively penalized; this does not label them known outdoor.
 * A roof detour must stay walkable (<=1.2km), within +35% and +5min of the Table baseline; normal Route annotations only establish shelter evidence.
 */
export function selectShelteredRoute(routes:ShelteredRoute[], exposureWeight:number, indoorOnly=false,
  baseline:Pick<ShelteredRoute,'km'|'min'>=routes[0]): ShelteredRoute {
  const base=routes[0];
  if (!(exposureWeight>0 && exposureWeight<=1)) return base;
  const cost=(r:ShelteredRoute)=>r.km+exposureWeight*(indoorOnly?Math.max(0,r.km-r.indoorKm):r.unknownKm);
  return routes.filter(r=>(r===base || (indoorOnly?r.indoorKm>base.indoorKm:r.coveredKm>base.coveredKm)) && r.km<=1.2 && r.km<=baseline.km*1.35 && r.min<=baseline.min+5)
    .reduce((best,r)=>cost(r) < cost(best) ? r:best,base);
}

type PreparedShelter = {edges:Map<string,ShelterEdge>; midpoints:Record<'covered'|'indoor',Point[]>};
let cachedPrepared:PreparedShelter|null|undefined;
function prepareData(data:ShelterData|null):PreparedShelter|null {
  if(!data)return null;
  const ways=validWays(data);
  return {edges:buildEdges(ways),midpoints:{
    covered:ways.map(w=>w.geometry[Math.floor(w.geometry.length/2)]),
    indoor:ways.filter(w=>w.tags.indoor==='yes').map(w=>w.geometry[Math.floor(w.geometry.length/2)])}};
}
function shelterSnapshot(injected:ShelterData|null|undefined):PreparedShelter|null {
  // Only the checked-in immutable file is shared. Fixtures/overrides stay request-local.
  if(injected!==undefined)return prepareData(injected);
  if(cachedPrepared===undefined)cachedPrepared=prepareData(loadShelterData());
  return cachedPrepared;
}

export async function prepareShelteredRoutes(points:Point[], base:Map<string,{km:number;source:string}>,
  options:{baseUrl:string;fetchImpl?:typeof fetch;data?:ShelterData|null;kinds?:('covered'|'indoor')[]}, distance:(a:Point,b:Point)=>number) {
  const deadline=performance.now()+2500;
  const signal=AbortSignal.timeout(2500);
  const expired=()=>performance.now()>=deadline || signal.aborted;
  const result=new Map<string,ShelteredRoute[]>();
  const prepared=shelterSnapshot(options.data);
  if (!prepared?.edges.size) return result;
  const {edges}=prepared;
  const midpoints=(options.kinds??['covered']).map(kind=>prepared.midpoints[kind]);
  // Bound CPU work as well as I/O. Check the nearest 128 directed Table pairs;
  // all unexamined pairs retain their original routes.
  const pairs:{a:Point;b:Point;km:number}[]=[];
  outer: for(const a of points) for(const b of points) {
    if(expired()) break outer;
    const route=base.get(pair(a,b));
    if(route?.source==='osrm-foot' && route.km>0 && route.km<=1.2) pairs.push({a,b,km:route.km});
  }
  const jobs:{a:Point;b:Point;via:Point;score:number}[]=[];
  candidates: for(const {a,b,km} of pairs.sort((x,y)=>x.km-y.km).slice(0,128)) {
    const seen=new Set<string>();
    for(const points of midpoints) {
      let via:{p:Point;d:number}|undefined;
      for(const p of points) {
        if(expired()) break candidates;
        const da=distance(a,p),db=distance(p,b),d=da+db;
        if(da>0.015 && db>0.015 && d<=km*1.3 && (!via || d<via.d)) via={p,d};
      }
      if(via && !seen.has(key(via.p))) {seen.add(key(via.p));jobs.push({a,b,via:via.p,score:via.d});}
    }
  }
  const queue=jobs.sort((a,b)=>a.score-b.score).slice(0,16);
  // A→B is distinct from B→A. Reuse only identical directed normal queries.
  const normals=new Map<string,Promise<ShelteredRoute|null>>();
  async function query(points:Point[]) {
    try {
      if(expired())return null;
      const q=new URLSearchParams({overview:'full',geometries:'geojson',annotations:'nodes,distance',steps:'false',generate_hints:'false'});
      const response=await (options.fetchImpl??fetch)(`${options.baseUrl}/route/v1/foot/${points.map(key).join(';')}?${q}`,
        {signal,redirect:'error',headers:{Accept:'application/json'}});
      if(!response.ok){await response.body?.cancel();return null;}
      const d=await response.json();
      if(d.code!=='Ok'||!Array.isArray(d.waypoints)||d.waypoints.length!==points.length
        ||d.waypoints.some((w:any)=>!Number.isFinite(w?.distance)||w.distance<0||w.distance>100
          ||!Array.isArray(w.location)||w.location.length!==2||!w.location.every(Number.isFinite)
          ||Math.abs(w.location[0])>180||Math.abs(w.location[1])>90))return null;
      return annotateRoute(d.routes?.[0],edges);
    } catch {return null;}
  }
  await Promise.all(Array.from({length:4},async()=>{
    while(queue.length && !expired()) {
      const job=queue.shift()!;
      const id=pair(job.a,job.b);
      if(!normals.has(id))normals.set(id,query([job.a,job.b]));
      const normal=await normals.get(id)!;
      if(!normal || expired())continue;
      const detour=await query([job.a,job.via,job.b]);
      if(detour)detour.via=job.via;
      // A detour is useful only if it demonstrably adds covered walking distance.
      const addsEvidence=detour && (detour.coveredKm>normal.coveredKm || detour.indoorKm>normal.indoorKm);
      if(normal.coveredKm>0 || addsEvidence) {
        const prior=result.get(pair(job.a,job.b))??[normal];
        result.set(pair(job.a,job.b),addsEvidence?[...prior,detour!]:prior);
      }
    }
  }));
  return result;
}
