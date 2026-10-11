/**
 * P7·P8 공용 결과 흐름의 판단 규칙. React와 떼어 두어 그대로 검사한다(web/_test/shared-flow.test.ts).
 * 계약: docs/week6_shared_results_api.md
 */
import type { SharedCandidate, SharedResults } from "./shared-results-api";

/**
 * 늦게 도착한 응답이 최신 화면을 덮지 않게 한다.
 * 입력 버전(revision)이 낮거나, 같은 버전에서 확정 버전(selectionVersion)이 낮으면 이전 것을 유지한다.
 */
export function newer(prev: SharedResults | null, next: SharedResults): SharedResults {
  if (!prev || prev.roomId !== next.roomId) return next;
  if (next.revision < prev.revision) return prev;
  if (next.revision === prev.revision && next.selectionVersion < prev.selectionVersion) return prev;
  return next;
}

/** 방장 화면이 이 응답을 보고 후보 계산을 요청해야 하는가. 같은 버전에는 한 번만 (실패해도 폴링마다 다시 부르지 않는다) */
export function shouldCalculate(snap: SharedResults | null, isOwner: boolean, attempted: ReadonlySet<string>) {
  return !!snap && isOwner && snap.status === "awaiting_result" && !attempted.has(calcKey(snap));
}

export const calcKey = (snap: Pick<SharedResults, "roomId" | "revision">) => `${snap.roomId}:${snap.revision}`;

/** P7에 서버 후보를 보여줄 수 있는가 */
export const hasCandidates = (snap: SharedResults | null) =>
  !!snap && (snap.status === "awaiting_selection" || snap.status === "ready") && snap.candidates.length > 0;

/** 대기 화면 안내 문구 */
export function statusLine(snap: SharedResults | null, isOwner: boolean): string {
  if (!snap) return "참여 현황을 불러오는 중이에요.";
  switch (snap.status) {
    case "collecting": return "누가 무엇을 골랐는지는 끝까지 공개되지 않아요.";
    case "awaiting_result": return isOwner ? "전원 입력이 끝났어요. 후보를 계산하고 있어요." : "전원 입력이 끝났어요. 방장 화면에서 후보를 계산해요.";
    case "calculating": return "후보 3개를 계산하는 중이에요.";
    case "awaiting_selection": return isOwner ? "후보 3개가 나왔어요. 하나를 골라 확정해 주세요." : "후보 3개가 나왔어요. 방장이 하나를 고르는 중이에요.";
    case "ready": return "방장이 일정을 확정했어요.";
    default: return "";
  }
}

/** P8 장소 표시 — 규칙 보완을 실제 AI 호출로 표시하지 않는다 (계약 "지표·근거 의미") */
export function badgeOf(item: SharedCandidate["days"][number]["items"][number]): "AI 추천" | "추천" | null {
  if (item.source === "ai_added") return "AI 추천";
  if (item.source === "rule_added" || item.source === "meal_fill") return "추천";
  return null;
}
