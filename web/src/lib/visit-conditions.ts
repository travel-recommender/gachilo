/**
 * 방문 조건 안내 (이슈 #6 RAG — 혜인: 실시간 조회와 화면 연결).
 * 서버 POST /rooms/{roomId}/visit-conditions 계약. 검토 자료·실시간 영업 조회·출처를 장소·날짜별로 받는다.
 * 화면은 받은 근거만 보여주고, 근거가 없거나 조회에 실패하면 "확인 필요"로 안내한다.
 */
export type VisitStatus = "confirmed" | "check" | "closed";
export type LiveStatus = "confirmed" | "changed" | "closed" | "failed" | "unavailable" | "not_checked";

export interface VisitNotice { code: string; source: "review" | "live"; text: string }
export interface VisitDay {
  date: string;
  status: VisitStatus;
  /** 카탈로그에 검토해 둔 실제 영업·입장 시간 문장. 휴무일이거나 기록이 없으면 null */
  openingHours: string | null;
  /** 일정 엔진이 이 장소를 넣는 시간. 가격 조건 등으로 실제 영업보다 좁을 수 있다. latestStart는 입장 마감이 아니라 방문을 시작하는 마지막 시각 */
  scheduleHours: { open: string; close: string; latestStart: string | null }[];
  /** 일정에 넣는 시간·가격을 그렇게 정한 조건 (예: 점심 가격 11~16시) */
  costBasis: string | null;
  live: LiveStatus;
  notices: VisitNotice[];
}
export interface VisitSource { url: string; label: string; checkedAt: string | null }
export interface VisitPlace {
  placeId: string;
  name: string;
  reviewedThrough: string | null;
  sources: VisitSource[];
  dates: VisitDay[];
}
export interface VisitConditions {
  roomId: string;
  /** 실시간 조회 응답을 받은 일본 날짜. 조회하지 않았거나 실패하면 null */
  checkedOn: string | null;
  liveSource: string | null;
  profilesCheckedAt: string | null;
  places: VisitPlace[];
}
export interface VisitRequest { roomId: string; token: string; placeIds: string[]; dates: string[] }

export class VisitConditionsError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) { super(message); this.status = status; }
}

const STATUSES = new Set(["confirmed", "check", "closed"]);
const LIVE = new Set(["confirmed", "changed", "closed", "failed", "unavailable", "not_checked"]);
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const strOrNull = (v: unknown) => v === null || typeof v === "string";
const time = (v: unknown) => str(v) && /^\d\d:\d\d$/.test(v);
const safeUrl = (v: unknown) => str(v) && /^https?:\/\//.test(v);

