/**
 * 브라우저 저장·복원. React와 떼어 두어 여러 탭 상황을 그대로 검사한다(web/_test/persist.test.ts).
 *
 * - 방 세션(방·내 자리·토큰·날짜·명단): 탭별 sessionStorage가 먼저, 없으면 localStorage.
 *   localStorage는 모든 탭이 공유하므로 **새 탭·재접속용 마지막 방**으로만 쓴다.
 * - 입력 초안(선택·조건): 탭별 sessionStorage에만. **어느 방·어느 참여자의 초안인지(owner)**를 같이 적고,
 *   복원한 방 세션과 owner가 다르면 버린다. 다른 사람 토큰으로 내 초안이 제출되면 안 된다.
 * 방에 앉아 있는데 이 탭에 내 초안이 없으면 서버의 본인 입력 조회로 채운다(store.tsx). 초안은 아직 안 낸 수정을 지키는 용도다.
 * 초안이 있는지는 submitted로 판단하지 않는다. 제출 뒤 고치면 submitted가 풀리지만 서버에는 이전 입력이 남아 있다.
 */
import type { AppState } from "../components/store";
import type { Submission } from "./types";

export const SESSION_KEY = "gatiga-v5";
export const DRAFT_KEY = "gatiga-v5-draft";
/** 이전 판. 읽지 않고 지운다 (v3는 입력 전체를 localStorage에 담았다) */
export const LEGACY_KEYS = ["gatiga-v3", "gatiga-v4", "gatiga-v4-draft"];

const SESSION_FIELDS = ["room", "nights", "startDate", "members", "submitted"] as const;
const DRAFT_FIELDS = ["mine", "customPlaces", "strategy", "allowPartial", "inputMissing"] as const;

/** localStorage·sessionStorage 중 여기서 쓰는 부분 */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type Owner = { roomId: string; memberId: string } | null;

function pick<K extends keyof AppState>(src: Partial<AppState>, keys: readonly K[]) {
  const out: Partial<Pick<AppState, K>> = {};
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

function read(storage: KV, key: string): Record<string, unknown> | null {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function ownerOf(room: AppState["room"]): Owner {
  return room ? { roomId: room.roomId, memberId: room.memberId } : null;
}

function sameOwner(a: Owner, b: Owner) {
  if (a === null || b === null) return a === b;
  return a.roomId === b.roomId && a.memberId === b.memberId;
}

export function save(state: AppState, local: KV, session: KV) {
  const room = JSON.stringify(pick(state, SESSION_FIELDS));
  session.setItem(SESSION_KEY, room);
  local.setItem(SESSION_KEY, room);
  session.setItem(DRAFT_KEY, JSON.stringify({ owner: ownerOf(state.room), ...pick(state, DRAFT_FIELDS) }));
}

export function restore(local: KV, session: KV, initial: AppState): AppState {
  for (const key of LEGACY_KEYS) {
    local.removeItem(key);
    session.removeItem(key);
  }
  // 이 탭이 쓰던 방이 먼저다. 다른 탭이 localStorage를 바꿔도 이 탭의 자리는 그대로다
  const saved = read(session, SESSION_KEY) ?? read(local, SESSION_KEY) ?? {};
  const state: AppState = { ...initial, ...pick(saved as Partial<AppState>, SESSION_FIELDS) };

  const draft = read(session, DRAFT_KEY);
  if (draft && sameOwner((draft.owner as Owner) ?? null, ownerOf(state.room))) {
    Object.assign(state, pick(draft as Partial<AppState>, DRAFT_FIELDS));
  } else {
    // 초안이 없거나 다른 자리의 초안이다. 이 기기의 입력은 내 입력이 아니다.
    // 서버에 낸 입력이 있는지는 서버에 물어봐야 안다 (submitted는 제출 뒤 고치면 false라 믿을 수 없다)
    state.inputMissing = state.room !== null;
  }
  // 초안이 없어도 내 입력의 주인은 복원한 방의 내 자리다
  if (state.room) state.mine = { ...state.mine, memberId: state.room.memberId };
  return state;
}

/** 직접 추가한 장소 id의 앞부분 (places.ts makeCustomPlace). 서버 카탈로그에는 없다 */
export const CUSTOM_PREFIX = "custom_";

/** 이 입력에 서버가 모르는 직접 추가 장소가 들어 있는가 */
export function hasCustomPlace(mine: Submission) {
  return [...mine.longlist, ...mine.picks, mine.must, mine.veto]
    .some((id) => typeof id === "string" && id.startsWith(CUSTOM_PREFIX));
}

/** 지금 제출하면 안 되는 이유. 없으면 null */
export function submitBlocker(state: AppState): string | null {
  if (state.inputMissing) {
    return "이 기기에 입력이 남아 있지 않고 저장된 입력도 아직 불러오지 못했어요. 가고 싶은 곳 고르기부터 다시 입력하면 새 입력으로 저장돼요.";
  }
  if (state.room && state.mine.memberId !== state.room.memberId) {
    return "입력과 참여자 정보가 맞지 않아요. 초대 링크로 다시 들어와 주세요.";
  }
  if (state.room && hasCustomPlace(state.mine)) {
    return "직접 추가한 장소는 아직 여행방에 저장할 수 없어요. 목록에 있는 장소로 바꿔 주세요.";
  }
  return null;
}
