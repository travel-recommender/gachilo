/**
 * 서버 API 클라이언트.
 * 계약 원본은 backend/README.md 「API 계약」이다. 여기서 임의로 경로를 만들지 않는다.
 */
import { loadCatalogPages, type CatalogPage } from "./catalog-pages";

export interface RoomMember {
  id: string;
  name: string;
  /** 그 사람만 쓰는 입력 토큰. 초대 링크에 실려 나간다 */
  submissionToken: string;
}

export interface ApiRoom {
  roomId: string;
  ownerToken: string;
  /** 방 공용 초대 토큰. 링크 하나로 모두를 초대한다 */
  inviteToken?: string;
  members: RoomMember[];
  startDate?: string;
  endDate?: string;
  revision?: number;
}

export interface ApiPlace {
  id: string;
  name: string;
  category: string;
}

export interface ApiSubmission {
  longlist: string[];
  picks: string[];
  must: string | null;
  veto: string | null;
  /** 원/하루 */
  budgetPerDay: number;
  /** 보/하루 */
  stepLimit: number;
  /** 분/하루 */
  activeMin: number;
  /** 엔진 방향의 trade off 세 축 (0~1). 7주차 전에 낸 입력에는 없다 */
  tradeoffs?: { pace: number; distance: number; spend: number };
}

/** 초대받은 사람도 읽는 방 기본 정보. 토큰·입력은 들어 있지 않다 */
export interface ApiRoomInfo {
  roomId: string;
  startDate: string;
  endDate: string;
  members: { id: string; name: string }[];
  /** 실제 장소 방(osaka_review_150)일 때만 온다 */
  dataset?: string;
}

/** 본인 입력 조회 응답. 아직 제출하지 않았으면 submission이 null이다 */
export interface ApiOwnSubmission {
  roomId: string;
  memberId: string;
  revision: number;
  submission: (ApiSubmission & { memberId: string }) | null;
}

/** 공용 초대 링크로 들어온 사람이 보는 방 정보. 이미 고른 이름은 claimed */
export interface ApiInviteInfo {
  roomId: string;
  startDate: string;
  endDate: string;
  /** hasPin: 이미 고른 이름이어도 PIN으로 다시 들어올 수 있는가 */
  members: { id: string; name: string; claimed: boolean; hasPin?: boolean }[];
}

/** 이름을 고르면 받는 그 자리의 새 입력 토큰 */
export interface ApiSeat {
  memberId: string;
  name: string;
  submissionToken: string;
  /** PIN으로 방장 자리에 다시 들어왔을 때만 온다 (이전 방장 토큰은 끊긴다) */
  ownerToken?: string;
}

export type RoomStatus = "collecting" | "awaiting_result" | "ready";

export interface ApiResult {
  roomId: string;
  status: RoomStatus;
  submittedCount: number;
  memberCount: number;
  revision: number;
  result:
    | null
    | {
        strategy: string;
        days: { date: string; placeIds: string[] }[];
        summary: string;
      };
}

/** P4 풀 — 전원의 1차 목록 합집합. 여러 명이 올린 곳부터 온다. 누가 올렸는지는 없다 */
export interface ApiPool {
  roomId: string;
  /** 1차 목록(또는 전체 입력)을 낸 사람 수 */
  listedCount: number;
  memberCount: number;
  placeIds: string[];
}

/** 서버가 준 상태 코드를 화면이 구분할 수 있게 담아 둔다 */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

/** 서버 주소. 공용 결과 클라이언트(shared-results-api)도 같은 주소를 쓴다 */
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const BASE = API_BASE;

async function request<T>(path: string, method = "GET", body?: unknown, token?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(BASE + path, {
      method,
      cache: "no-store",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    // 서버가 안 떠 있는 경우 — 화면에서 안내 문구로 바꿔 쓴다
    throw new ApiError("서버에 연결하지 못했어요. 로컬 서버가 켜져 있는지 확인해 주세요.", 0);
  }

  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(value.error ?? "서버 요청을 처리하지 못했습니다.", response.status);
  }
  return value as T;
}

export { defaultStartDate, nightsBetween, toDateRange, todayDate } from "./dates";

/**
 * 참여자별 초대 링크.
 * 토큰이 쿼리에 실리므로 링크 자체가 그 사람의 출입증이다 — 단체 채팅방에 통째로 뿌리지 않는다.
 */
export function joinUrl(origin: string, roomId: string, member: RoomMember) {
  const p = new URLSearchParams({ room: roomId, m: member.id, t: member.submissionToken });
  return `${origin}/join/?${p.toString()}`;
}

/**
 * 서버 환율 설정이 없을 때 쓰는 기준 환율.
 * 하나은행 매매기준율 2026-09-30 14:04 (337회차), data/week5/hana_exchange_rate_20260930.json
 */
export const FALLBACK_RATE = { krwPerJpy: 8.6253, asOf: "2026-09-30" };

/** 방 공용 초대 링크 — 단체방에 하나만 보내고, 들어온 사람이 자기 이름을 고른다 */
export function inviteUrl(origin: string, roomId: string, inviteToken: string) {
  const p = new URLSearchParams({ room: roomId, k: inviteToken });
  return `${origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/join/?${p.toString()}`;
}

