/**
 * 서버 API 클라이언트.
 * 계약 원본은 backend/README.md 「API 계약」이다. 여기서 임의로 경로를 만들지 않는다.
 */

export interface RoomMember {
  id: string;
  name: string;
  /** 그 사람만 쓰는 입력 토큰. 초대 링크에 실려 나간다 */
  submissionToken: string;
}

export interface ApiRoom {
  roomId: string;
  ownerToken: string;
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
}

/** 초대받은 사람도 읽는 방 기본 정보. 토큰·입력은 들어 있지 않다 */
export interface ApiRoomInfo {
  roomId: string;
  startDate: string;
  endDate: string;
  members: { id: string; name: string }[];
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

/** 서버가 준 상태 코드를 화면이 구분할 수 있게 담아 둔다 */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

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

export { defaultStartDate, nightsBetween, toDateRange } from "./dates";

/**
 * 참여자별 초대 링크.
 * 토큰이 쿼리에 실리므로 링크 자체가 그 사람의 출입증이다 — 단체 채팅방에 통째로 뿌리지 않는다.
 */
export function joinUrl(origin: string, roomId: string, member: RoomMember) {
  const p = new URLSearchParams({ room: roomId, m: member.id, t: member.submissionToken });
  return `${origin}/join/?${p.toString()}`;
}

export const roomApi = {
  places: () => request<{ dataset: string; places: ApiPlace[] }>("/places"),

  create: (startDate: string, endDate: string, memberNames: string[]) =>
    request<ApiRoom>("/rooms", "POST", { startDate, endDate, memberNames }),

  /** 방 날짜·명단. 그 방의 방장·참여자 토큰이면 누구나 읽는다 */
  info: (roomId: string, token: string) =>
    request<ApiRoomInfo>(`/rooms/${encodeURIComponent(roomId)}`, "GET", undefined, token),

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
