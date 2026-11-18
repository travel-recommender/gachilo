/** Place-scoped RAG evidence. No network, LLM, or scheduling mutation. */
import {createHash} from 'node:crypto';

export const EVIDENCE_SCHEMA = 1;
export const MAX_AGE_DAYS = 30; // Recheck policy, not a claim that a source stays true for 30 days.
const FIELDS = new Set(['opening_hours', 'cost', 'website', 'operating_rules', 'operating_exception', 'reservation']);
const OPERATIONAL = new Set(['opening_hours', 'cost', 'operating_rules', 'operating_exception', 'reservation']);
const OFFICIAL = new Set(['official_web_review', 'official_source_collection', 'official_site',
  'dated_official_review', 'official_tourism_review', 'official_tourism_site',
  'official_branch_page_review', 'official_social_review', 'official_menu', 'official_admission', 'official_menu_reference']);
const RULES = ['window', 'windows', 'weekday_window', 'closed_weekdays', 'closed_holidays',
  'holiday_moves_closure', 'extended_weekdays', 'extend_before_holiday', 'extended_window',
  'requires_visit_confirmation', 'confirmation_weekdays', 'confirmation_holidays',
  'holiday_hours_unconfirmed', 'uncertain_dates', 'entry_time_reservation',
  'price_unavailable_weekdays', 'price_unavailable_holidays', 'cost_basis'];
export const dateOnly = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
export function safeSourceUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    return ['https:', 'http:'].includes(u.protocol) && u.hostname && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}
const urls = source => [...new Set([...(source?.urls ?? []), ...(source?.url ? [source.url] : [])]
  .map(safeSourceUrl).filter(Boolean))];
