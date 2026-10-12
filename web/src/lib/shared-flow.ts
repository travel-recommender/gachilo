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

export const calcKey = (snap: Pick<SharedResults, "roomId" | "revision">) => `${snap.roomId}:${snap.revision}`;

/** 방·revision별 계산 시도. 화면(훅)이 바뀌어도 남아야 해서 화면 밖(계산기)에 둔다 */
export type Attempt = { state: "pending" | "failed" | "done"; error?: string };

export interface CalcView {
  /** 자동으로 계산을 요청할 차례 (방장 · 전원 제출 · 이 버전 처음) */
  auto: boolean;
  /** 시도했는데도 서버가 아직 계산 대기다 — 실패했거나, 202를 받은 작업이 실패·만료됐다 */
  retry: boolean;
  error: string | null;
}

/**
 * 방장 화면의 계산 상태. 같은 버전은 자동으로 한 번만 부르고(폴링마다 재호출하지 않음),
 * 그 뒤에도 awaiting_result면 화면을 옮겨 다녀도 수동 재시도를 보여준다 (#40 리뷰).
 */
export function calcView(snap: SharedResults | null, isOwner: boolean, attempts: ReadonlyMap<string, Attempt>): CalcView {
  if (!snap || !isOwner || snap.status !== "awaiting_result") return { auto: false, retry: false, error: null };
  const a = attempts.get(calcKey(snap));
  if (!a) return { auto: true, retry: false, error: null };
  if (a.state === "pending") return { auto: false, retry: false, error: null };
  return { auto: false, retry: true, error: a.error ?? "후보 계산이 끝나지 않았어요. 다시 계산해 주세요." };
}

/** 계산 시도 기록과 알림. 탭 안에서 하나만 둔다(모듈 전역) */
export function createCalculator() {
  const attempts = new Map<string, Attempt>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    attempts: attempts as ReadonlyMap<string, Attempt>,
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    view: (snap: SharedResults | null, isOwner: boolean) => calcView(snap, isOwner, attempts),
    /** 계산을 요청한다. 409(그 사이 입력이 바뀜)는 오류로 보지 않는다 — 재조회하면 새 버전이 온다 */
    async run(snap: SharedResults, call: () => Promise<SharedResults>): Promise<SharedResults | null> {
      const key = calcKey(snap);
      attempts.set(key, { state: "pending" });
      emit();
      try {
        const next = await call();
        attempts.set(key, { state: "done" });
        return next;
      } catch (e) {
        const status = (e as { status?: number }).status;
        attempts.set(key, status === 409 ? { state: "done" }
          : { state: "failed", error: e instanceof Error ? e.message : "후보를 계산하지 못했어요." });
        return null;
      } finally {
        emit();
      }
    },
    /** 방장이 누르는 다시 계산하기 — 이 버전의 기록을 지워 자동 요청이 다시 돈다 */
    retry(snap: SharedResults) { attempts.delete(calcKey(snap)); emit(); },
  };
}

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
