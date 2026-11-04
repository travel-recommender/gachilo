/** Live check before a real place enters a schedule (Google Places API New).
 * The reviewed Excel/JSON data stays the plan; Google only confirms it has not changed.
 * A place passes a date only if Google reports OPERATIONAL and its hours on that date cover
 * the reviewed window. No key, timeout, no confident match or no hours → the place fails.
 *
 * 환경변수
 *   GOOGLE_PLACES_API_KEY   필수. 없으면 LIVE_CHECK_UNAVAILABLE로 계산을 멈춘다
 *   LIVE_CHECK_TIMEOUT_MS   요청 1건 제한, 기본 8000
 *   LIVE_CHECK_MOCK         검사용. pass=모두 통과 · fail=모두 조회 실패 (외부 호출 없음)
 */
import fs from 'node:fs';

const BASE = 'https://places.googleapis.com/v1';
const LINKS_URL = new URL('../../data/google_place_links.json', import.meta.url);
const CACHE_URL = new URL('../.local/live_places.json', import.meta.url);
// 영업 상태·시간은 '오늘' 기준이라 하루만 재사용한다. Google ID는 정책상 계속 보관할 수 있다.
const DETAILS_TTL_MS = 24 * 3600 * 1000;
const MATCH_METRES = 150;
const CONCURRENCY = 4;

export const UNAVAILABLE = 'LIVE_CHECK_UNAVAILABLE';

