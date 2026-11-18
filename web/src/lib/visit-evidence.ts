/** Additive source-management contract for visit-conditions; no AI answer is implied. */
export interface EvidenceEntry {
  id: string; placeId: string; field: string; value: unknown; state: 'current' | 'superseded';
  sourceKind: string; sources: {url: string; kind: 'official' | 'map' | 'manual' | 'reviewed'}[];
  checkedAt: string | null; checkedPrecision: 'day' | 'instant' | 'unknown';
  freshness: 'current' | 'stale' | 'unknown' | 'future';
  validFrom: string | null; validThrough: string | null; periodInvalid: boolean; note: string | null;
}
export interface VisitEvidence {schemaVersion: 1; placeId: string; evaluatedOn: string; maxAgeDays: number; entries: EvidenceEntry[]}
export interface EvidenceCheck {date: string; status: 'check' | 'usable'; reasons: string[];
  conflicts: {field: string; evidenceIds: string[]}[]; applicableEvidenceIds: string[]; usableEvidenceIds: string[]}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string';
const nullable = (v: unknown) => v === null || text(v);
const fields = ['opening_hours','cost','website','operating_rules','operating_exception','reservation'];
const oneOf = (v: unknown, choices: string[]) => text(v) && choices.includes(v);
const link = (v: unknown) => {try {const u=new URL(String(v));return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}};
export function validEvidence(value: unknown, placeId: string): value is VisitEvidence {
  if (!object(value) || value.schemaVersion !== 1 || value.placeId !== placeId || !text(value.evaluatedOn)
      || !Number.isInteger(value.maxAgeDays) || Number(value.maxAgeDays)<0 || !Array.isArray(value.entries)) return false;
  const ids=new Set();
  for(const e of value.entries) {
    if (!object(e)||!text(e.id)||ids.has(e.id)||e.placeId!==placeId||!oneOf(e.field,fields)||e.value==null
      ||!oneOf(e.state,['current','superseded'])||!text(e.sourceKind)||!nullable(e.checkedAt)
      ||!oneOf(e.checkedPrecision,['day','instant','unknown'])||!oneOf(e.freshness,['current','stale','unknown','future'])
      ||!nullable(e.validFrom)||!nullable(e.validThrough)||typeof e.periodInvalid!=='boolean'||!nullable(e.note)||!Array.isArray(e.sources))return false;
    if(e.sources.some(s=>!object(s)||!text(s.url)||!link(s.url)||!oneOf(s.kind,['official','map','manual','reviewed'])))return false;
    ids.add(e.id);
  }
  return true;
}
export function validEvidenceCheck(value: unknown, evidence: VisitEvidence, date: string): value is EvidenceCheck {
  const ids=new Set(evidence.entries.map(e=>e.id));
  const refs=(v:unknown)=>Array.isArray(v)&&v.every(x=>text(x)&&ids.has(x))&&new Set(v).size===v.length;
  return object(value)&&value.date===date&&oneOf(value.status,['check','usable'])
    &&Array.isArray(value.reasons)&&value.reasons.every(text)&&refs(value.applicableEvidenceIds)&&refs(value.usableEvidenceIds)
    &&Array.isArray(value.conflicts)&&value.conflicts.every(c=>object(c)&&oneOf(c.field,fields)&&refs(c.evidenceIds));
}
export const EVIDENCE_FIELD: Record<string,string>={opening_hours:'영업시간',cost:'가격',website:'안내 사이트',operating_rules:'운영·예약 조건',operating_exception:'특정 날짜 예외',reservation:'예약'};
export const FRESHNESS_LABEL={current:'확인일 기록 있음',stale:'오래된 자료',unknown:'확인일 없음',future:'확인일 재검토'};
export const SOURCE_LABEL={official:'공식 안내',map:'지도 정보',manual:'사용자 확인',reviewed:'검토 자료'};
export function evidencePeriod(e: EvidenceEntry) {
  if(e.periodInvalid)return '적용 기간 재검토 필요';
  return e.validFrom||e.validThrough?`${e.validFrom??'시작일 미확인'} ~ ${e.validThrough??'종료일 미확인'}`:'적용 기간 기록 없음';
}

/** Maintenance details stay separate from live/visit status. */
export const EVIDENCE_REASON: Record<string,string> = {
  evidence_missing:'운영 근거 부족', evidence_stale:'확인한 지 오래된 자료', evidence_unverified:'공식 근거 미확인',
  evidence_date_unknown:'확인일 기록 없음', evidence_future:'확인일 재검토', evidence_period:'방문일 적용 기간 재확인',
  evidence_conflict:'자료 간 내용 충돌', evidence_invalid:'운영 근거 형식 오류',
};
export function evidenceValueText(e: EvidenceEntry): string | null {
  if (typeof e.value === 'string') return e.value;
  if (typeof e.value === 'number' && e.field === 'cost') return `${e.value.toLocaleString()}엔`;
  if (object(e.value) && e.field === 'operating_exception') return e.value.closed === true
    ? '공지된 휴무' : '특정 날짜의 운영 조건 · 출처 안내 확인';
  if (object(e.value) && e.field === 'operating_rules' && Object.keys(e.value).length)
    return '요일·예약 등에 적용되는 운영 조건 · 출처 안내 확인';
  return null;
}
