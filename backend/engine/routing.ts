/** Server-only walking routes. One bounded table request per calculation, no retries. */
import { AsyncLocalStorage } from 'node:async_hooks';
import {hasShelterWeather, hasColdForecast, hasRainOrHeatForecast, rainProbability, isHeatDay, isColdDay, routingColdPreference, routingExposureWeight, shelterFallbackDescription, withConditionDate, weatherDescription, bagIncrement, bagExtraCost} from './conditions.ts';
import {prepareShelteredRoutes, selectShelteredRoute, type ShelteredRoute, type ShelterData} from './sheltered-routing.ts';

export interface Coordinate { lat: number; lng: number; id?: string; buildingId?: string }
type Failure = 'not_configured' | 'invalid_config' | 'unavailable' | 'timeout'
  | 'http_error' | 'no_route' | 'invalid_response' | 'outside_snapshot' | 'too_many_places';
export interface WalkingRoute {
  km: number;
  min: number;
  source: 'osrm-foot' | 'distance-estimate';
  fallbackReason?: Failure;
  coveredKm?: number;
  unknownKm?: number;
  indoorKm?: number;
  coveredWayIds?: number[];
}
export interface Move {
  km: number;
  min: number;
  mode: 'walk' | 'transit';
  walkKm: number;
  source: WalkingRoute['source'] | 'transit-estimate' | 'indoor-estimate';
  coveredKm?: number;
  unknownKm?: number;
  indoorKm?: number;

  fallbackReason?: Failure;
}
export interface RoutingOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  shelterData?: ShelterData | null;
}
interface Snapshot { routes: Map<string, WalkingRoute>; failure?: Failure; sheltered?: Map<string,ShelteredRoute[]> }
const context = new AsyncLocalStorage<Snapshot>();
export const DETOUR = 1.35;
const WALK_KMH = 4.2, TRANSIT_THRESHOLD_KM = 1.2;
const MAX_PLACES = 200, SNAP_RADIUS_M = 100;
const coordinateKey = (p: Coordinate) => `${p.lng},${p.lat}`;
const pairKey = (a: Coordinate, b: Coordinate) => `${coordinateKey(a)};${coordinateKey(b)}`;
const validCoordinate = (p: Coordinate) => p != null && Number.isFinite(p.lat) && Number.isFinite(p.lng)
  && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

/** Preserve the prototype's city-scale straight-line approximation exactly. */
export function distKm(a: Coordinate, b: Coordinate): number {
  const kx = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dx = (a.lng - b.lng) * kx * 111, dy = (a.lat - b.lat) * 111;
  return Math.sqrt(dx * dx + dy * dy);
}

export function estimateWalkingRoute(a: Coordinate, b: Coordinate, reason: Failure = 'not_configured'): WalkingRoute {
  if (!validCoordinate(a) || !validCoordinate(b)) throw new Error('Invalid routing coordinates');
  const km = distKm(a, b) * DETOUR;
  return {km, min: Math.round(km / WALK_KMH * 60), source:'distance-estimate', fallbackReason:reason};
}

function configuration(options: RoutingOptions) {
  const raw = options.baseUrl ?? process.env.OSRM_FOOT_URL;
  if (!raw) return {failure:'not_configured' as Failure};
  try {
    const url = new URL(raw);
    // These shared public servers are unsuitable for repeated catalogue matrices.
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
        || ['router.project-osrm.org', 'routing.openstreetmap.de'].includes(url.hostname)) throw Error();
    const requested = options.timeoutMs ?? Number(process.env.OSRM_TIMEOUT_MS || 2000);
    if (!Number.isFinite(requested) || requested < 1 || requested > 3000) throw Error();
    return {url:url.href.replace(/\/$/, ''), timeout:requested};
  } catch { return {failure:'invalid_config' as Failure}; }
}

