"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/room-api";
import { createVisitConditionsClient, type VisitConditions, type VisitRequest } from "@/lib/visit-conditions";

const load = createVisitConditionsClient(API_BASE);
type Snapshot = { key: string; data?: VisitConditions; error?: string };

/**
 * 방문 조건 조회. request가 null이면 부르지 않는다(누르기 전·실제 장소 방이 아님).
 * 방·장소·날짜가 바뀌면 이전 요청을 취소하고 이전 결과를 바로 숨긴다. 다시 시도는 사용자가 누를 때만.
 */
export function useVisitConditions(request: VisitRequest | null) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(request);
  useLayoutEffect(() => { latest.current = request; }, [request]);
  const identity = request ? [request.roomId, request.token, request.placeIds, request.dates] : null;
  const key = JSON.stringify([identity, attempt]);
  useEffect(() => {
    const current = latest.current;
    if (!current) return;
    const controller = new AbortController();
    let active = true;
    load(current, controller.signal).then(
      (data) => { if (active) setSnapshot({ key, data }); },
      (error) => { if (active) setSnapshot({ key, error: error instanceof Error ? error.message : "방문 조건을 불러오지 못했어요." }); },
    );
    return () => { active = false; controller.abort(); };
  }, [key]);
  const current = snapshot?.key === key ? snapshot : null;
  return {
    data: request ? current?.data ?? null : null,
    error: request ? current?.error ?? null : null,
    loading: !!request && !current,
    retry: () => setAttempt((n) => n + 1),
  };
}
