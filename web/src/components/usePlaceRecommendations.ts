"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/room-api";
import { createRecommendationClient, type RecommendationRequest, type PlaceRecommendations } from "@/lib/place-recommendations";

const load = createRecommendationClient(API_BASE);
type Snapshot = { key: string; data?: PlaceRecommendations; error?: string };

export function usePlaceRecommendations(request: RecommendationRequest | null) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(request);
  useLayoutEffect(() => { latest.current = request; }, [request]);
  // Keep one batch while editing My list. The UI filters it against the live list.
  // A different source/session/mode cancels and hides prior evidence immediately.
  const identity = request ? [request.roomId, request.memberId, request.token, request.dataset, request.placeId] : null;
  const key = JSON.stringify([identity, attempt]);
  useEffect(() => {
    const current = latest.current;
    if (!current) return;
    const controller = new AbortController();
    let active = true;
    load(current, controller.signal).then(
      data => { if (active) setSnapshot({ key, data }); },
      error => { if (active) setSnapshot({ key, error: error instanceof Error ? error.message : "추천을 불러오지 못했어요." }); },
    );
    return () => { active = false; controller.abort(); };
  }, [key]);
  const current = snapshot?.key === key ? snapshot : null;
  return {
    data: request ? current?.data ?? null : null,
    error: request ? current?.error ?? null : null,
    loading: !!request && !current,
    retry: () => setAttempt(n => n + 1),
  };
}