/** 서버 응답 검사. 요청한 장소·날짜가 모두 있어야 하고, 출처는 http(s)만 받는다 */
export function decodeVisitConditions(value: unknown, request: VisitRequest): VisitConditions {
  const invalid = () => new VisitConditionsError("방문 조건을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
  if (!obj(value) || value.roomId !== request.roomId || !strOrNull(value.checkedOn) || !strOrNull(value.liveSource)
    || !strOrNull(value.profilesCheckedAt) || !Array.isArray(value.places)) throw invalid();
  const places = value.places as unknown[];
  if (places.length !== request.placeIds.length) throw invalid();
  places.forEach((p, i) => {
    if (!obj(p) || p.placeId !== request.placeIds[i] || !str(p.name) || !strOrNull(p.reviewedThrough)
      || !Array.isArray(p.sources) || !Array.isArray(p.dates) || p.dates.length !== request.dates.length) throw invalid();
    for (const s of p.sources) if (!obj(s) || !safeUrl(s.url) || !str(s.label) || !strOrNull(s.checkedAt)) throw invalid();
    (p.dates as unknown[]).forEach((d, j) => {
      if (!obj(d) || d.date !== request.dates[j] || !str(d.status) || !STATUSES.has(d.status) || !str(d.live) || !LIVE.has(d.live)
        || !strOrNull(d.costBasis) || !strOrNull(d.openingHours) || !Array.isArray(d.scheduleHours) || !Array.isArray(d.notices)) throw invalid();
      for (const h of d.scheduleHours) if (!obj(h) || !time(h.open) || !time(h.close) || !(h.latestStart === null || time(h.latestStart))) throw invalid();
      for (const n of d.notices) if (!obj(n) || !str(n.code) || (n.source !== "review" && n.source !== "live") || !str(n.text)) throw invalid();
    });
  });
  return value as unknown as VisitConditions;
}

/** 실시간 조회까지 기다린다 (Google 조회 + 서버 90초 제한). 자동 재시도는 하지 않는다 */
export function createVisitConditionsClient(baseUrl: string, fetcher: typeof fetch = fetch, timeoutMs = 100_000) {
  return async (request: VisitRequest, signal?: AbortSignal): Promise<VisitConditions> => {
    const controller = new AbortController();
    const cancel = () => controller.abort(signal?.reason);
    if (signal?.aborted) cancel();
    else signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new VisitConditionsError("방문 조건 조회가 늦어지고 있어요. 다시 시도해 주세요.")), timeoutMs);
    try {
      controller.signal.throwIfAborted();
      const response = await fetcher(`${baseUrl.replace(/\/$/, "")}/rooms/${encodeURIComponent(request.roomId)}/visit-conditions`, {
        method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${request.token}` },
        body: JSON.stringify({ placeIds: request.placeIds, dates: request.dates }),
      });
      if (!response.ok) {
        let message = "방문 조건을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.";
        if (response.status === 403) message = "참여 정보를 확인하지 못했어요. 초대 링크에서 다시 접속해 주세요.";
        else if (response.status === 404) message = "방문 조건 기능에 연결하지 못했어요. 서버 버전을 확인해 주세요.";
        else {
          try { const body = await response.json(); if (obj(body) && str(body.error)) message = body.error; } catch { /* 기본 문구 */ }
        }
        throw new VisitConditionsError(message, response.status);
      }
      return decodeVisitConditions(await response.json(), request);
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (error instanceof VisitConditionsError) throw error;
      throw new VisitConditionsError("방문 조건을 불러오지 못했어요. 서버 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  };
}

export const STATUS_LABEL: Record<VisitStatus, string> = { confirmed: "확인됨", check: "확인 필요", closed: "방문 어려움" };

/** 실시간 조회 한 줄 안내. checkedOn은 응답을 받은 일본 날짜 */
export function liveLine(live: LiveStatus, checkedOn: string | null): string {
  const on = checkedOn ? `${Number(checkedOn.slice(5, 7))}월 ${Number(checkedOn.slice(8, 10))}일` : null;
  switch (live) {
    // 실시간 조회는 Google 영업시간이 '일정에 넣는 시간'을 덮는지 본다
    case "confirmed": return `${on ? `${on} ` : ""}실시간 조회에서 일정에 넣는 시간에 영업하는 것으로 확인됐어요.`;
    case "changed": return "실시간 조회한 영업시간이 검토 자료와 달라요.";
    case "closed": return "실시간 조회에서 이 날은 영업하지 않는 것으로 나와요.";
    case "failed": return "실시간 조회에 실패했어요. 공식 안내로 확인해 주세요.";
    case "unavailable": return "지금은 실시간 조회를 할 수 없어요. 아래 검토 자료와 출처로 확인해 주세요.";
    case "not_checked": return "검토 자료로 이미 방문이 어려운 날이라 실시간 조회는 하지 않았어요.";
  }
}

/** 실제 영업시간 한 줄 (검토 자료 문장 그대로) */
export const openingLine = (d: VisitDay) => d.openingHours ?? "영업시간 정보 없음";

/** 일정에 넣는 시간 한 줄. 영업시간이 아니다 — 가격 조건 등으로 좁게 잡은 구간일 수 있다 */
export const scheduleLine = (d: VisitDay) => d.scheduleHours.length
  ? d.scheduleHours.map((h) => `${h.open}~${h.close}${h.latestStart ? ` (늦어도 ${h.latestStart} 시작)` : ""}`).join(", ")
  : null;

/** 실시간 조회를 다시 눌러 볼 만한 상태 — 조회 실패·조회 불가 (HTTP 200 안에 담겨 온다) */
export const canRetryLive = (data: VisitConditions) =>
  data.liveSource === "unavailable" || data.places.some((p) => p.dates.some((d) => d.live === "failed" || d.live === "unavailable"));

/** 출처 링크 옆에 보여줄 사이트 이름 (같은 이름의 출처가 여러 개일 때 구분용) */
export function sourceHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}
