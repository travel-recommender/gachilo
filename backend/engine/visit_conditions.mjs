/** 방문 조건 안내 — 일정에 담긴 장소의 날짜별 휴무·영업시간·예약 조건을 출처·확인 시각과 함께 모은다.
 * (이슈 #6 「RAG 방문 조건 안내」 혜인 담당: 실시간 조회와 화면 연결)
 *
 * - 검토 자료: 카탈로그·날짜별 운영 프로필(availability)이 그날 열리는지, 어떤 조건이 붙는지 정한다.
 * - 실시간 조회: live_check.mjs(Google Places)로 그날 영업이 검토 자료와 같은지 다시 확인한다.
 * - 출처: 프로필 source_urls와 카탈로그 field_sources(영업시간·웹사이트)의 URL·확인일.
 *
 * AI 답변을 만들지 않는다. 화면은 여기서 나온 근거만 보여준다. 근거로 답하는 규칙은 윤진, 출처·날짜 관리는 조은 담당이며
 * 그 결과가 붙으면 이 응답에 더한다. 이 결과만으로 장소를 일정 가능 상태로 바꾸지 않는다 (일정 검사는 기존 엔진).
 *
 * stdin  {"placeIds": [...], "dates": ["YYYY-MM-DD", ...]}
 * stdout {"checkedOn", "liveSource", "places": [...]}
 */
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {availability, loadRuntimeInputs} from '../../scripts/validate_real_schedule.mjs';
import {defaultLiveCheck} from './live_check.mjs';

export const MAX_PLACES = 30;
export const MAX_DATES = 7;

/** 검토 자료가 붙인 조건 → 안내 문장. status: closed(그날 못 감) · check(확인 필요) */
const REVIEW_NOTICES = {
  closed_on_visit_date: {status: 'closed', text: '이 날은 정기 휴무 또는 공지된 휴무일이에요.'},
  entry_time_reservation_required: {status: 'check', text: '입장 시간 예약이 필요해요. 공식 사이트에서 예약 가능 여부를 확인하세요.'},
  visit_confirmation_required: {status: 'check', text: '이 날은 영업 여부를 방문 전에 공식 안내로 확인해야 해요.'},
  closure_notice_year_unconfirmed: {status: 'check', text: '휴무 공지의 연도가 확인되지 않아 영업 여부가 불확실해요.'},
  holiday_hours_unconfirmed: {status: 'check', text: '공휴일 영업시간이 확인되지 않았어요.'},
  price_not_applicable_on_visit_date: {status: 'check', text: '이 날은 검토한 가격이 적용되지 않아요. 요금을 다시 확인하세요.'},
  outside_reviewed_date_range: {status: 'check', text: '검토한 기간 밖의 날짜라 최신 공식 안내를 확인해야 해요.'},
  outside_place_reviewed_date_range: {status: 'check', text: '이 장소의 검토 기간 밖이라 최신 공식 안내를 확인해야 해요.'},
};
const OTHER_REVIEW = {status: 'check', text: '검토 자료에 확인되지 않은 항목이 있어요.'};

/** 실시간 조회 결과 코드 → 안내 문장 */
export const LIVE_TEXT = {
  live_closed_permanently: '실시간 조회에서 폐업으로 나와요.',
  live_closed_temporarily: '실시간 조회에서 임시 휴업으로 나와요.',
  live_closed_on_visit_date: '실시간 조회에서 이 날은 영업하지 않는 것으로 나와요.',
  live_hours_changed: '실시간 조회한 영업시간이 검토 자료와 달라요.',
  live_hours_unavailable: '실시간 조회에서 영업시간을 받지 못했어요.',
  live_status_unknown: '실시간 조회에서 영업 상태를 알 수 없어요.',
  live_lookup_failed: '실시간 조회에 실패했어요.',
  live_no_match: '실시간 조회에서 같은 장소를 확실히 찾지 못했어요.',
};
const LIVE_CLOSED = new Set(['live_closed_permanently', 'live_closed_temporarily', 'live_closed_on_visit_date']);