async function request(service: 'route' | 'table', points: Coordinate[], options: RoutingOptions) {
  const config = configuration(options);
  if (config.failure) return {failure:config.failure};
  const query = new URLSearchParams({
    // Let OSRM snap every point, then reject distant waypoints per pair below.
    // A request-level radius can turn one distant point into a whole-table NoSegment.
    generate_hints:'false',
    ...(service === 'route' ? {overview:'false', steps:'false'} : {annotations:'distance,duration'}),
  });
  const signal = AbortSignal.timeout(config.timeout!);
  try {
    // 'foot' is a label; the OSRM dataset MUST have been extracted with foot.lua.
    const response = await (options.fetchImpl ?? fetch)(
      `${config.url}/${service}/v1/foot/${points.map(coordinateKey).join(';')}?${query}`,
      {signal, headers:{Accept:'application/json', 'User-Agent':'travel-recommender-routing/1.0'}, redirect:'error'});
    if (!response.ok) { await response.body?.cancel(); return {failure:'http_error' as Failure}; }
    let data;
    try { data = await response.json(); }
    catch { return {failure:(signal.aborted ? 'timeout' : 'invalid_response') as Failure}; }
    if (!data || data.code !== 'Ok') return {failure:(['NoRoute', 'NoTable', 'NoSegment'].includes(data?.code)
      ? 'no_route' : 'invalid_response') as Failure};
    return {data};
  } catch { return {failure:(signal.aborted ? 'timeout' : 'unavailable') as Failure}; }
}

function waypointValid(p: {distance?: number; location?: number[]}) {
  return p && Number.isFinite(p.distance) && p.distance! >= 0 && p.distance! <= SNAP_RADIUS_M
    && Array.isArray(p.location) && p.location.length === 2
    && validCoordinate({lng:p.location[0], lat:p.location[1]});
}
function decode(distance: unknown, duration: unknown, a: Coordinate, b: Coordinate): WalkingRoute {
  if (distance === null || duration === null) return estimateWalkingRoute(a, b, 'no_route');
  if (typeof distance !== 'number' || typeof duration !== 'number' || !Number.isFinite(distance)
      || !Number.isFinite(duration) || distance < 0 || duration < 0
      || (distance === 0) !== (duration === 0)) return estimateWalkingRoute(a, b, 'invalid_response');
  return {km:distance / 1000, min:Math.round(duration / 60), source:'osrm-foot'};
}

/** Two-point Route API helper. Failure always uses walking speed, never car speed. */
export async function queryWalkingRoute(a: Coordinate, b: Coordinate, options: RoutingOptions = {}): Promise<WalkingRoute> {
  const fallback = estimateWalkingRoute(a, b);
  if (coordinateKey(a) === coordinateKey(b)) return fallback;
  const {data, failure} = await request('route', [a, b], options);
  if (failure) return estimateWalkingRoute(a, b, failure);
  if (!Array.isArray(data.waypoints) || data.waypoints.length !== 2 || !data.waypoints.every(waypointValid)
      || !Array.isArray(data.routes) || !data.routes.length) return estimateWalkingRoute(a, b, 'invalid_response');
  return decode(data.routes[0]?.distance, data.routes[0]?.duration, a, b);
}

async function prepare(points: Coordinate[], options: RoutingOptions): Promise<Snapshot> {
  // An invalid catalogue row cannot poison valid locations' routes. Its use still raises below.
  const unique = [...new Map(points.filter(validCoordinate).map(p => [coordinateKey(p), p])).values()];
  const routes = new Map<string, WalkingRoute>();
  if (unique.length > MAX_PLACES) return {routes, failure:'too_many_places'};
  if (unique.length < 2) return {routes, failure:'outside_snapshot'};
  const {data, failure} = await request('table', unique, options);
  if (failure) return {routes, failure};
  const size = unique.length;
  const matrix = (m: unknown) => Array.isArray(m) && m.length === size
    && m.every(row => Array.isArray(row) && row.length === size);
  if (!matrix(data.distances) || !matrix(data.durations) || !Array.isArray(data.sources)
      || !Array.isArray(data.destinations) || data.sources.length !== size || data.destinations.length !== size) {
    return {routes, failure:'invalid_response'};
  }
  unique.forEach((a, i) => unique.forEach((b, j) => {
    // Keep direction: A→B and B→A need not have the same duration or distance.
    routes.set(pairKey(a, b), waypointValid(data.sources[i]) && waypointValid(data.destinations[j])
      ? decode(data.distances[i][j], data.durations[i][j], a, b)
      : estimateWalkingRoute(a, b, 'invalid_response'));
  }));
  return {routes};
}

