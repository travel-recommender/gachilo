"use client";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { MY_DEFAULT, demoSubmissions } from "@/lib/demo";
import { buildConsensus } from "@/lib/consensus";
import { buildSchedule } from "@/lib/schedule";
import {
  DEFAULT_MEMBERS,
  makeCustomPlace,
  makeMembers,
  setCustomPlaces,
  setMembers,
  type CustomPlaceInput,
} from "@/lib/places";
import { DRAFT_KEY, SESSION_KEY, restore, save, submitBlocker } from "@/lib/persist";
import { ApiError, nightsBetween, roomApi, toDateRange, type ApiResult, type RoomMember } from "@/lib/room-api";
import { editedState, joinedState, restoredFromServer } from "@/lib/room-state";
import type { Member, Place, Strategy, Submission } from "@/lib/types";

/**
 * 서버에 만들어진 방과 '나'의 출입증.
 * 입력 내용이 아니라 **세션 식별자**라서 이것만 브라우저에 남긴다 — 새로고침·재접속용이다.
 */
export interface RoomSession {
  roomId: string;
  startDate: string;
  endDate: string;
  /** 내 참여자 id */
  memberId: string;
  /** 내 입력 토큰 */
  token: string;
  /** 방장일 때만 있다 */
  ownerToken: string | null;
  /** 방장이 초대 링크를 만들 때만 쓴다 */
  members: RoomMember[];
  /** 방 공용 초대 토큰. 방장만 가진다 (링크 하나 + 이름 고르기) */
  inviteToken?: string | null;
}

/** 숙소 한 곳. 좌표는 지도 검색으로 고른 경우에만 있다 */
export interface Lodging {
  address: string;
  lat?: number;
  lng?: number;
}

/**
 * 화면에서 받지만 아직 서버·알고리즘이 쓰지 않는 입력 (#35에서 연결한다).
 * 꼭 가기·제외는 개수 제한이 없어서 목록으로 따로 둔다. 서버에는 picks·must·veto로 줄여 보낸다.
 */
export interface TripExtras {
  mustList: string[];
  vetoList: string[];
  arrivalAirport: string;
  departureAirport: string;
  /** "HH:MM" */
  arrivalTime: string;
  departureTime: string;
  /** 박마다 하나 (첫째 날 숙소, 둘째 날 숙소…) */
  lodgings: Lodging[];
  /** 하루 활동 시작·종료 "HH:MM". activeMin은 이 차이로 정한다 */
  dayStart: string;
  dayEnd: string;
  /** 0~1. 0은 왼쪽(바쁘게·이동 짧게·절약) */
  tradeoff: { pace: number; distance: number; spend: number };
  /** P8에서 고친 날짜별 장소 순서 (없으면 계산 결과 그대로) */
  planEdits: Record<number, string[]>;
  confirmed: boolean;
}

export const EXTRAS_DEFAULT: TripExtras = {
  mustList: [],
  vetoList: [],
  arrivalAirport: "KIX",
  departureAirport: "KIX",
  arrivalTime: "",
  departureTime: "",
  lodgings: [],
  dayStart: "09:00",
  dayEnd: "17:00",
  tradeoff: { pace: 0.5, distance: 0.5, spend: 0.5 },
  planEdits: {},
  confirmed: false,
};

export interface AppState {
  nights: number;
  /** 서버 방 정보. 없으면 아직 로컬 데모 모드 */
  room: RoomSession | null;
  /** 출발일 (YYYY-MM-DD) */
  startDate: string;
  /** 첫 화면에서 정한 참여자 — 첫 번째가 '나' */
  members: Member[];
  mine: Submission;
  submitted: boolean;
  strategy: Strategy;
  allowPartial: boolean;
  /** 사용자가 직접 추가한 장소 */
  customPlaces: Place[];
  /**
   * 방에 앉았는데 이 기기에 내 초안이 없고, 서버의 본인 입력도 아직 못 불러왔다(초안 없이 재접속).
   * submitted와 별개다 — 제출 뒤 고친 상태(submitted=false)여도 서버에는 이전 입력이 있을 수 있다.
   * 이 상태에서 제출하면 기본값이 서버 입력을 덮어쓸 수 있으므로 막는다. 서버 조회가 끝나거나 1차 선택부터 다시 고르면 풀린다.
   */
  inputMissing: boolean;
  extra: TripExtras;
}