const hhmm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const urlsOf = s => (s?.urls ?? (s?.url ? [s.url] : [])).filter(u => typeof u === 'string' && /^https?:\/\//.test(u));

/** 장소의 출처 목록. 같은 URL은 한 번만, 가장 최근 확인일을 남긴다 */
export function sourcesOf(record, profile) {
  const out = new Map();
  const add = (url, label, checkedAt) => {
    const prev = out.get(url);
    if (!prev) out.set(url, {url, label, checkedAt: checkedAt ?? null});
    else if (checkedAt && (!prev.checkedAt || checkedAt > prev.checkedAt)) prev.checkedAt = checkedAt;
  };
  for (const url of profile?.source_urls ?? []) add(url, '운영 정보', profile.checked_at ?? null);
  const fs_ = record.field_sources ?? {};
  // 지도(OSM)에서 가져온 값은 공식 출처라고 부르지 않는다
  const labelOf = (src, url, official) => src?.kind === 'osm' || /openstreetmap\.org/.test(url) ? '지도 정보' : official;
  for (const url of urlsOf(fs_.opening_hours)) add(url, labelOf(fs_.opening_hours, url, '영업시간'), fs_.opening_hours.checked_at ?? null);
  for (const url of urlsOf(fs_.website)) add(url, labelOf(fs_.website, url, '공식 사이트'), fs_.website.checked_at ?? null);
  return [...out.values()];
}

/** 한 장소·날짜의 조건. live: 실시간 판정 이유 목록(빈 배열=확인됨) · null=조회 안 함 · 'unavailable'=조회 불가.
 * 실시간 '확인됨'은 Google 영업시간이 일정에 넣는 시간(scheduleHours)을 덮는다는 뜻이다 (live_check.mjs) */
export function conditionOf(record, date, profiles, live) {
  const check = availability(record, date, profiles, {allowShopping: true});
  const notices = [];
  let status = 'confirmed';
  const worse = s => {
    if (s === 'closed') status = 'closed';
    else if (s === 'check' && status === 'confirmed') status = 'check';
  };
  const known = check.reasons.filter(r => REVIEW_NOTICES[r]);
  for (const code of known) {
    notices.push({code, source: 'review', text: REVIEW_NOTICES[code].text});
    worse(REVIEW_NOTICES[code].status);
  }
  if (check.reasons.length > known.length) {
    notices.push({code: 'review_incomplete', source: 'review', text: OTHER_REVIEW.text});
    worse(OTHER_REVIEW.status);
  }
  // 실제 영업시간과 일정에 넣는 시간을 나눈다. 일정 엔진의 window는 점심 가격·심야 할증처럼 가격 조건 때문에
  // 실제 영업보다 좁게 잡은 곳이 있다(예: 카니도라쿠 영업 11–23시, 일정은 점심 가격 11–16시).
  // 그래서 window를 영업시간이라고 부르지 않는다. 영업시간은 카탈로그에 검토해 둔 문장 그대로 준다.
  const openingHours = status === 'closed' ? null : record.place.opening_hours ?? null;
  // latestStart: 일정 엔진이 이 시각 이후로는 방문을 시작하지 않는다 (입장 마감이 아니다)
  const scheduleHours = status === 'closed' ? [] : (check.windows ?? (check.window ? [check.window] : []))
    .filter(w => Array.isArray(w) && w.length === 3)
    .map(([open, close, latest]) => ({open: hhmm(open), close: hhmm(close), latestStart: latest < close ? hhmm(latest) : null}));

  let liveStatus;
  if (live === 'unavailable') {
    liveStatus = 'unavailable';
    notices.push({code: 'live_unavailable', source: 'live', text: '지금은 실시간 조회를 할 수 없어 검토 자료만 보여드려요.'});
    worse('check');
  } else if (live === null) {
    // 검토 자료로 이미 갈 수 없는 날은 조회하지 않는다 (유료 요청을 아낀다)
    liveStatus = 'not_checked';
  } else if (live.length === 0) {
    liveStatus = 'confirmed';
  } else {
    // closed: 실시간으로 그날 못 감 · changed: 영업시간이 검토 자료와 다름 · failed: 조회했지만 확인하지 못함
    liveStatus = live.some(c => LIVE_CLOSED.has(c)) ? 'closed' : live.includes('live_hours_changed') ? 'changed' : 'failed';
    for (const code of live) notices.push({code, source: 'live', text: LIVE_TEXT[code] ?? '실시간 조회 결과를 확인할 수 없어요.'});
    worse(liveStatus === 'closed' ? 'closed' : 'check');
  }
  // costBasis: 일정에 넣는 시간·가격을 그렇게 정한 조건. 화면에서 일정에 넣는 시간과 함께 보여준다
  return {date, status, openingHours, scheduleHours, costBasis: check.cost_basis ?? null, live: liveStatus, notices};
}

/** 요청 검사. 잘못되면 Error */
export function validateRequest(request) {
  const {placeIds, dates} = request ?? {};
  if (!Array.isArray(placeIds) || placeIds.length === 0 || placeIds.length > MAX_PLACES
      || placeIds.some(id => typeof id !== 'string') || new Set(placeIds).size !== placeIds.length) {
    throw Error(`placeIds must be 1-${MAX_PLACES} unique strings`);
  }
  if (!Array.isArray(dates) || dates.length === 0 || dates.length > MAX_DATES
      || dates.some(d => typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d))) {
    throw Error(`dates must be 1-${MAX_DATES} YYYY-MM-DD strings`);
  }
}

