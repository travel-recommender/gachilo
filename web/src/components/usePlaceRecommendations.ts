"use client";
import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/room-api";
import { createRecommendationClient, type RecommendationRequest, type PlaceRecommendations } from "@/lib/place-recommendations";

const load = createRecommendationClient(API_BASE);
type Snapshot = { key: string; data?: PlaceRecommendations; error?: string };

export function usePlaceRecommendations(request: RecommendationRequest | null) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Key includes the session, source and unsaved selection. Never render a former request's evidence.
  const serialized = request ? JSON.stringify(request) : null;
  const key = JSON.stringify([serialized, attempt]);
  useEffect(() => {
    if (!serialized) return;
    const controller = new AbortController();
    let active = true;
    load(JSON.parse(serialized) as RecommendationRequest, controller.signal).then(
      data => { if (active) setSnapshot({ key, data }); },
      error => { if (active) setSnapshot({ key, error: error instanceof Error ? error.message : "추천을 불러오지 못했어요." }); },
    );
    return () => { active = false; controller.abort(); };
  }, [serialized, key]);
  const current = snapshot?.key === key ? snapshot : null;
  return {
    data: request ? current?.data ?? null : null,
    error: request ? current?.error ?? null : null,
    loading: !!request && !current,
    retry: () => setAttempt(n => n + 1),
  };
}
