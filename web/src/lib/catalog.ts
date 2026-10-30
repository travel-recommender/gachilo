/**
 * 서버의 실제 장소 목록(기존 호환 ID: `osaka_review_150`)을 화면의 Place로 바꾼다.
 * 이 방에서는 P3 검색·P4 목록·P8 지도가 모두 이 목록을 본다. 계산은 서버가 하므로
 * 표시 이름·원래 이름·확인 상태를 보존한다. 미확인 좌표는 지도에 표시하지 않으며 비용 0 기본값은 무료라는 뜻이 아니다.
 * (검사: web/_test/catalog.test.ts)
 */
import type { CategoryId, Place } from "./types";

export const REAL_DATASET = "osaka_review_150";

/** 서버 /api/places의 장소 한 곳 (화면이 쓰는 필드만) */
export interface ApiCatalogPlace {
  place_id: string;
  name: string;
  name_ko: string | null;
  category: string;
  area: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  search_names?: string[];
  record_status?: string;
  cost_basis?: string | null;
  cost_status?: string;
  visit_conditions?: string[];
  selection_disabled_reason?: string | null;
  stay_min: number | null;
  bag_load: number | null;
  covered: boolean | null;
  cost_krw: number | null;
}

/** 서버 분류(한국어) → 화면 분류. 모르는 분류는 명소로 본다 */
const CATEGORY: Record<string, CategoryId> = {
  명소: "landmark", 식사: "food", 카페: "cafe", 쇼핑: "shopping", 문화: "culture", 체험: "activity", "체험·오락": "activity", 복합문화: "culture", 자연: "nature",
};

/** 서버 장소 한 곳 → 화면 Place. 지역(區)·주소는 일본어 그대로 둔다 */
export function toPlace(p: ApiCatalogPlace): Place {
  return {
    id: p.place_id,
    name: p.name_ko?.trim() || p.name,
    area: p.area ?? "",
    category: CATEGORY[p.category] ?? "landmark",
    lat: p.latitude ?? Number.NaN,
    lng: p.longitude ?? Number.NaN,
    categoryLabel: p.category || "분류 확인 중",
    searchNames: p.search_names ?? [p.name],
    catalogStatus: p.record_status,
    selectionDisabledReason: p.selection_disabled_reason,
    costKnown: p.cost_krw !== null,
    costEstimated: p.cost_status === "estimate",
    shoppingSpendExcluded: p.cost_status === "not_applicable_shopping",
    cost: p.cost_krw ?? 0,
    stayMin: p.stay_min ?? 60,
    openFrom: 0,
    openTo: 1440,
    exposure: 0.3,
    covered: !!p.covered,
    bagLoad: p.bag_load ?? 0,
    popularity: 0.5,
    blurb: [p.cost_basis, ...(p.visit_conditions ?? [])].filter(Boolean).join(" · "),
    address: p.address ?? undefined,
  };
}

/** Keep every record searchable; unavailable records explain why they cannot be selected. */
export function roomCatalog(places: ApiCatalogPlace[], placeIds: string[] | null): Place[] {
  const usable = placeIds ? new Set(placeIds) : null;
  return places.map(p => ({ ...toPlace(p), selectionDisabledReason: p.selection_disabled_reason
    || (usable && !usable.has(p.place_id) ? "방문일 운영 조건이 확인되지 않아 일정에 담을 수 없어요." : null) }));
}