/** Request-scoped cache covers selection, scheduling, AI checks and final metrics. */
export async function withRouting<T>(points: Coordinate[], calculate: () => T | Promise<T>, options: RoutingOptions = {}): Promise<T> {
  const snapshot = await prepare(points, options);
  const config = configuration(options);
  if (hasShelterWeather() && !snapshot.failure && config.url) {
    const unique=[...new Map(points.filter(validCoordinate).map(p=>[coordinateKey(p),p])).values()];
    snapshot.sheltered=await prepareShelteredRoutes(unique,snapshot.routes,
      {baseUrl:config.url,fetchImpl:options.fetchImpl,data:options.shelterData,
        kinds:[...(hasColdForecast()?['indoor' as const]:[]),...(hasRainOrHeatForecast()?['covered' as const]:[])]},distKm);
  }
  return context.run(snapshot, calculate);
}

export function travel(a: Coordinate, b: Coordinate): Move {
  // Store-map POIs are not indoor routing. Keep an explicit 5-minute transfer
  // estimate between distinct destinations in the SAME building, not adjacent wings.
  if (a.id && b.id && a.id !== b.id && a.buildingId && a.buildingId === b.buildingId) {
    return {km:0, min:5, mode:'walk', walkKm:0, source:'indoor-estimate'};
  }
  const estimated = estimateWalkingRoute(a, b);
  const snapshot = context.getStore();
  let route = snapshot?.routes.get(pairKey(a, b))
    ?? estimateWalkingRoute(a, b, snapshot?.failure ?? (snapshot ? 'outside_snapshot' : 'not_configured'));
  const alternatives=snapshot?.sheltered?.get(pairKey(a,b));
  const probability=routingExposureWeight();
  if(alternatives) route=selectShelteredRoute(alternatives,probability ?? 0,routingColdPreference());
  // Decide from the same walking distance that would enter the walking constraint.
  // Foot OSRM cannot model trains. Use the larger distance as a transit proxy so a
  // short straight-line gap cannot erase a known detour (or undercut access walking).
  if (route.km > TRANSIT_THRESHOLD_KM) {
    const km = Math.max(estimated.km, route.km);
    return {km, min:Math.round(km / 18 * 60) + 8, mode:'transit', walkKm:0.7, source:'transit-estimate'};
  }
  return {...route, mode:'walk', walkKm:route.km};
}

export const hasRoutingContext = () => context.getStore() !== undefined;

/** Existing API's summary field records actual final-leg sources without a schema change. */
function routingCounts(days: Coordinate[][]) {
  let osrm = 0, estimated = 0, transit = 0, indoor = 0;
  for (const places of days) for (let i = 1; i < places.length; i++) {
    const move = travel(places[i - 1], places[i]);
    if (move.source === 'osrm-foot') osrm++;
    else if (move.source === 'indoor-estimate') indoor++;
    else if (move.mode === 'transit') transit++;
    else estimated++;
  }
  return {osrm, estimated, transit, indoor};
}

/** Describe final legs, not merely the presence of a request-scoped context. */
export function routingLimitations(days: Coordinate[][]): string {
  const {osrm, estimated, transit, indoor} = routingCounts(days);
  const reason = context.getStore()?.failure;
  return `Final legs: foot OSRM ${osrm}, distance × 1.35 walking estimate ${estimated}, transit estimate ${transit}.`
    + (osrm === 0 ? ` No walking legs use OSRM${reason ? ` (${reason})` : ''}.` : '')
    + (indoor ? ` Same-building transfer estimate: ${indoor} legs × 5 min; indoor distance excluded.` : '')
    + ' Transit timetables, lodging access, venue walking, queues and actual weather effects on speed are not included.';

}

