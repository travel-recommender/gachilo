"use client";
import { useMemo } from "react";
import { useTrip } from "@/components/store";
import { EXPERIMENT_MODE, assignment, type ExperimentAssignment } from "@/lib/experiment";

/**
 * 실험 모드에서 지금 참가자의 일정 A·B·C 배정. 실험 모드가 아니거나 방이 없으면 null.
 * 순번은 서버가 준 방 참여자 목록(state.members) 순서로 센다.
 */
export function useExperiment(): ExperimentAssignment | null {
  const { state } = useTrip();
  const roomId = state.room?.roomId ?? null;
  const memberId = state.room?.memberId ?? null;
  const ids = state.members.map((m) => m.id).join("\n");
  return useMemo(
    () => (EXPERIMENT_MODE && roomId && memberId ? assignment(roomId, memberId, ids.split("\n")) : null),
    [roomId, memberId, ids],
  );
}
