/** P7/P8 shared-result contract. Separate from the legacy single-strategy client. */
export type SharedStrategy = "average" | "least_misery" | "fairness";
export const SHARED_STRATEGIES: SharedStrategy[] = ["average", "least_misery", "fairness"];
export interface SharedCandidate {
  strategy: SharedStrategy;
  metrics: { walkStepsPerDay: number; costKrwPerDay: number; totalKmPerDay: number };
  summary: string;
  explanationSource: "rules" | "ai";
  days: {
    date: string;
    placeIds: string[];
    metrics: { walkSteps: number; costKrw: number; totalKm: number };
    items: {
      placeId: string;
      aiAdded: boolean;
      filled: boolean;
      source: "selected" | "rule_added" | "ai_added" | "meal_fill";
      reasonCode: string | null;
      reason: string | null;
    }[];
  }[];
}
export interface SharedResults {
  dataset: string;
  roomId: string;
  status: "collecting" | "awaiting_result" | "calculating" | "awaiting_selection" | "ready" | "draft";
  submittedCount: number;
  memberCount: number;
  /** Changes whenever a participant submits. Old candidates must be discarded. */
  revision: number;
  candidates: SharedCandidate[];
  selectedStrategy: SharedStrategy | null;
  /** Owner selection version, independent from the input revision. */
  selectionVersion: number;
  result: { strategy: SharedStrategy; days: { date: string; placeIds: string[] }[]; summary: string } | null;
}

export class SharedResultError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export function selectedCandidate(snapshot: SharedResults): SharedCandidate | null {
  if (snapshot.status !== "ready" || !snapshot.selectedStrategy) return null;
  return snapshot.candidates.find(c => c.strategy === snapshot.selectedStrategy) ?? null;
}

export function createSharedResultClient(baseUrl: string, fetcher: typeof fetch = fetch) {
  const base = baseUrl.replace(/\/$/, "");
  async function request(roomId: string, path: string, token: string, method: string,
    body?: object, signal?: AbortSignal): Promise<SharedResults> {
    const response = await fetcher(`${base}/rooms/${encodeURIComponent(roomId)}/${path}`, {
      method, cache: "no-store", signal,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json().catch((error: unknown) => {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      return null;
    });
    if (!response.ok) throw new SharedResultError(
      typeof value?.error === "string" ? value.error : "서버 결과를 불러오지 못했습니다.", response.status,
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new SharedResultError("서버 응답을 읽을 수 없습니다.", response.status);
    }
    return value;
  }
  return {
    get: (roomId: string, roomToken: string, signal?: AbortSignal) =>
      request(roomId, "results", roomToken, "GET", undefined, signal),
    calculateAll: (roomId: string, ownerToken: string, revision: number, signal?: AbortSignal) =>
      request(roomId, "calculate", ownerToken, "POST", { strategies: SHARED_STRATEGIES, revision }, signal),
    select: (roomId: string, ownerToken: string, snapshot: Pick<SharedResults, "revision" | "selectionVersion">,
      strategy: SharedStrategy, signal?: AbortSignal) =>
      request(roomId, "selection", ownerToken, "PUT", {
        revision: snapshot.revision, selectionVersion: snapshot.selectionVersion, strategy,
      }, signal),
  };
}