export function routingSummary(days: Coordinate[][]): string {
  const {osrm, estimated, transit, indoor} = routingCounts(days);
  return ` 이동 계산: OSRM 도보 ${osrm}구간, 직선거리×1.35 도보 추정 ${estimated}구간, 대중교통 추정 ${transit}구간. 교통 시간표·숙소 왕복·시설 내부 ${indoor ? '보행 거리' : '이동'}은 포함하지 않습니다.`
    + (indoor ? ` 같은 건물 내부 이동 ${indoor}구간은 각 5분 추정이며 내부 보행 거리는 제외됩니다.` : "");
}

/** Public aggregate only; private choices and route geometry stay inside the calculation. */
export function shelterSummary(days:{date:string;points:Coordinate[]}[]):string {
  let covered=0,unknown=0,detours=0,extraMin=0,rainDetour=false,heatDetour=false,coldDetour=false,otherDetour=false,indoor=0;
  for(const day of days) withConditionDate(day.date,()=>{
    for(let i=1;i<day.points.length;i++){
      const a=day.points[i-1],b=day.points[i];const m=travel(a,b);
      covered+=m.coveredKm??0;indoor+=m.indoorKm??0;
      unknown+=m.unknownKm??m.walkKm;
      const options=context.getStore()?.sheltered?.get(pairKey(a,b));
      if(m.source==='osrm-foot' && options && routingExposureWeight()>0 && selectShelteredRoute(options,routingExposureWeight(),routingColdPreference()).via){
        detours++;extraMin+=Math.max(0,m.min-options[0].min);
        rainDetour ||= (rainProbability()??0)>0; heatDetour ||= isHeatDay(); coldDetour ||= isColdDay(); otherDetour ||= !isColdDay();
      }
    }
  });
  const reason=[rainDetour?'비':'',heatDetour?'폭염':'',coldDetour?'추위':''].filter(Boolean).join('·');
  const notice=detours ? `\n날씨 경로 안내: ${reason} 예보를 고려해 ${coldDetour?(otherDetour?'추운 날은 실내 통로, 비·폭염에는 실내·지붕 구간':'실내 통로'):'실내·지붕 구간'}을 우선한 경로예요. 기존 경로보다 예상 이동 시간이 조금 더 걸릴 수 있어요(여행 전체 추가 약 ${extraMin}분). 이 시간은 일정에 반영했어요. 실내·지붕 정보만으로 냉난방 여부는 알 수 없어요.\n` : '';
  return ` 실내·지붕 경로: 날씨 예보에 따른 우회 ${detours}구간, OSM 실내·지붕 태그와 일치 ${covered.toFixed(2)}km(실내 ${indoor.toFixed(2)}km 포함), 실내·지붕 미확인 도보 ${unknown.toFixed(2)}km. 지도 정보이며 현장 개방 여부·안전·무장애 통행을 보장하지 않습니다.` + notice;
}

export type ConditionPoint = Coordinate & {bagLoad?:number};
export function travelBurdenTotals(points:ConditionPoint[]) {
  let load=0, extra=0, walk=0, covered=0, unknown=0;
  for(let i=0;i<points.length;i++) {
    if(i) {
      const m=travel(points[i-1],points[i]);
      walk+=m.walkKm; extra+=bagExtraCost(m.walkKm,load);
      covered+=m.coveredKm??0; unknown+=m.unknownKm??m.walkKm;
    }
    load+=bagIncrement(points[i].bagLoad);
  }
  return {walkKm:walk,bagExtra:extra,carryingCost:walk+extra,coveredKm:covered,unknownKm:unknown};
}
export function conditionSummary(days:{date:string;points:ConditionPoint[]}[]):string {
  const extra=days.reduce((sum,d)=>sum+withConditionDate(d.date,()=>travelBurdenTotals(d.points).bagExtra),0);
  return ` 짐 누적 운반 부담 +${extra.toFixed(2)}(상대점수; 무게·거리·요금 아님).`
    + weatherDescription() + shelterFallbackDescription() + shelterSummary(days);
}