const canonical = v => JSON.stringify(v, (_, x) => x && !Array.isArray(x) && typeof x === 'object'
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
function checked(value, today, maxAgeDays) {
  const precision = dateOnly(value) ? 'day' : typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && dateOnly(value.slice(0,10)) && Number.isFinite(Date.parse(value)) ? 'instant' : 'unknown';
  if (precision === 'unknown') return {checkedAt: null, checkedPrecision: precision, freshness: 'unknown'};
  const checkedDay = precision === 'instant' ? new Date(value).toLocaleDateString('en-CA', {timeZone:'Asia/Tokyo'}) : value;
  const age = (Date.parse(today) - Date.parse(checkedDay)) / 86400000;
  return {checkedAt: value, checkedPrecision: precision, freshness: age < 0 ? 'future' : age > maxAgeDays ? 'stale' : 'current'};
}
function sourceType(kind, url, officialHost) {
  const host = new URL(url).hostname;
  const normalizedHost = h => h?.toLowerCase().replace(/^www\./, '');
  if (host === 'openstreetmap.org' || host.endsWith('.openstreetmap.org')
      || /(^|\.)(google\.[a-z.]+|goo\.gl)$/.test(host)) return 'map';
  if (kind?.startsWith('user_') || kind === 'google_maps_manual_review') return 'manual';
  if (OFFICIAL.has(kind) || (['dated_branch_review', 'published_menu', 'reviewed_profile'].includes(kind) && normalizedHost(host) === normalizedHost(officialHost))) return 'official';
  return 'reviewed';
}
function period(from, through) {
  const invalid = (from != null && !dateOnly(from)) || (through != null && !dateOnly(through))
    || (dateOnly(from) && dateOnly(through) && from > through);
  return {validFrom: dateOnly(from) ? from : null, validThrough: dateOnly(through) ? through : null, periodInvalid: invalid};
}
function applicable(e, date) {
  if ((e.validFrom && date < e.validFrom) || (e.validThrough && date > e.validThrough)) return 'outside';
  if (e.periodInvalid) return 'unknown';
  return e.validFrom && e.validThrough ? 'inside' : 'unknown';
}

/** Existing field provenance + calendar + optional explicitly reviewed concurrent assertions.
 * Additional assertions live at record.review.visit_evidence; place_id must match exactly.
 * Import time and the profiles file's global checked_at are never source verification times. */
export function evidenceOf(record, profiles, {today = new Date().toLocaleDateString('en-CA', {timeZone:'Asia/Tokyo'}), maxAgeDays = MAX_AGE_DAYS} = {}) {
  if (!dateOnly(today) || !Number.isInteger(maxAgeDays) || maxAgeDays < 0) throw Error('invalid evidence evaluation policy');
  const placeId = record.place.place_id, profile = profiles.places?.[placeId];
  const officialHost = safeSourceUrl(record.place.website) ? new URL(record.place.website).hostname : null;
  const entries = [];
  const add = (field, value, source = {}, state = 'current', validity = {}) => {
    if (value === undefined || value === null) return;
    // A corroborating source may be explicitly downgraded; it cannot promote a URL.
    const reviewedUrls = new Set((source.reviewed_urls ?? []).map(safeSourceUrl).filter(Boolean));
    const sourceUrls = urls(source).map(url => ({url, kind: reviewedUrls.has(url) ? 'reviewed' : sourceType(source.kind, url, officialHost)}));
    const entry = {placeId, field, value, state, sourceKind: source.kind ?? 'unrecorded', sources: sourceUrls,
      ...checked(source.checked_at, today, maxAgeDays), ...period(validity.valid_from ?? source.valid_from, validity.valid_through ?? source.valid_through),
      note: typeof source.note === 'string' ? source.note : null};
    // Identity uses the assertion, not the date on which freshness was evaluated.
    entry.id = 'e_' + createHash('sha256').update(canonical({...entry, freshness: undefined})).digest('hex').slice(0,24);
    if (!entries.some(e => e.id === entry.id)) entries.push(entry);
  };
  for (const field of ['opening_hours', 'cost', 'website']) {
    let source = record.field_sources?.[field] ?? {}, value = record.place[field];
    add(field, value, source);
    for (let depth = 0; source.previous && depth < 12; depth++) {
      value = source.previous.value; source = source.previous.source ?? {};
      add(field, value, source, 'superseded');
    }
  }
  if (profile) {
    // Intersection, matching availability's global + place-specific limits.
    const starts = [profiles.valid_from, profile.valid_from].filter(dateOnly);
    const ends = [profiles.valid_through, profile.valid_through].filter(dateOnly);
    const validity = {valid_from: starts.sort().at(-1), valid_through: ends.sort().at(0)};
    if ([profiles.valid_from, profiles.valid_through, profile.valid_from, profile.valid_through].some(v => v != null && !dateOnly(v))) validity.valid_from = 'invalid';
    const source = {kind: 'reviewed_profile', urls: profile.source_urls ?? [], checked_at: profile.checked_at};
    add('operating_rules', Object.fromEntries(RULES.filter(k => profile[k] !== undefined).map(k => [k, profile[k]])), source, 'current', validity);
    for (const [date, exception] of Object.entries(profile.exceptions ?? {})) {
      if (!dateOnly(date)) throw Error('invalid operating exception date');
      add('operating_exception', exception, {...source, urls: exception.source_urls ?? source.urls,
        checked_at: exception.checked_at ?? source.checked_at}, 'current', {valid_from: [date, validity.valid_from].filter(dateOnly).sort().at(-1),
          valid_through: [date, validity.valid_through].filter(dateOnly).sort().at(0)});
    }
  }
  for (const e of record.review?.visit_evidence ?? []) {
    if (e.place_id !== placeId || !FIELDS.has(e.field) || !['current','superseded'].includes(e.state ?? 'current')
        || e.value === undefined || e.value === null) throw Error('invalid place-scoped visit evidence');
    add(e.field, e.value, e, e.state ?? 'current');
  }
  return {schemaVersion: EVIDENCE_SCHEMA, placeId, evaluatedOn: today, maxAgeDays, entries};
}

export const EVIDENCE_NOTICES = {
  evidence_invalid: '이 장소의 운영 근거 형식에 오류가 있어요. 공식 안내로 확인하세요.',
  evidence_missing: '운영 조건의 출처가 충분히 연결되지 않았어요. 공식 안내를 다시 확인하세요.',
  evidence_stale: '확인한 지 오래된 운영 자료가 있어요. 방문 전 최신 안내를 확인하세요.',
  evidence_unverified: '공식 안내로 확인되지 않은 운영 자료가 있어요. 참고 정보로만 확인하세요.',
  evidence_date_unknown: '확인 날짜가 기록되지 않은 운영 자료가 있어요.',
  evidence_future: '자료의 확인 날짜가 현재보다 뒤로 기록되어 재검토가 필요해요.',
  evidence_period: '방문일에 적용할 수 있는 운영 자료의 기간을 확인해야 해요.',
  evidence_conflict: '같은 항목의 자료가 서로 달라요. 어느 정보가 맞는지 공식 안내로 확인하세요.',
};
export function evidenceForDate(evidence, date) {
  if (!dateOnly(date)) throw Error('invalid evidence visit date');
  const current = evidence.entries.filter(e => e.state === 'current' && OPERATIONAL.has(e.field));
  const active = current.filter(e => applicable(e,date) !== 'outside');
  const reasons = new Set(), conflicts = [];
  if (!active.length || !active.some(e => e.field === 'operating_rules') || active.some(e => !e.sources.length)) reasons.add('evidence_missing');
  const rules = current.filter(e => e.field === 'operating_rules');
  if (!rules.length || rules.some(e => applicable(e,date) !== 'inside')) reasons.add('evidence_period');
  for (const e of active) {
    if (e.periodInvalid) reasons.add('evidence_period');
    if (e.sources.length && !e.sources.some(s => s.kind === 'official')) reasons.add('evidence_unverified');
    if (e.freshness === 'stale') reasons.add('evidence_stale');
    if (e.freshness === 'unknown') reasons.add('evidence_date_unknown');
    if (e.freshness === 'future') reasons.add('evidence_future');
  }
  for (const field of OPERATIONAL) {
    const same = active.filter(e => e.field === field);
    if (new Set(same.map(e => canonical(e.value))).size > 1) {
      conflicts.push({field, evidenceIds: same.map(e => e.id)}); reasons.add('evidence_conflict');
    }
  }
  return {date, status: reasons.size ? 'check' : 'usable', reasons: [...reasons], conflicts,
    applicableEvidenceIds: active.map(e => e.id),
    // Historical/expired/undated evidence can be displayed as a reference, not asserted as current fact.
    usableEvidenceIds: active.filter(e => e.freshness === 'current' && e.sources.some(s => s.kind === 'official') && applicable(e,date) === 'inside'
      && !conflicts.some(c => c.evidenceIds.includes(e.id))).map(e => e.id)};
}
