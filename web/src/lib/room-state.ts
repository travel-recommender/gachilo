/**
 * 방 입장·입력 수정 때 상태를 어떻게 바꿀지. React와 떼어 두어 그대로 검사한다(web/_test/room-state.test.ts).
 */
import type { AppState } from "../components/store";
import type { ApiRoomInfo, ApiSubmission } from "./room-api";
import type { Member, Submission } from "./types";

/** 서버에 저장된 본인 입력을 화면 입력으로 */
export function fromServer(saved: ApiSubmission, memberId: string): Submission {
  return {
    memberId,
    longlist: saved.longlist,
    picks: saved.picks,
    must: saved.must,
    veto: saved.veto,
    budgetPerDay: saved.budgetPerDay,
    stepLimit: saved.stepLimit,
    activeMin: saved.activeMin,
  };
}

/**
 * 초대 링크로 자리에 앉는다.
 * - 같은 방·같은 자리 재접속이고 이 기기에 입력이 있으면 그대로 둔다 (아직 안 낸 수정도 지키기 위해).
 * - 다른 자리이거나 이 기기에 입력이 없으면 서버에 저장된 본인 입력으로 채운다. 없으면 기본값이다.
 */
export function joinedState(
  s: AppState,
  join: { roomId: string; memberId: string; token: string },
  info: ApiRoomInfo,
  members: Member[],
  nights: number,
  saved: ApiSubmission | null,
  defaults: Submission,
): AppState {
  const same = s.room?.roomId === join.roomId && s.room?.memberId === join.memberId;
  const base: AppState = {
    ...s,
    nights,
    startDate: info.startDate,
    members,
    room: {
      roomId: join.roomId,
      startDate: info.startDate,
      endDate: info.endDate,
      memberId: join.memberId,
      token: join.token,
      // 방장이 자기 초대 링크를 같은 탭에서 열어도 방장 권한은 남긴다
      ownerToken: same ? s.room!.ownerToken : null,
      members: same ? s.room!.members : [],
    },
  };
  if (same && !s.inputMissing) return base;
  return {
    ...base,
    // 다른 사람 자리로 들어왔다면 이전 사람의 선택은 지운다.
    // (같은 브라우저에서 링크를 바꿔 들어가는 시연에서 실제로 섞였다)
    mine: saved ? fromServer(saved, join.memberId) : { ...defaults, memberId: join.memberId },
    customPlaces: [],
    submitted: saved !== null,
    inputMissing: false,
  };
}

/**
 * 입력을 고친다. 제출한 뒤에 고치면 **새 입력 단계**다.
 * 서버에는 이전 입력이 남아 있지만, 고친 입력은 조건까지 다시 제출해야 반영되므로
 * 대기 화면이 최종 제출 현황이 아니라 다음 단계로 안내하도록 submitted를 푼다.
 */
export function editedState(s: AppState, p: Partial<Submission>): AppState {
  return {
    ...s,
    mine: { ...s.mine, ...p },
    submitted: false,
    // 1차 선택을 다시 고르기 시작하면 새 입력이다
    inputMissing: p.longlist !== undefined ? false : s.inputMissing,
  };
}

/** 새로고침 뒤 이 기기에 초안이 없을 때, 서버의 본인 입력으로 채운다 */
export function restoredFromServer(s: AppState, saved: ApiSubmission | null): AppState {
  if (!s.room || !s.inputMissing) return s;
  if (!saved) return { ...s, submitted: false, inputMissing: false };
  return { ...s, mine: fromServer(saved, s.room.memberId), customPlaces: [], submitted: true, inputMissing: false };
}
