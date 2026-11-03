"use client";
import { usePlaceRecommendations } from "@/components/usePlaceRecommendations";
import type { RoomSession, CatalogStatus } from "@/components/store";
import { CATEGORIES, findPlace } from "@/lib/places";
import { recommendationEvidence, type RecommendationRequest } from "@/lib/place-recommendations";
import type { Place } from "@/lib/types";

export function PlaceRecommendations({ room, catalog, sourceId, added, disabled, onAdd }: {
  room: RoomSession; catalog: CatalogStatus; sourceId: string; added: string[];
  disabled: boolean; onAdd: (place: Place) => void;
}) {
  const source = findPlace(sourceId);
  const enabled = !!source && !source.custom && added.includes(sourceId) && (catalog === "real" || catalog === "demo");
  const request: RecommendationRequest | null = enabled ? {
    roomId: room.roomId, memberId: room.memberId, token: room.token,
    dataset: catalog === "real" ? "osaka_review_150" : "prototype_demo_36",
    placeId: sourceId, excludePlaceIds: added.filter(id => !id.startsWith("custom_")),
  } : null;
  const { data, error, loading, retry } = usePlaceRecommendations(request);
  if (!enabled || !source) return null;
  const items = (data?.recommendations ?? []).flatMap(item => {
    const place = findPlace(item.placeId);
    return place && !place.custom && !place.selectionDisabledReason && !added.includes(item.placeId) ? [{ item, place }] : [];
  });
  return <section aria-labelledby="recommendation-title" className="mt-6 rounded-2xl border border-line p-4">
    <p className="break-words text-[12px] leading-5 text-mute">{source.name}을(를) 담았어요</p>
    <h2 id="recommendation-title" className="mt-1 text-[17px] font-extrabold leading-6 text-wine">이곳도 함께 살펴보세요</h2>
    <p className="mt-1 text-[12px] leading-5 text-mute">원하는 곳만 My list에 담아 주세요. ‘꼭 가기’는 나중에 따로 골라요.</p>
    {loading && <p role="status" className="mt-4 text-[13px] leading-5">함께 담긴 기록과 방문 조건을 확인하고 있어요.</p>}
    {error && <div className="mt-4 text-[13px] leading-5">
      <p role="status">{error} 검색과 목록 저장은 계속할 수 있어요.</p>
      <button type="button" onClick={retry} className="mt-2 rounded-lg border border-wine px-3 py-2 font-bold text-wine">추천 다시 조회</button>
    </div>}
    {data && <>
      {items.length === 0 ? <p role="status" className="mt-4 text-[13px] leading-5">지금 추천할 수 있는 다른 장소가 없어요. 검색으로 더 찾아보세요.</p> : <ul className="mt-4 space-y-3">
        {items.map(({ item, place }) => <li key={place.id} className="rounded-xl bg-[#faf7f8] p-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="break-words text-[15px] font-bold leading-6">{place.name}</p>
              <p className="mt-0.5 text-[12px] leading-5 text-mute">{[place.area, place.categoryLabel || CATEGORIES.find(c => c.id === place.category)?.label].filter(Boolean).join(" · ")}</p>
            </div>
            <button type="button" aria-label={`${place.name} 담기`} disabled={disabled || added.length >= 30}
              onClick={() => onAdd(place)} className="shrink-0 rounded-full border border-wine px-3 py-2 text-[13px] font-bold text-wine disabled:opacity-40">담기</button>
          </div>
          <p className="mt-2 text-[12px] font-semibold leading-5 text-wine">{recommendationEvidence(item)}</p>
        </li>)}
      </ul>}
      {added.length >= 30 && <p className="mt-3 text-[12px] leading-5">My list는 최대 30곳까지 담을 수 있어요.</p>}
      <details className="mt-4 text-[11px] leading-[18px] text-mute">
        <summary className="cursor-pointer">추천 근거는 어떻게 세나요?</summary>
        <p className="mt-2">숫자는 이 서버에 저장된 방별 참여 목록 수예요. 같은 사람이 여러 방에서 담으면 따로 세며, 시험용 목록도 포함될 수 있어요. 현재 동행 수나 실제 방문 인원은 아니에요.</p>
        <p className="mt-1">함께 담긴 기록이 부족하면 같은 지역·카테고리로 채워요. 가까운 이동 거리나 예산 적합성을 보장하지는 않아요.</p>
      </details>
      <p className="mt-2 text-[11px] leading-[18px] text-mute">{data.eligibility === "demo_unverified"
        ? "데모 장소예요. 실제 운영 조건은 검증되지 않았어요."
        : "여행 기간 중 하루 이상 방문 가능한 장소예요. 날짜별 운영·예약 조건은 따로 확인해 주세요."}</p>
    </>}
  </section>;
}
