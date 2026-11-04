/** P3 recommendation counts describe saved room-member lists, not unique people. */
export const RECOMMENDATION_FETCH_LIMIT = 6;
export type RecommendationDataset = "osaka_review_150" | "prototype_demo_36";
export type RecommendationReason = "co_pick" | "same_area_category" | "same_area" | "same_category";
export interface PlaceRecommendation {
  placeId: string;
  name: string;
  category: string | null;
  area: string | null;
  coPickCount: number;
  reason: RecommendationReason;
}
export interface PlaceRecommendations {
  dataset: RecommendationDataset;
  sourcePlaceId: string;
  countUnit: "room_member_list";
  generatedAt: string;
  eligibility: "at_least_one_trip_date" | "demo_unverified";
  recommendations: PlaceRecommendation[];
}
export interface RecommendationRequest {
  roomId: string;
  memberId: string;
  token: string;
  dataset: RecommendationDataset;
  placeId: string;
  excludePlaceIds: string[];
}

export class RecommendationError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) { super(message); this.status = status; }
}

const reasons = new Set(["co_pick", "same_area_category", "same_area", "same_category"]);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function decode(value: unknown, request: RecommendationRequest): PlaceRecommendations {
  const invalid = () => new RecommendationError("추천 근거를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
  if (!object(value) || value.dataset !== request.dataset || value.sourcePlaceId !== request.placeId
    || value.countUnit !== "room_member_list" || value.limit !== RECOMMENDATION_FETCH_LIMIT
    || !text(value.generatedAt) || !Number.isFinite(Date.parse(value.generatedAt))
    || value.eligibility !== (request.dataset === "osaka_review_150" ? "at_least_one_trip_date" : "demo_unverified")
    || !Array.isArray(value.recommendations) || value.recommendations.length > RECOMMENDATION_FETCH_LIMIT) throw invalid();
  const seen = new Set<string>();
  for (const item of value.recommendations) {
    if (!object(item) || !text(item.placeId) || !text(item.name) || seen.has(item.placeId)
      || item.placeId === request.placeId
      || !(item.category === null || typeof item.category === "string")
      || !(item.area === null || typeof item.area === "string")
      || typeof item.coPickCount !== "number" || !Number.isSafeInteger(item.coPickCount) || item.coPickCount < 0
      || typeof item.reason !== "string" || !reasons.has(item.reason)
      || (item.reason === "co_pick" ? item.coPickCount < 3 : item.coPickCount !== 0)) throw invalid();
    seen.add(item.placeId);
  }
  return value as unknown as PlaceRecommendations;
}

export function recommendationEvidence(item: PlaceRecommendation): string {
  if (item.reason === "co_pick") return `${item.coPickCount.toLocaleString("ko-KR")}개 참여 목록에서 함께 담김`;
  return { same_area_category: "같은 지역 · 같은 카테고리", same_area: "같은 지역", same_category: "같은 카테고리" }[item.reason];
}

/** Allow the server's 60s date check and SQLite/auth waits; no automatic retries. */
export function createRecommendationClient(baseUrl: string, fetcher: typeof fetch = fetch, timeoutMs = 90_000) {
  return async (request: RecommendationRequest, signal?: AbortSignal): Promise<PlaceRecommendations> => {
    const controller = new AbortController();
    const cancel = () => controller.abort(signal?.reason);
    if (signal?.aborted) cancel();
    else signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new RecommendationError("추천 조회가 늦어지고 있어요. 다시 시도해 주세요.")), timeoutMs);
    try {
      controller.signal.throwIfAborted();
      const response = await fetcher(`${baseUrl.replace(/\/$/, "")}/rooms/${encodeURIComponent(request.roomId)}/recommendations/${encodeURIComponent(request.memberId)}`, {
        method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${request.token}` },
        body: JSON.stringify({ placeId: request.placeId, excludePlaceIds: request.excludePlaceIds, limit: RECOMMENDATION_FETCH_LIMIT }),
      });
      if (!response.ok) throw new RecommendationError(
        response.status === 403 ? "참여 정보를 확인하지 못했어요. 초대 링크에서 다시 접속해 주세요."
          : response.status === 404 ? "추천 기능에 연결하지 못했어요. 서버 버전과 방 정보를 확인해 주세요."
            : "추천을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.", response.status);
      return decode(await response.json(), request);
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (error instanceof RecommendationError) throw error;
      throw new RecommendationError("추천을 불러오지 못했어요. 서버 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  };
}