const INITIAL: AppState = {
  nights: 3,
  room: null,
  startDate: "",
  members: DEFAULT_MEMBERS,
  mine: MY_DEFAULT,
  submitted: false,
  strategy: "fairness",
  allowPartial: true,
  customPlaces: [],
  inputMissing: false,
  extra: EXTRAS_DEFAULT,
};

interface Ctx {
  state: AppState;
  set: (p: Partial<AppState>) => void;
  setMine: (p: Partial<Submission>) => void;
  setExtra: (p: Partial<TripExtras>) => void;
  /** 이름 목록으로 참여자를 다시 만든다 (첫 화면) */
  setMemberNames: (names: string[]) => void;
  /** 서버에 방을 만들고 세션을 저장한다. 방장이 된다 */
  createRoom: (startDate: string, nights: number, names: string[]) => Promise<RoomSession>;
  /** 초대 링크로 들어온 사람이 자기 자리에 앉는다 */
  joinRoom: (roomId: string, memberId: string, token: string) => Promise<void>;
  /** 내 입력을 서버에 저장한다 */
  submitMine: () => Promise<void>;
  /** 참여 현황·결과를 조회한다 */
  fetchStatus: () => Promise<ApiResult | null>;
  /** 직접 추가한 장소를 등록하고 만들어진 장소를 돌려준다 */
  addPlace: (input: CustomPlaceInput) => Place;
  reset: () => void;
  ready: boolean;
  /** 나 + 동행자 전원의 입력 */
  submissions: Submission[];
  /** 2차 선택 화면에서 쓰는 그룹 후보 풀 (전원의 1차 선택 합집합) */
  pool: string[];
  consensus: ReturnType<typeof buildConsensus>;
  schedule: ReturnType<typeof buildSchedule>;
}

const C = createContext<Ctx | null>(null);

