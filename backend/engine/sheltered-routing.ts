/** Roof evidence is matched by OSM node pairs, never by a venue's indoor flag. */
import fs from 'node:fs';
type Point = {lat:number; lng:number};
type Way = {osm_way_id:number; nodes:number[]; geometry:Point[]; tags:Record<string,string>};
export type ShelterData = {schema_version:number; osm_timestamp:string; ways:Way[]};
export type ShelteredRoute = {km:number; min:number; source:'osrm-foot'; coveredKm:number;
  unknownKm:number; coveredWayIds:number[]; via?:Point; geometry:Point[]};
const key = (p:Point) => `${p.lng},${p.lat}`;
const edge = (a:number,b:number) => a < b ? `${a}:${b}` : `${b}:${a}`;
export const pair = (a:Point,b:Point) => `${key(a)};${key(b)}`;

export function loadShelterData(): ShelterData | null {
  try { return JSON.parse(fs.readFileSync(new URL('../../data/sheltered_paths.json',import.meta.url),'utf8')); }
  catch { return null; }
}

function validWay(w:Way):boolean {
  return Number.isSafeInteger(w?.osm_way_id) && w.osm_way_id>0
    && Array.isArray(w.nodes) && w.nodes.length>=2 && w.nodes.every(n=>Number.isSafeInteger(n)&&n>0)
    && Array.isArray(w.geometry) && w.nodes.length===w.geometry.length
    && w.geometry.every(p=>Number.isFinite(p?.lat)&&Number.isFinite(p?.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180)
    && ['yes','arcade','colonnade'].includes(w.tags?.covered)
    && ['footway','pedestrian','path'].includes(w.tags?.highway)
    && !['access','foot'].some(k=>['no','private','customers','permit','delivery'].includes(w.tags[k]))
    && !Object.keys(w.tags).some(k=>k.includes('conditional')||['opening_hours','construction'].includes(k));
}
export function roofEdges(data:ShelterData): Map<string,number> {
  const edges = new Map<string,number>();
  if (data?.schema_version !== 1 || !Array.isArray(data.ways)) return edges;
  for (const w of data.ways.filter(validWay)) {
    for (let i=1;i<w.nodes.length;i++) edges.set(edge(w.nodes[i-1],w.nodes[i]),w.osm_way_id);
  }
  return edges;
}

export function annotateRoute(route:any, edges:Map<string,number>): ShelteredRoute | null {
  if (!Number.isFinite(route?.distance) || route.distance <= 0 || !Number.isFinite(route.duration) || route.duration <= 0
    || !Array.isArray(route.legs) || !Array.isArray(route.geometry?.coordinates)) return null;
  let total=0, covered=0; const ids=new Set<number>();
  for (const leg of route.legs) {
    const a=leg.annotation;
    if (!Array.isArray(a?.nodes) || !Array.isArray(a?.distance) || a.nodes.length!==a.distance.length+1) return null;
    for (let i=0;i<a.distance.length;i++) {
      const d=a.distance[i];
      if (!Number.isFinite(d) || d<0 || !Number.isSafeInteger(a.nodes[i]) || !Number.isSafeInteger(a.nodes[i+1])) return null;
      total+=d; const way=edges.get(edge(a.nodes[i],a.nodes[i+1]));
      if (way !== undefined) {covered+=d;ids.add(way);}
    }
  }
  if (Math.abs(total-route.distance)>Math.max(2,route.distance*0.01)) return null;
  const geometry=route.geometry.coordinates.map((p:any)=>({lng:p[0],lat:p[1]}));
  if (geometry.length<2 || geometry.some((p:Point)=>!Number.isFinite(p.lat)||!Number.isFinite(p.lng)
      ||Math.abs(p.lat)>90||Math.abs(p.lng)>180)) return null;
  return {km:route.distance/1000,min:Math.round(route.duration/60),source:'osrm-foot',
    coveredKm:covered/1000,unknownKm:Math.max(0,route.distance-covered)/1000,coveredWayIds:[...ids],geometry};
}

/** Selection cost: distance + p(rain) × distance not evidenced as covered.
 * Unknown edges are conservatively penalized; this does not label them known outdoor.
 * A roof detour must stay walkable (<=1.2km), within +35% and +5min of the dry route.
 */
export function selectShelteredRoute(routes:ShelteredRoute[], probability:number): ShelteredRoute {
  const base=routes[0];
  if (!(probability>0 && probability<=1)) return base;
  return routes.filter(r=>r.km<=1.2 && r.km<=base.km*1.35 && r.min<=base.min+5)
    .reduce((best,r)=>r.km+probability*r.unknownKm < best.km+probability*best.unknownKm ? r:best,base);
}

export async function prepareShelteredRoutes(points:Point[], base:Map<string,{km:number;source:string}>,
  options:{baseUrl:string;fetchImpl?:typeof fetch;data?:ShelterData|null}, distance:(a:Point,b:Point)=>number) {
  const data=options.data===undefined?loadShelterData():options.data;
  const result=new Map<string,ShelteredRoute[]>();
  if (!data) return result;
  const edges=roofEdges(data);
  if (!edges.size) return result;
  const midpoints=data.ways.filter(validWay).map(w=>w.geometry[Math.floor(w.geometry.length/2)]).filter(Boolean);
  const jobs:{a:Point;b:Point;via:Point;score:number}[]=[];
  for (const a of points) for (const b of points) {
    const route=base.get(pair(a,b));
    if (!route || route.source!=='osrm-foot' || route.km<=0 || route.km>1.2) continue;
    const via=midpoints
      .filter(p=>p && distance(a,p)>0.015 && distance(b,p)>0.015)
      .map(p=>({p,d:distance(a,p)+distance(p,b)})).filter(p=>p.d<=route.km*1.3)
      .sort((x,y)=>x.d-y.d)[0];
    if(via) jobs.push({a,b,via:via.p,score:via.d});
  }
  // Bound latency and work even for 150 selected places. Unexamined pairs keep Table routes.
  const queue=jobs.sort((a,b)=>a.score-b.score).slice(0,16);
  const signal=AbortSignal.timeout(2500);
  async function query(points:Point[]) {
    try {
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
    while(queue.length && !signal.aborted) {
      const job=queue.shift()!;
      const normal=await query([job.a,job.b]);
      if(!normal || signal.aborted)continue;
      const detour=await query([job.a,job.via,job.b]);
      if(detour)detour.via=job.via;
      // A detour is useful only if it demonstrably adds covered walking distance.
      result.set(pair(job.a,job.b),detour && detour.coveredKm>normal.coveredKm ? [normal,detour]:[normal]);
    }
  }));
  return result;
}
