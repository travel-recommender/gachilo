"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
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
import type { Member, Place, Strategy, Submission } from "@/lib/types";

export interface AppState {
  nights: number;
  /** 첫 화면에서 정한 참여자 — 첫 번째가 '나' */
  members: Member[];
  mine: Submission;
  submitted: boolean;
  strategy: Strategy;
  allowPartial: boolean;
  /** 사용자가 직접 추가한 장소 */
  customPlaces: Place[];
}

const INITIAL: AppState = {
  nights: 3,
  members: DEFAULT_MEMBERS,
  mine: MY_DEFAULT,
  submitted: false,
  strategy: "fairness",
  allowPartial: true,
  customPlaces: [],
};

const KEY = "gatiga-v2";

interface Ctx {
  state: AppState;
  set: (p: Partial<AppState>) => void;
  setMine: (p: Partial<Submission>) => void;
  /** 이름 목록으로 참여자를 다시 만든다 (첫 화면) */
  setMemberNames: (names: string[]) => void;
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

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) setState({ ...INITIAL, ...JSON.parse(raw) });
    } catch { /* 무시 */ }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 무시 */ }
  }, [state, ready]);

  const set = (p: Partial<AppState>) => setState((s) => ({ ...s, ...p }));
  const setMine = (p: Partial<Submission>) => setState((s) => ({ ...s, mine: { ...s.mine, ...p } }));
  const setMemberNames = (names: string[]) => setState((s) => ({ ...s, members: makeMembers(names) }));

  const addPlace = (input: CustomPlaceInput) => {
    const place = makeCustomPlace(input);
    setState((s) => ({ ...s, customPlaces: [...s.customPlaces, place] }));
    return place;
  };

  const reset = () => {
    setState(INITIAL);
    try { window.localStorage.removeItem(KEY); } catch { /* 무시 */ }
  };

  // 추가된 장소·참여자는 계산과 설명 생성이 id로 찾을 수 있어야 하므로 계산 전에 등록한다.
  setCustomPlaces(state.customPlaces);
  setMembers(state.members);

  const companionIds = useMemo(
    () => state.members.filter((m) => m.id !== "me").map((m) => m.id),
    [state.members]
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
      state, set, setMine, setMemberNames, addPlace, reset, ready,
      submissions, pool, consensus, schedule,
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