export function TripProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(INITIAL);
  const [ready, setReady] = useState(false);
  // 비동기 콜백이 최신 상태를 보게 한다 (제출·조회 시점의 state가 낡으면 안 된다)
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let restored = INITIAL;
    try {
      restored = restore(window.localStorage, window.sessionStorage, INITIAL);
      setState(restored);
    } catch { /* 무시 */ }
    setReady(true);
    // 이 기기에 내 초안이 없으면 서버의 본인 입력으로 채운다. 실패하면 제출 막기(inputMissing)를 유지한다
    const room = restored.room;
    if (room && restored.inputMissing) {
      roomApi.mySubmission(room.roomId, room.memberId, room.token)
        .then((own) => setState((s) =>
          s.room?.roomId === room.roomId && s.room.memberId === room.memberId
            ? restoredFromServer(s, own.submission) : s))
        .catch(() => { /* 막힌 상태로 둔다 */ });
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { save(state, window.localStorage, window.sessionStorage); } catch { /* 무시 */ }
  }, [state, ready]);

  const set = (p: Partial<AppState>) => setState((s) => ({ ...s, ...p }));
  const setMine = (p: Partial<Submission>) => setState((s) => editedState(s, p));
  const setExtra = (p: Partial<TripExtras>) => setState((s) => ({ ...s, extra: { ...s.extra, ...p } }));
  const setMemberNames = (names: string[]) => setState((s) => ({ ...s, members: makeMembers(names) }));

  const createRoom = async (startDate: string, nights: number, names: string[]) => {
    const range = toDateRange(startDate, nights);
    const room = await roomApi.create(range.startDate, range.endDate, names);
    // 서버가 만든 참여자 id를 화면 쪽 Member와 맞춰 둔다 (색은 순서대로)
    const members: Member[] = room.members.map((m, i) => ({
      id: m.id,
      name: m.name,
      color: makeMembers(names)[i]?.color ?? "#2f45e0",
    }));
    const me = room.members[0];
    const session: RoomSession = {
      roomId: room.roomId,
      startDate: range.startDate,
      endDate: range.endDate,
      memberId: me.id,
      token: me.submissionToken,
      ownerToken: room.ownerToken,
      members: room.members,
      inviteToken: room.inviteToken ?? null,
    };
    setState((s) => ({
      ...s,
      nights,
      startDate: range.startDate,
      members,
      room: session,
      mine: { ...s.mine, memberId: me.id },
      submitted: false,
      inputMissing: false,
    }));
    return session;
  };

  const joinRoom = async (roomId: string, memberId: string, token: string) => {
    // 날짜·명단은 이 브라우저의 이전 값이 아니라 서버의 방 정보를 쓴다
    const info = await roomApi.info(roomId, token);
    if (!info.members.some((m) => m.id === memberId)) {
      throw new ApiError("이 방의 참여자 링크가 아니에요. 방을 만든 사람에게 링크를 다시 받아주세요.", 403);
    }
    // 다른 자리로 들어오거나 이 기기에 입력이 없을 때 채울 서버의 본인 입력
    const own = await roomApi.mySubmission(roomId, memberId, token);
    const colors = makeMembers(info.members.map((m) => m.name));
    const members = info.members.map((m, i) => ({ id: m.id, name: m.name, color: colors[i].color }));
    setState((s) => joinedState(
      s, { roomId, memberId, token }, info, members,
      nightsBetween(info.startDate, info.endDate), own.submission, MY_DEFAULT,
    ));
  };

  const submitMine = async () => {
    const room = stateRef.current.room;
    if (!room) return; // 로컬 데모 모드 — 서버 없이도 화면이 돌아야 한다
    const blocker = submitBlocker(stateRef.current);
    if (blocker) throw new ApiError(blocker, 409);
    const mine = stateRef.current.mine;
    await roomApi.submit({ roomId: room.roomId }, { id: room.memberId, submissionToken: room.token }, {
      longlist: mine.longlist,
      picks: mine.picks,
      must: mine.must,
      veto: mine.veto,
      budgetPerDay: mine.budgetPerDay,
      stepLimit: mine.stepLimit,
      activeMin: mine.activeMin,
    });
  };

  const fetchStatus = async () => {
    const room = stateRef.current.room;
    if (!room) return null;
    return roomApi.result({ roomId: room.roomId, ownerToken: room.ownerToken ?? room.token });
  };

  const addPlace = (input: CustomPlaceInput) => {
    const place = makeCustomPlace(input);
    setState((s) => ({ ...s, customPlaces: [...s.customPlaces, place] }));
    return place;
  };

  const reset = () => {
    setState(INITIAL);
    try {
      window.localStorage.removeItem(SESSION_KEY);
      window.sessionStorage.removeItem(SESSION_KEY);
      window.sessionStorage.removeItem(DRAFT_KEY);
    } catch { /* 무시 */ }
  };

  // 추가된 장소·참여자는 계산과 설명 생성이 id로 찾을 수 있어야 하므로 계산 전에 등록한다.
  setCustomPlaces(state.customPlaces);
  setMembers(state.members);

  // 서버 방에서는 내 id가 "me"가 아니라 서버가 준 id다
  const companionIds = useMemo(
    () => state.members.filter((m) => m.id !== state.mine.memberId).map((m) => m.id),
    [state.members, state.mine.memberId]
  );

  /** 1차 — 전원이 검색으로 찾아온 곳을 합친 그룹 후보 풀 */
  const pool = useMemo(() => {
    const ids = [...state.mine.longlist];
    demoSubmissions(companionIds, []).forEach((s) =>
      s.longlist.forEach((id) => { if (!ids.includes(id)) ids.push(id); })
    );
    return ids;
  }, [state.mine.longlist, companionIds]);

  const submissions = useMemo(
    () => [state.mine, ...demoSubmissions(companionIds, pool)],
    [state.mine, companionIds, pool]
  );

  const consensus = useMemo(
    () => buildConsensus({
      submissions, nights: state.nights,
      strategy: state.strategy, allowPartial: state.allowPartial,
    }),
    [submissions, state.nights, state.strategy, state.allowPartial, state.customPlaces]
  );

  const schedule = useMemo(() => {
    const vetoed = new Set(submissions.map((s) => s.veto).filter(Boolean) as string[]);
    return buildSchedule(consensus.selections, state.nights + 1, {
      considerBags: true, fillMeals: true, vetoed,
    });
  }, [consensus, state.nights, submissions]);

  return (
    <C.Provider value={{
      state, set, setMine, setExtra, setMemberNames, createRoom, joinRoom, submitMine, fetchStatus,
      addPlace, reset, ready, submissions, pool, consensus, schedule,
    }}>
      {children}
    </C.Provider>
  );
}

export function useTrip() {
  const ctx = useContext(C);
  if (!ctx) throw new Error("useTrip must be used inside TripProvider");
  return ctx;
}