const metres = (a, b) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
};
const japanToday = now => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Tokyo'}).format(now);
const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const isoOf = d => d && `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

/** Does the union of opening intervals cover [from, to)? Minutes from the visit date's midnight. */
function covers(intervals, from, to) {
  let reach = from;
  for (const [a, b] of [...intervals].sort((x, y) => x[0] - y[0])) {
    if (a > reach) break;
    reach = Math.max(reach, b);
    if (reach >= to) return true;
  }
  return reach >= to;
}

/** Opening intervals on one date. current: date-stamped periods (next 7 days); regular: weekly. */
function intervalsOn(hours, date, dated) {
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  const out = [];
  for (const {open, close} of hours?.periods ?? []) {
    if (!open) continue;
    // 24시간 영업은 close 없이 일요일 0시 open 하나로 온다
    if (!close) { if (open.day === 0 && !open.hour && !open.minute) out.push([0, 1440]); continue; }
    const starts = dated ? isoOf(open.date) === date : open.day === weekday;
    if (!starts) continue;
    const a = open.hour * 60 + (open.minute ?? 0);
    const sameDay = dated ? isoOf(close.date) === date : close.day === open.day;
    out.push([a, close.hour * 60 + (close.minute ?? 0) + (sameDay ? 0 : 1440)]);
  }
  return out;
}

/** One place-date verdict from Google details. Empty reasons = confirmed unchanged. */
export function judge(details, date, window, today) {
  if (!details) return ['live_lookup_failed'];
  const status = details.businessStatus;
  if (status === 'CLOSED_PERMANENTLY') return ['live_closed_permanently'];
  if (status === 'CLOSED_TEMPORARILY') return ['live_closed_temporarily'];
  if (status !== 'OPERATIONAL') return ['live_status_unknown'];
  // 7일 안의 날짜는 특별 휴무까지 반영된 현재 영업시간으로, 그 뒤는 정규 영업시간으로 대조한다
  const dated = date >= today && date <= addDays(today, 6) && details.currentOpeningHours?.periods;
  const hours = dated ? details.currentOpeningHours : details.regularOpeningHours;
  if (!hours?.periods?.length) return ['live_hours_unavailable'];
  const intervals = intervalsOn(hours, date, Boolean(dated));
  if (!intervals.length) return ['live_closed_on_visit_date'];
  return covers(intervals, window[0], window[1]) ? [] : ['live_hours_changed'];
}

function readJson(url, fallback) {
  try { return JSON.parse(fs.readFileSync(url, 'utf8')); } catch { return fallback; }
}

async function request(fetchImpl, url, init, key) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Number(process.env.LIVE_CHECK_TIMEOUT_MS ?? 8000));
  try {
    // redirect: error — never forward the key to another host
    const r = await fetchImpl(url, {...init, redirect: 'error', signal: ctl.signal,
      headers: {...init.headers, 'X-Goog-Api-Key': key}});
    if (!r.ok) return null; // No retry: each call is billable.
    return await r.json();
  } catch { return null; } finally { clearTimeout(timer); }
}

// 주소 검색 결과(番地 자체)는 장소가 아니다. 영업 정보가 없으므로 같은 장소로 보지 않는다
const ADDRESS_TYPES = new Set(['street_address', 'premise', 'subpremise', 'route', 'geocode', 'plus_code', 'postal_code']);
const normName = s => (s ?? '').normalize('NFKC').replace(/\s/g, '').toLowerCase();
// 이름만 먼저, 안 되면 이름+주소. 주소를 붙이면 Google이 장소 대신 주소를 돌려주는 경우가 있다(大阪城 → 大阪城1-1)
export const searchQueries = place => [place.name, `${place.name} ${place.address}`];

/** Text Search candidates with their distance from our coordinates; null when the request failed. */
export async function searchCandidates(fetchImpl, key, place, textQuery = searchQueries(place)[0]) {
  const at = {lat: place.latitude, lng: place.longitude};
  const data = await request(fetchImpl, `${BASE}/places:searchText`, {method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Goog-FieldMask': 'places.id,places.location,places.displayName,places.types'},
    body: JSON.stringify({textQuery, languageCode: 'ja', regionCode: 'JP', pageSize: 5,
      locationBias: {circle: {center: {latitude: at.lat, longitude: at.lng}, radius: 300}}})}, key);
  if (!data) return null;
  return (data.places ?? []).map(p => ({id: p.id, name: p.displayName?.text ?? null,
    address: (p.types ?? []).some(t => ADDRESS_TYPES.has(t)),
    exact: normName(p.displayName?.text) === normName(place.name),
    d: p.location ? metres(at, {lat: p.location.latitude, lng: p.location.longitude}) : Infinity}));
}

/** Google Place ID within MATCH_METRES of our coordinates, or the failure reason.
 * Same-name results win over closer ones (大阪城 vs 大阪城公園 are both nearby).
 */
async function findId(fetchImpl, key, place) {
  let failed = 0;
  for (const query of searchQueries(place)) {
    const found = await searchCandidates(fetchImpl, key, place, query);
    if (!found) { failed++; continue; }
    const near = found.filter(p => p.id && !p.address && p.d <= MATCH_METRES)
      .sort((a, b) => Number(b.exact) - Number(a.exact) || a.d - b.d);
    if (near.length) return {id: near[0].id};
  }
  // 요청 실패는 '같은 장소 없음'과 구분한다
  return {reason: failed === searchQueries(place).length ? 'live_lookup_failed' : 'live_no_match'};
}

/** Google lookup with a small local cache (backend/.local, gitignored). */
export function googleLiveCheck({key = process.env.GOOGLE_PLACES_API_KEY, fetchImpl = fetch,
  cacheUrl = CACHE_URL, now = () => new Date()} = {}) {
  return async function check(requests) {
    if (!key?.trim()) throw Error(UNAVAILABLE);
    const today = japanToday(now());
    const links = new Map((readJson(LINKS_URL, {links: []}).links ?? [])
      .filter(l => l.status === 'linked').map(l => [l.place_id, l.google_place_id]));
    const cache = readJson(cacheUrl, {ids: {}, details: {}});
    cache.ids ??= {}; cache.details ??= {};
    const records = new Map(requests.map(r => [r.record.place.place_id, r.record]));
    const detailsOf = new Map();
    const queue = [...records.values()];
    const worker = async () => {
      for (let record; (record = queue.shift());) {
        const id = record.place.place_id;
        let gid = links.get(id) ?? cache.ids[id];
        if (gid === undefined) {
          const found = await findId(fetchImpl, key.trim(), record.place);
          if (!found.id) { detailsOf.set(id, found.reason); continue; }
          gid = cache.ids[id] = found.id;
        }
        const hit = cache.details[gid];
        if (hit && now() - Date.parse(hit.fetched_at) < DETAILS_TTL_MS) { detailsOf.set(id, hit.data); continue; }
        const data = await request(fetchImpl, `${BASE}/places/${encodeURIComponent(gid)}`, {method: 'GET',
          headers: {'X-Goog-FieldMask': 'id,businessStatus,regularOpeningHours,currentOpeningHours'}}, key.trim());
        if (data) cache.details[gid] = {fetched_at: now().toISOString(), data};
        detailsOf.set(id, data);
      }
    };
    await Promise.all(Array.from({length: CONCURRENCY}, worker));
    try {
      fs.mkdirSync(new URL('.', cacheUrl), {recursive: true});
      fs.writeFileSync(cacheUrl, JSON.stringify(cache));
    } catch { /* A cache write failure must not change the verdicts. */ }
    const verdicts = new Map();
    for (const {record, date, window} of requests) {
      const d = detailsOf.get(record.place.place_id);
      verdicts.set(`${record.place.place_id}|${date}`, typeof d === 'string' ? [d] : judge(d, date, window, today));
    }
    return {verdicts, source: 'google_places', checked_on: today};
  };
}

/** Offline stand-in for tests and audits. Never used unless LIVE_CHECK_MOCK is set. */
export function mockLiveCheck(mode) {
  return async requests => ({source: 'mock', checked_on: null,
    verdicts: new Map(requests.map(r => [`${r.record.place.place_id}|${r.date}`, mode === 'pass' ? [] : ['live_lookup_failed']]))});
}

export function defaultLiveCheck() {
  const mock = process.env.LIVE_CHECK_MOCK;
  return mock ? mockLiveCheck(mock) : googleLiveCheck();
}
