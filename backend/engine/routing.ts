/** Server-only walking routes. One bounded table request per calculation, no retries. */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface Coordinate { lat: number; lng: number }
type Failure = 'not_configured' | 'invalid_config' | 'unavailable' | 'timeout'
  | 'http_error' | 'no_route' | 'invalid_response' | 'outside_snapshot' | 'too_many_places';
export interface WalkingRoute {
  km: number;
  min: number;
  source: 'osrm-foot' | 'distance-estimate';
  fallbackReason?: Failure;
}
export interface Move {
  km: number;
  min: number;
  mode: 'walk' | 'transit';
  walkKm: number;
  source: WalkingRoute['source'] | 'transit-estimate';
  fallbackReason?: Failure;
}
export interface RoutingOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}
interface Snapshot { routes: Map<string, WalkingRoute>; failure?: Failure }
const context = new AsyncLocalStorage<Snapshot>();
const DETOUR = 1.35, WALK_KMH = 4.2, TRANSIT_THRESHOLD_KM = 1.2;
const MAX_PLACES = 200, SNAP_RADIUS_M = 100;
const coordinateKey = (p: Coordinate) => `${p.lng},${p.lat}`;
const pairKey = (a: Coordinate, b: Coordinate) => `${coordinateKey(a)};${coordinateKey(b)}`;
const validCoordinate = (p: Coordinate) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
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
    if (!Number.isFinite(requested) || requested < 1) throw Error();
    return {url:url.href.replace(/\/$/, ''), timeout:Math.min(requested, 3000)};
  } catch { return {failure:'invalid_config' as Failure}; }
}

async function request(service: 'route' | 'table', points: Coordinate[], options: RoutingOptions) {
  const config = configuration(options);
  if (config.failure) return {failure:config.failure};
  const query = new URLSearchParams({
    radiuses:points.map(() => SNAP_RADIUS_M).join(';'), generate_hints:'false',
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
  const same = coordinateKey(a) === coordinateKey(b);
  if (typeof distance !== 'number' || typeof duration !== 'number' || !Number.isFinite(distance)
      || !Number.isFinite(duration) || distance < 0 || duration < 0
      || !same && (distance === 0 || duration === 0)) return estimateWalkingRoute(a, b, 'invalid_response');
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
  return context.run(snapshot, calculate);
}

export function travel(a: Coordinate, b: Coordinate): Move {
  const estimated = estimateWalkingRoute(a, b);
  // Preserve mode selection and the previous transit heuristic. Foot OSRM cannot model trains.
  if (estimated.km > TRANSIT_THRESHOLD_KM) return {km:estimated.km,
    min:Math.round(estimated.km / 18 * 60) + 8, mode:'transit', walkKm:0.7, source:'transit-estimate'};
  const snapshot = context.getStore();
  const route = snapshot?.routes.get(pairKey(a, b))
    ?? estimateWalkingRoute(a, b, snapshot?.failure ?? (snapshot ? 'outside_snapshot' : 'not_configured'));
  return {...route, mode:'walk', walkKm:route.km};
}

export const hasRoutingContext = () => context.getStore() !== undefined;

/** Existing API's summary field records actual final-leg sources without a schema change. */
export function routingSummary(days: Coordinate[][]): string {
  let osrm = 0, estimated = 0, transit = 0;
  for (const places of days) for (let i = 1; i < places.length; i++) {
    const move = travel(places[i - 1], places[i]);
    if (move.source === 'osrm-foot') osrm++;
    else if (move.mode === 'transit') transit++;
    else estimated++;
  }
  return ` 이동 계산: OSRM 도보 ${osrm}구간, 직선거리×1.35 도보 추정 ${estimated}구간, 대중교통 추정 ${transit}구간. 교통 시간표·숙소 왕복·시설 내부 이동은 포함하지 않습니다.`;
}