export const roomApi = {
  places: () => request<{ dataset: string; places: ApiPlace[] }>("/places"),

  /** 서버에 설정된 엔화 환율(원/엔). 설정이 없으면 null */
  exchangeRate: () =>
    request<{ exchange_rate?: { krw_per_jpy: string | null; as_of: string | null } }>("/api/places?limit=1")
      .then((r) => r.exchange_rate ?? null),

  /** ownerPin: 방장이 다른 기기에서 다시 들어올 때 쓸 4자리 */
  create: (startDate: string, endDate: string, memberNames: string[], ownerPin?: string, dataset?: string) =>
    request<ApiRoom>("/rooms", "POST", {
      startDate, endDate, memberNames, ...(ownerPin ? { ownerPin } : {}), ...(dataset ? { dataset } : {}),
    }),

  /** 실제 장소 전체(현재 205곳). 이 방의 P3 검색·P4 목록·P8 지도가 쓴다 */
  realPlaces: () => loadCatalogPages((offset) => request<CatalogPage>(`/api/places?limit=150&offset=${offset}`)),

  /** 150곳 중 이 방 날짜에 일정 검사를 통과할 수 있는 곳 (36곳 방이면 null) */
  schedulable: (roomId: string, token: string) =>
    request<{ roomId: string; placeIds: string[] | null }>(`/rooms/${encodeURIComponent(roomId)}/schedulable`, "GET", undefined, token),

  /** 방 날짜·명단. 그 방의 방장·참여자 토큰이면 누구나 읽는다 */
  info: (roomId: string, token: string) =>
    request<ApiRoomInfo>(`/rooms/${encodeURIComponent(roomId)}`, "GET", undefined, token),

  /** 공용 초대 링크로 이름 목록을 본다 */
  inviteInfo: (roomId: string, inviteToken: string) =>
    request<ApiInviteInfo>(`/rooms/${encodeURIComponent(roomId)}/join`, "GET", undefined, inviteToken),

  /** 이름을 고르거나(memberId) 목록에 없는 이름을 더한다(name) */
  claim: (roomId: string, inviteToken: string, pick: ({ memberId: string } | { name: string }) & { pin?: string }) =>
    request<ApiSeat>(`/rooms/${encodeURIComponent(roomId)}/join`, "POST", pick, inviteToken),

  /** 이미 고른 내 이름에 PIN으로 다시 들어간다. 새 토큰이 나오고 이전 기기는 끊긴다 */
  rejoin: (roomId: string, inviteToken: string, memberId: string, pin: string) =>
    request<ApiSeat>(`/rooms/${encodeURIComponent(roomId)}/rejoin`, "POST", { memberId, pin }, inviteToken),

  /** 내가 저장한 입력. 그 참여자의 토큰으로만 읽힌다 (방장 토큰도 403) */
  mySubmission: (roomId: string, memberId: string, token: string) =>
    request<ApiOwnSubmission>(
      `/rooms/${encodeURIComponent(roomId)}/submissions/${encodeURIComponent(memberId)}`,
      "GET",
      undefined,
      token
    ),

  // 아래 세 개는 조은님이 만든 호출부(/server-check)를 그대로 쓸 수 있도록
  // 객체를 받는 원래 모양을 유지한다. 필요한 필드만 구조적으로 요구한다.
  submit: (
    room: Pick<ApiRoom, "roomId">,
    member: Pick<RoomMember, "id" | "submissionToken">,
    input: ApiSubmission
  ) =>
    request<unknown>(
      `/rooms/${encodeURIComponent(room.roomId)}/submissions/${encodeURIComponent(member.id)}`,
      "PUT",
      input,
      member.submissionToken
    ),

  /** P3에서 담은 1차 목록만 먼저 저장한다. 결과 revision은 바뀌지 않는다 */
  saveLonglist: (roomId: string, memberId: string, token: string, longlist: string[]) =>
    request<unknown>(
      `/rooms/${encodeURIComponent(roomId)}/longlists/${encodeURIComponent(memberId)}`,
      "PUT",
      { longlist },
      token
    ),

  /** 모두가 찾아온 곳 (P4). 방 참여자·방장 토큰이면 읽는다 */
  pool: (roomId: string, token: string) =>
    request<ApiPool>(`/rooms/${encodeURIComponent(roomId)}/pool`, "GET", undefined, token),

  /** 참여 현황·결과 조회. 참여자 토큰으로도 읽을 수 있다 */
  result: (room: Pick<ApiRoom, "roomId" | "ownerToken">) =>
    request<ApiResult>(
      `/rooms/${encodeURIComponent(room.roomId)}/results`,
      "GET",
      undefined,
      room.ownerToken
    ),

  /** 계산은 방장만 */
  calculate: (room: Pick<ApiRoom, "roomId" | "ownerToken">, strategy: string) =>
    request<ApiResult>(
      `/rooms/${encodeURIComponent(room.roomId)}/calculate`,
      "POST",
      { strategy },
      room.ownerToken
    ),
};
