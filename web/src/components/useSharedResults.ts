"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTrip } from "@/components/store";
import { API_BASE } from "@/lib/room-api";
import { createSharedResultClient, SharedResultError, type SharedResults, type SharedStrategy } from "@/lib/shared-results-api";
import { createCalculator, newer } from "@/lib/shared-flow";

const api = createSharedResultClient(API_BASE);
/**
 * 방·버전별 계산 시도(진행 중·실패·완료). 화면을 옮겨 다녀도 남아서,
 * 같은 버전은 자동으로 다시 부르지 않고 실패·미완료면 어느 화면에서든 다시 계산하기를 보여준다
 */
const calculator = createCalculator();
const POLL_MS = 3000;

/**
 * 서버 공용 결과를 3초마다 조회한다. 방이 없으면(데모 모드) 아무것도 하지 않는다.
 * 방장 화면은 전원 제출(awaiting_result)을 보면 그 버전에 대해 한 번만 후보 3개 계산을 요청한다.
 */
export function useSharedResults(enabled = true) {
  const { state } = useTrip();
  const room = state.room;
  const isOwner = !!room?.ownerToken;
  const [snap, setSnap] = useState<SharedResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 계산기 상태가 바뀌면 다시 그린다
  const [, setTick] = useState(0);
  useEffect(() => calculator.subscribe(() => setTick((t) => t + 1)), []);
  const [selecting, setSelecting] = useState(false);
  const live = useRef(true);

  const accept = useCallback((next: SharedResults) => {
    if (live.current) setSnap((prev) => newer(prev, next));
  }, []);

  const refresh = useCallback(async () => {
    if (!room) return;
    try {
      accept(await api.get(room.roomId, room.token));
      setError(null);
    } catch (e) {
      if (live.current) setError(e instanceof Error ? e.message : "결과를 불러오지 못했어요.");
    }
  }, [room, accept]);

  useEffect(() => {
    live.current = true;
    if (!enabled || !room) return;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => { live.current = false; clearInterval(id); };
  }, [enabled, room, refresh]);

  const calc = calculator.view(snap, isOwner);

  // 방장: 전원 제출을 보면 그 버전에 대해 한 번만 계산을 요청한다
  useEffect(() => {
    // 렌더 때의 값이 아니라 지금 기록으로 다시 본다 (개발 모드의 effect 두 번 실행·다른 화면의 동시 요청)
    if (!calc.auto || !snap || !room?.ownerToken || !calculator.view(snap, isOwner).auto) return;
    const owner = room.ownerToken;
    calculator.run(snap, () => api.calculateAll(room.roomId, owner, snap.revision).then((next) => { accept(next); return next; }))
      // 409·202 뒤의 상태는 다음 조회가 가져온다
      .then(() => refresh());
  }, [calc.auto, snap, room, isOwner, accept, refresh]);

  /** 계산 실패·미완료 뒤 방장이 누르는 다시 시도 */
  const retryCalculate = useCallback(() => { if (snap) calculator.retry(snap); }, [snap]);

  /** 방장 확정. 다른 사람이 그 사이 다시 냈거나 확정이 바뀌었으면(409) 최신 상태로 다시 불러온다 */
  const select = useCallback(async (strategy: SharedStrategy) => {
    if (!room?.ownerToken || !snap) return null;
    setSelecting(true);
    try {
      const next = await api.select(room.roomId, room.ownerToken, snap, strategy);
      accept(next);
      return next;
    } catch (e) {
      if (e instanceof SharedResultError && e.status === 409) {
        setError("그 사이 입력이나 확정이 바뀌었어요. 최신 후보로 다시 불러왔어요.");
        refresh();
      } else {
        setError(e instanceof Error ? e.message : "확정하지 못했어요.");
      }
      return null;
    } finally {
      if (live.current) setSelecting(false);
    }
  }, [room, snap, accept, refresh]);

  return { snap, error, calcError: calc.retry ? calc.error : null, isOwner, online: !!room, selecting, select, retryCalculate, refresh };
}