/** deps.liveCheck: live_check.mjs와 같은 형태. 기본은 Google(키 없으면 조회 불가로 표시하고 검토 자료는 그대로 준다) */
export async function visitConditions(request, dataset, profiles, deps = {}) {
  validateRequest(request);
  const byId = new Map(dataset.places.map(r => [r.place.place_id, r]));
  const unknown = request.placeIds.filter(id => !byId.has(id));
  if (unknown.length) throw Error('unknown placeIds: ' + unknown.join(','));

  // 검토 자료로 휴무가 아니고 영업 구간이 있는 날만 실시간으로 확인한다.
  // 예약·방문 전 확인이 필요한 곳도 갈 수는 있으므로 확인한다 (일정 엔진의 자동 배치 기준보다 넓다)
  const requests = request.placeIds.flatMap(id => request.dates.flatMap(date => {
    const record = byId.get(id);
    const check = availability(record, date, profiles, {allowShopping: true});
    const windows = check.windows ?? (check.window ? [check.window] : []);
    const usable = windows.length && !check.reasons.includes('closed_on_visit_date')
      && !check.reasons.includes('invalid_time_window') && !check.reasons.includes('structured_date_profile_missing');
    return usable ? [{record, date, windows}] : [];
  }));
  let live = null, liveError = false;
  if (requests.length) {
    try { live = await (deps.liveCheck ?? defaultLiveCheck())(requests); }
    // 키 없음(UNAVAILABLE)·네트워크 오류 모두 조회 불가로 표시하고 검토 자료는 그대로 준다
    catch { liveError = true; }
  }
  const asked = new Set(requests.map(r => `${r.record.place.place_id}|${r.date}`));

  const places = request.placeIds.map(id => {
    const record = byId.get(id);
    const profile = profiles.places[id];
    return {
      placeId: id,
      name: record.place.name_ko ?? record.place.name,
      reviewedThrough: profile?.valid_through ?? profiles.valid_through ?? null,
      sources: sourcesOf(record, profile),
      dates: request.dates.map(date => {
        const key = `${id}|${date}`;
        const verdict = !asked.has(key) ? null : liveError ? 'unavailable' : live.verdicts.get(key) ?? ['live_lookup_failed'];
        return conditionOf(record, date, profiles, verdict);
      }),
    };
  });
  return {
    checkedOn: live?.checked_on ?? null,
    liveSource: liveError ? 'unavailable' : live?.source ?? null,
    profilesCheckedAt: profiles.checked_at ?? null,
    places,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const request = JSON.parse(fs.readFileSync(0, 'utf8'));
    const {dataset, profiles} = loadRuntimeInputs();
    process.stdout.write(JSON.stringify(await visitConditions(request, dataset, profiles)) + '\n');
  } catch (error) {
    process.stderr.write(String(error?.message ?? error) + '\n');
    process.exitCode = 1;
  }
}
