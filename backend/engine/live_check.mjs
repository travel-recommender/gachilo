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
// 영업 상태·시간은 받은 날(일본 날짜) 안에서만 재사용한다. Google ID는 정책상 계속 보관할 수 있다.
// 매칭 규칙이 바뀌면 버전을 올려 예전 규칙으로 저장한 ID를 버린다.
const CACHE_VERSION = 2;
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

const daysBetween = (from, to) => (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000;
const minuteOf = t => t.hour * 60 + (t.minute ?? 0);

/** Opening intervals of one visit date, in minutes from its midnight and clipped to that day.
 * A period that opened the day before and runs past midnight counts too (월 22:00→화 06:00).
 * dated: current periods carry calendar dates (next 7 days); otherwise weekly regular periods.
 */
function intervalsOn(hours, date, dated) {
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  const out = [];
  for (const {open, close} of hours?.periods ?? []) {
    if (!open) continue;
    // 24시간 영업은 close 없이 일요일 0시 open 하나로 온다
    if (!close) { if (open.day === 0 && !open.hour && !open.minute) out.push([0, 1440]); continue; }
    // 방문일 0시 기준으로 며칠째에 열고 닫았나 (0=당일, -1=전날)
    let startDay, endDay;
    if (dated) {
      startDay = daysBetween(date, isoOf(open.date)); endDay = daysBetween(date, isoOf(close.date));
    } else {
      const ahead = (open.day - weekday + 7) % 7;
      startDay = ahead === 6 ? -1 : ahead;
      endDay = startDay + (close.day - open.day + 7) % 7;
    }
    if (!Number.isFinite(startDay) || !Number.isFinite(endDay)) continue;
    const a = startDay * 1440 + minuteOf(open), b = endDay * 1440 + minuteOf(close);
    if (b > 0 && a < 1440) out.push([Math.max(0, a), Math.min(1440, b)]);
  }
  return out;
}

/** One place-date verdict from Google details fetched on fetchedOn (Japan date).
 * Empty reasons = confirmed unchanged.
 */
export function judge(details, date, window, fetchedOn) {
  if (!details) return ['live_lookup_failed'];
  const status = details.businessStatus;
  if (status === 'CLOSED_PERMANENTLY') return ['live_closed_permanently'];
  if (status === 'CLOSED_TEMPORARILY') return ['live_closed_temporarily'];
  if (status !== 'OPERATIONAL') return ['live_status_unknown'];
  // 조회일 포함 7일은 특별 휴무까지 반영된 현재 영업시간으로, 그 뒤는 정규 영업시간으로 대조한다.
  // 범위는 '오늘'이 아니라 그 응답을 받은 날 기준이다 (캐시를 다음 날 쓰면 범위가 하루 밀린다)
  const dated = date >= fetchedOn && date <= addDays(fetchedOn, 6) && details.currentOpeningHours?.periods;
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
// 공백·가운뎃점·하이픈·괄호·따옴표 차이만 무시한다. 포함 관계(大阪城 ⊂ 大阪城公園)는 같은 이름이 아니다
const normName = s => (s ?? '').normalize('NFKC').toLowerCase().replace(/[\s・･·\-‐‑–—()（）「」『』'"’”.,、。]/g, '');
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

/** Google Place ID of the same place, or the failure reason.
 * Same place = same name (after normName) and within MATCH_METRES. A nearby shop under another
 * name is never accepted: its hours would vouch for a place that may be closed. When the name
 * differs on Google, link it by hand in data/google_place_links.json.
 */
async function findId(fetchImpl, key, place) {
  let failed = 0;
  for (const query of searchQueries(place)) {
    const found = await searchCandidates(fetchImpl, key, place, query);
    if (!found) { failed++; continue; }
    const same = found.filter(p => p.id && p.exact && !p.address && p.d <= MATCH_METRES).sort((a, b) => a.d - b.d);
    if (same.length) return {id: same[0].id};
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
    let cache = readJson(cacheUrl, {});
    if (cache.version !== CACHE_VERSION) cache = {version: CACHE_VERSION, ids: {}, details: {}};
    let fetched = 0, reused = 0;
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
        // 같은 일본 날짜에 받은 응답만 재사용한다. 날짜가 바뀌면 currentOpeningHours의 7일 범위도 바뀐다
        if (hit?.fetched_on === today) { reused++; detailsOf.set(id, hit); continue; }
        const data = await request(fetchImpl, `${BASE}/places/${encodeURIComponent(gid)}`, {method: 'GET',
          headers: {'X-Goog-FieldMask': 'id,businessStatus,regularOpeningHours,currentOpeningHours'}}, key.trim());
        const entry = {fetched_at: now().toISOString(), fetched_on: today, data};
        if (data) { fetched++; cache.details[gid] = entry; }
        detailsOf.set(id, entry);
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
      verdicts.set(`${record.place.place_id}|${date}`, typeof d === 'string' ? [d] : judge(d.data, date, window, d.fetched_on));
    }
    // checked_on: 판정에 쓴 응답을 받은 날짜. 새로 조회한 수와 같은 날 캐시를 재사용한 수를 따로 센다
    return {verdicts, source: 'google_places', checked_on: today, fetched, reused};
  };
}

/** Offline stand-in for tests and audits. Never used unless LIVE_CHECK_MOCK is set. */
export function mockLiveCheck(mode) {
  return async requests => ({source: 'mock', checked_on: null, fetched: 0, reused: 0,
    verdicts: new Map(requests.map(r => [`${r.record.place.place_id}|${r.date}`, mode === 'pass' ? [] : ['live_lookup_failed']]))});
}

export function defaultLiveCheck() {
  const mock = process.env.LIVE_CHECK_MOCK;
  return mock ? mockLiveCheck(mock) : googleLiveCheck();
}
