/**
 * 실제 장소 150곳(`osaka_review_150`)을 화면의 Place로 바꾼다.
 * 이 방에서는 P3 검색·P4 목록·P8 지도가 모두 이 목록을 본다. 계산은 서버가 하므로
 * 화면에서는 이름·분류·주소·좌표만 정확하면 된다 — 비용·영업시간은 서버 값이 없으면 기본값으로 둔다.
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
  latitude: number;
  longitude: number;
  stay_min: number | null;
  bag_load: number | null;
  covered: boolean | null;
  cost_krw: number | null;
}

/** 서버 분류(한국어) → 화면 분류. 모르는 분류는 명소로 본다 */
const CATEGORY: Record<string, CategoryId> = {
  명소: "landmark", 식사: "food", 카페: "cafe", 쇼핑: "shopping", 문화: "culture", 체험: "activity", 자연: "nature",
};

/** 서버 장소 한 곳 → 화면 Place. 지역(區)·주소는 일본어 그대로 둔다 */
export function toPlace(p: ApiCatalogPlace): Place {
  return {
    id: p.place_id,
    name: p.name_ko?.trim() || p.name,
    area: p.area ?? "",
    category: CATEGORY[p.category] ?? "landmark",
    lat: p.latitude,
    lng: p.longitude,
    cost: p.cost_krw ?? 0,
    stayMin: p.stay_min ?? 60,
    openFrom: 0,
    openTo: 1440,
    exposure: 0.3,
    covered: !!p.covered,
    bagLoad: p.bag_load ?? 0,
    popularity: 0.5,
    blurb: "",
    address: p.address ?? undefined,
  };
}
