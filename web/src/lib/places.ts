import type { Category, CategoryId, Member, Place } from "./types";

export const CATEGORIES: Category[] = [
  { id: "landmark", label: "명소", color: "#2f45e0" },
  { id: "food", label: "식사", color: "#f9584a" },
  { id: "cafe", label: "카페", color: "#b07a4a" },
  { id: "shopping", label: "쇼핑", color: "#e0498f" },
  { id: "culture", label: "문화", color: "#7a5af5" },
  { id: "activity", label: "체험", color: "#0ea5e9" },
  { id: "nature", label: "자연", color: "#12b98c" },
];

export const CATEGORY_MAP: Record<CategoryId, Category> = CATEGORIES.reduce(
  (a, c) => ({ ...a, [c.id]: c }),
  {} as Record<CategoryId, Category>
);

const t = (h: number, m = 0) => h * 60 + m;
const ALLDAY: [number, number] = [0, 1440];

/**
 * 오사카 장소 데이터 (프로토타입 36곳).
 * 좌표는 대략값이며, 본 구현에서는 OSM Overpass API로 수집해 검증할 예정.
 */
export const PLACES: Place[] = [
  // ── 우메다 · 키타 ──
  { id: "umeda_sky", name: "우메다 스카이빌딩 공중정원", area: "우메다", category: "landmark",
    lat: 34.7052, lng: 135.4903, cost: 15000, stayMin: 90, openFrom: t(9,30), openTo: t(22,30),
    exposure: 0.6, covered: false, bagLoad: 0, popularity: 0.85, blurb: "360도 야경 전망대. 해질녘이 가장 좋아요." },
  { id: "hankyu", name: "한큐백화점 우메다", area: "우메다", category: "shopping",
    lat: 34.7025, lng: 135.4985, cost: 60000, stayMin: 90, openFrom: t(10), openTo: t(20),
    exposure: 0, covered: true, bagLoad: 0.6, popularity: 0.6, blurb: "지하 식품관이 유명한 대형 백화점." },
  { id: "grand_front", name: "그랑프론트 오사카", area: "우메다", category: "shopping",
    lat: 34.7045, lng: 135.4940, cost: 40000, stayMin: 80, openFrom: t(10), openTo: t(21),
    exposure: 0, covered: true, bagLoad: 0.5, popularity: 0.55, blurb: "우메다역 직결 복합 쇼핑몰." },
  { id: "whity", name: "화이티 우메다 지하상가", area: "우메다", category: "shopping",
    lat: 34.7020, lng: 135.4990, cost: 20000, stayMin: 60, openFrom: t(10), openTo: t(21),
    exposure: 0, covered: true, bagLoad: 0.3, popularity: 0.45, blurb: "비 와도 걱정 없는 대형 지하상가." },
  { id: "nakazaki", name: "나카자키초 카페거리", area: "우메다", category: "cafe",
    lat: 34.7080, lng: 135.5040, cost: 9000, stayMin: 60, openFrom: t(11), openTo: t(19),
    exposure: 0.6, covered: false, bagLoad: 0, popularity: 0.4, blurb: "옛 골목을 개조한 카페들이 모인 동네." },
  { id: "hanadako", name: "하나다코 타코야키", area: "우메다", category: "food",
    lat: 34.7035, lng: 135.5000, cost: 7500, stayMin: 30, openFrom: t(10), openTo: t(23),
    exposure: 0.3, covered: true, bagLoad: 0, popularity: 0.6, blurb: "파가 듬뿍 올라간 네기마요 타코야키." },
  { id: "donki_umeda", name: "돈키호테 우메다", area: "우메다", category: "shopping",
    lat: 34.7045, lng: 135.5020, cost: 30000, stayMin: 60, openFrom: ALLDAY[0], openTo: ALLDAY[1],
    exposure: 0, covered: true, bagLoad: 0.5, popularity: 0.55, blurb: "24시간 영업. 기념품 쇼핑 마무리에 좋아요." },

  // ── 오사카성 · 나카노시마 ──
  { id: "osaka_castle", name: "오사카성 천수각", area: "오사카성", category: "landmark",
    lat: 34.6873, lng: 135.5259, cost: 6000, stayMin: 90, openFrom: t(9), openTo: t(17),
    exposure: 0.6, covered: false, bagLoad: 0, popularity: 0.95, blurb: "오사카의 상징. 성 주변 산책도 함께." },
  { id: "castle_park", name: "오사카성 공원", area: "오사카성", category: "nature",
    lat: 34.6860, lng: 135.5250, cost: 0, stayMin: 60, openFrom: t(5), openTo: t(23),
    exposure: 1, covered: false, bagLoad: 0, popularity: 0.6, blurb: "넓은 공원. 봄에는 벚꽃 명소." },
  { id: "nakanoshima", name: "나카노시마 공원", area: "나카노시마", category: "nature",
    lat: 34.6920, lng: 135.5090, cost: 0, stayMin: 45, openFrom: ALLDAY[0], openTo: ALLDAY[1],
    exposure: 1, covered: false, bagLoad: 0, popularity: 0.4, blurb: "강 사이에 낀 도심 공원. 장미원이 예뻐요." },
  { id: "science_museum", name: "오사카 시립과학관", area: "나카노시마", category: "culture",
    lat: 34.6913, lng: 135.4913, cost: 6000, stayMin: 90, openFrom: t(9,30), openTo: t(17),
    exposure: 0, covered: false, bagLoad: 0, popularity: 0.35, blurb: "플라네타리움이 있는 과학관." },
  { id: "nmao", name: "국립국제미술관", area: "나카노시마", category: "culture",
    lat: 34.6917, lng: 135.4919, cost: 8000, stayMin: 80, openFrom: t(10), openTo: t(17),
    exposure: 0, covered: false, bagLoad: 0, popularity: 0.3, blurb: "지하로 내려가는 독특한 구조의 현대미술관." },

  // ── 난바 · 신사이바시 · 도톤보리 ──
  { id: "glico", name: "도톤보리 글리코사인", area: "난바", category: "landmark",
    lat: 34.6687, lng: 135.5013, cost: 0, stayMin: 40, openFrom: ALLDAY[0], openTo: ALLDAY[1],
    exposure: 1, covered: false, bagLoad: 0, popularity: 1.0, blurb: "오사카 인증샷 필수 코스. 밤 네온이 매력." },
  { id: "shinsaibashi", name: "신사이바시스지 상점가", area: "신사이바시", category: "shopping",
    lat: 34.6723, lng: 135.5013, cost: 50000, stayMin: 90, openFrom: t(11), openTo: t(21),
    exposure: 0, covered: true, bagLoad: 0.6, popularity: 0.85, blurb: "지붕 덮인 600m 아케이드 상점가." },
  { id: "kuromon", name: "구로몬 시장", area: "난바", category: "food",
    lat: 34.6654, lng: 135.5063, cost: 15000, stayMin: 60, openFrom: t(9), openTo: t(18),
    exposure: 0.3, covered: true, bagLoad: 0.1, popularity: 0.9, blurb: "해산물·꼬치구이를 즐기는 오사카의 부엌." },
  { id: "hozenji", name: "호젠지 요코초", area: "난바", category: "landmark",
    lat: 34.6683, lng: 135.5028, cost: 0, stayMin: 30, openFrom: ALLDAY[0], openTo: ALLDAY[1],
    exposure: 0.6, covered: false, bagLoad: 0, popularity: 0.5, blurb: "이끼 덮인 불상이 있는 옛 골목." },
  { id: "namba_parks", name: "난바 파크스", area: "난바", category: "shopping",
    lat: 34.6595, lng: 135.5020, cost: 35000, stayMin: 80, openFrom: t(11), openTo: t(21),
    exposure: 0.3, covered: true, bagLoad: 0.5, popularity: 0.55, blurb: "옥상 정원이 있는 쇼핑몰." },
  { id: "denden", name: "덴덴타운", area: "난바", category: "shopping",
    lat: 34.6607, lng: 135.5061, cost: 25000, stayMin: 70, openFrom: t(11), openTo: t(20),
    exposure: 0.6, covered: false, bagLoad: 0.4, popularity: 0.35, blurb: "오사카의 전자·애니메이션 거리." },
  { id: "ichiran", name: "이치란 라멘 도톤보리", area: "난바", category: "food",
    lat: 34.6700, lng: 135.5020, cost: 12000, stayMin: 40, openFrom: ALLDAY[0], openTo: ALLDAY[1],
    exposure: 0, covered: true, bagLoad: 0, popularity: 0.8, blurb: "1인석 돈코츠 라멘. 24시간 영업." },
  { id: "mizuno", name: "미즈노 오코노미야키", area: "난바", category: "food",
    lat: 34.6680, lng: 135.5010, cost: 16000, stayMin: 50, openFrom: t(11), openTo: t(22),
    exposure: 0, covered: false, bagLoad: 0, popularity: 0.65, blurb: "웨이팅 긴 노포 오코노미야키." },
  { id: "daruma", name: "다루마 쿠시카츠", area: "신세카이", category: "food",
    lat: 34.6525, lng: 135.5060, cost: 14000, stayMin: 50, openFrom: t(11), openTo: t(22,30),
    exposure: 0, covered: false, bagLoad: 0, popularity: 0.7, blurb: "소스 두 번 찍기 금지. 신세카이 명물." },
  { id: "horai", name: "551 호라이 난바", area: "난바", category: "food",
    lat: 34.6660, lng: 135.5010, cost: 6000, stayMin: 20, openFrom: t(10), openTo: t(22),
    exposure: 0, covered: true, bagLoad: 0, popularity: 0.6, blurb: "오사카 사람들의 국민 간식 고기만두." },
  { id: "rikuro", name: "리쿠로 치즈케이크 난바", area: "난바", category: "cafe",
    lat: 34.6665, lng: 135.5015, cost: 5000, stayMin: 25, openFrom: t(9), openTo: t(20),
    exposure: 0, covered: true, bagLoad: 0.1, popularity: 0.65, blurb: "갓 구운 폭신한 치즈케이크." },
  { id: "amemura", name: "아메리카무라", area: "신사이바시", category: "shopping",
    lat: 34.6730, lng: 135.4980, cost: 25000, stayMin: 60, openFrom: t(11), openTo: t(20),
    exposure: 0.6, covered: false, bagLoad: 0.4, popularity: 0.45, blurb: "빈티지숍이 모인 젊은 거리." },
  { id: "doguyasuji", name: "도구야스지 상점가", area: "난바", category: "shopping",
    lat: 34.6650, lng: 135.5055, cost: 15000, stayMin: 45, openFrom: t(10), openTo: t(18),
    exposure: 0, covered: true, bagLoad: 0.3, popularity: 0.3, blurb: "주방용품 전문 아케이드. 기념품 찾기 좋아요." },

  // ── 신세카이 · 텐노지 ──
  { id: "tsutenkaku", name: "츠텐카쿠", area: "신세카이", category: "landmark",
    lat: 34.6524, lng: 135.5063, cost: 12000, stayMin: 50, openFrom: t(10), openTo: t(20),
    exposure: 0.3, covered: false, bagLoad: 0, popularity: 0.7, blurb: "쇼와 시대 분위기의 전망탑." },
  { id: "shitennoji", name: "시텐노지", area: "텐노지", category: "culture",
    lat: 34.6541, lng: 135.5165, cost: 4000, stayMin: 60, openFrom: t(8,30), openTo: t(16,30),
    exposure: 0.6, covered: false, bagLoad: 0, popularity: 0.45, blurb: "일본에서 가장 오래된 관영 사찰." },
  { id: "harukas", name: "아베노 하루카스 전망대", area: "텐노지", category: "landmark",
    lat: 34.6458, lng: 135.5136, cost: 18000, stayMin: 70, openFrom: t(9), openTo: t(22),
    exposure: 0, covered: true, bagLoad: 0, popularity: 0.75, blurb: "일본 최고층 빌딩 전망대. 300m 높이." },
  { id: "shinsekai", name: "신세카이 거리", area: "신세카이", category: "landmark",
    lat: 34.6520, lng: 135.5055, cost: 0, stayMin: 40, openFrom: ALLDAY[0], openTo: ALLDAY[1],
    exposure: 1, covered: false, bagLoad: 0, popularity: 0.7, blurb: "간판이 빼곡한 복고풍 거리." },
  { id: "tennoji_zoo", name: "텐노지 동물원", area: "텐노지", category: "activity",
    lat: 34.6510, lng: 135.5090, cost: 5000, stayMin: 90, openFrom: t(9,30), openTo: t(17),
    exposure: 1, covered: false, bagLoad: 0, popularity: 0.35, blurb: "도심 한가운데 있는 100년 넘은 동물원." },

  // ── 베이 (덴포잔) ──
  { id: "kaiyukan", name: "가이유칸 수족관", area: "베이", category: "activity",
    lat: 34.6545, lng: 135.4289, cost: 24000, stayMin: 150, openFrom: t(10), openTo: t(20),
    exposure: 0, covered: false, bagLoad: 0, popularity: 0.9, blurb: "세계 최대급 수족관. 고래상어가 있어요." },
  { id: "tempozan", name: "덴포잔 대관람차", area: "베이", category: "activity",
    lat: 34.6540, lng: 135.4295, cost: 8000, stayMin: 30, openFrom: t(10), openTo: t(22),
    exposure: 0.3, covered: false, bagLoad: 0, popularity: 0.5, blurb: "높이 112m 관람차. 오사카만 전망." },
  { id: "usj", name: "유니버설 스튜디오 재팬", area: "베이", category: "activity",
    lat: 34.6656, lng: 135.4323, cost: 85000, stayMin: 480, openFrom: t(9), openTo: t(21),
    exposure: 1, covered: false, bagLoad: 0, popularity: 0.95, blurb: "하루를 통째로 써야 하는 테마파크." },
  { id: "kuishinbo", name: "나니와 쿠이신보 요코초", area: "베이", category: "food",
    lat: 34.6548, lng: 135.4290, cost: 13000, stayMin: 60, openFrom: t(11), openTo: t(20),
    exposure: 0, covered: false, bagLoad: 0, popularity: 0.35, blurb: "쇼와 거리를 재현한 실내 먹자골목." },

  // ── 기타 ──
  { id: "sumiyoshi", name: "스미요시타이샤", area: "스미요시", category: "culture",
    lat: 34.6126, lng: 135.4934, cost: 0, stayMin: 60, openFrom: t(6), openTo: t(17),
    exposure: 1, covered: false, bagLoad: 0, popularity: 0.4, blurb: "아치형 다리로 유명한 1800년 된 신사." },
  { id: "tsuruhashi", name: "츠루하시 코리아타운", area: "츠루하시", category: "food",
    lat: 34.6650, lng: 135.5330, cost: 12000, stayMin: 60, openFrom: t(10), openTo: t(19),
    exposure: 0.6, covered: false, bagLoad: 0.2, popularity: 0.35, blurb: "일본 속 한국 시장. 골목이 미로 같아요." },
];

export const PLACE_MAP: Record<string, Place> = PLACES.reduce(
  (a, p) => ({ ...a, [p.id]: p }),
  {} as Record<string, Place>
);

/** 참여자 색 — 이름을 직접 입력받으므로 순서대로 배정한다 */
export const MEMBER_COLORS = ["#2f45e0", "#f9584a", "#12b98c", "#7a5af5", "#f59e0b", "#0ea5e9"];

/** 첫 화면에서 이름을 바꾸기 전의 기본 구성 */
export const DEFAULT_MEMBERS: Member[] = [
  { id: "me", name: "나", color: MEMBER_COLORS[0] },
  { id: "m1", name: "윤진", color: MEMBER_COLORS[1] },
  { id: "m2", name: "조은", color: MEMBER_COLORS[2] },
  { id: "m3", name: "민서", color: MEMBER_COLORS[3] },
  { id: "m4", name: "도윤", color: MEMBER_COLORS[4] },
];

/**
 * 참여자 레지스트리.
 * 이름을 첫 화면에서 받으므로 상수로 둘 수 없다. 화면은 store의 members를 쓰고,
 * 화면 밖(explain 등)에서는 여기 등록된 값을 본다.
 */
let MEMBERS_RT: Member[] = DEFAULT_MEMBERS;

export function setMembers(list: Member[]) {
  MEMBERS_RT = list.length ? list : DEFAULT_MEMBERS;
}

export function allMembers(): Member[] {
  return MEMBERS_RT;
}

export function findMember(id: string): Member {
  return MEMBERS_RT.find((m) => m.id === id) ?? { id, name: id, color: MEMBER_COLORS[0] };
}

/** 이름 목록으로 참여자를 만든다. 첫 번째가 '나' */
export function makeMembers(names: string[]): Member[] {
  return names.map((name, i) => ({
    id: i === 0 ? "me" : `m${i}`,
    name: name.trim() || (i === 0 ? "나" : `친구${i}`),
    color: MEMBER_COLORS[i % MEMBER_COLORS.length],
  }));
}

/** 데이터에 있는 지역 목록 (장소 추가 화면의 선택지) */
export const AREAS: string[] = [...new Set(PLACES.map((p) => p.area))];

/** 지역 중심 좌표 — 사용자가 추가한 장소의 좌표를 여기서 빌린다 */
const AREA_CENTER: Record<string, { lat: number; lng: number }> = AREAS.reduce((a, area) => {
  const ps = PLACES.filter((p) => p.area === area);
  return {
    ...a,
    [area]: {
      lat: ps.reduce((s, p) => s + p.lat, 0) / ps.length,
      lng: ps.reduce((s, p) => s + p.lng, 0) / ps.length,
    },
  };
}, {} as Record<string, { lat: number; lng: number }>);

/**
 * 카테고리별 기본값.
 * 사용자는 이름·카테고리·지역 정도만 알고 있으므로, 나머지 필드는 같은 카테고리
 * 장소들의 중앙값 성격의 값으로 채운다. 본 구현에서는 OSM·리뷰 데이터로 대체한다.
 */
const CATEGORY_DEFAULT: Record<CategoryId, Pick<Place, "cost" | "stayMin" | "openFrom" | "openTo" | "exposure" | "covered" | "bagLoad">> = {
  landmark: { cost: 8000, stayMin: 90, openFrom: t(9), openTo: t(18), exposure: 0.6, covered: false, bagLoad: 0 },
  food:     { cost: 12000, stayMin: 60, openFrom: t(11), openTo: t(21), exposure: 0, covered: true, bagLoad: 0 },
  cafe:     { cost: 8000, stayMin: 50, openFrom: t(10), openTo: t(20), exposure: 0, covered: true, bagLoad: 0 },
  shopping: { cost: 30000, stayMin: 70, openFrom: t(10), openTo: t(21), exposure: 0, covered: true, bagLoad: 0.5 },
  culture:  { cost: 6000, stayMin: 80, openFrom: t(9,30), openTo: t(17), exposure: 0.3, covered: true, bagLoad: 0 },
  activity: { cost: 25000, stayMin: 120, openFrom: t(10), openTo: t(19), exposure: 0.6, covered: false, bagLoad: 0 },
  nature:   { cost: 0, stayMin: 60, openFrom: t(6), openTo: t(20), exposure: 1, covered: false, bagLoad: 0 },
};

export interface CustomPlaceInput {
  name: string;
  category: CategoryId;
  area: string;
  /** 1인 예상 지출(원). 비우면 카테고리 기본값 */
  cost?: number;
  /** 예상 체류 시간(분). 비우면 카테고리 기본값 */
  stayMin?: number;
}

/**
 * 사용자가 직접 추가한 장소를 Place로 만든다.
 * 좌표는 지역 중심값을 빌려 쓰므로 동선 계산은 대략적이다 — UI에서 그렇게 안내한다.
 * popularity는 '아무도 모르는 곳'이라는 뜻에서 낮게 둔다. 본인이 골랐으므로
 * 본인 효용은 직접 선택 값(0.85)으로 계산되고, 이 값은 남에게 주는 부분 효용에만 쓰인다.
 */
export function makeCustomPlace(input: CustomPlaceInput): Place {
  const base = CATEGORY_DEFAULT[input.category];
  const center = AREA_CENTER[input.area] ?? { lat: 34.6687, lng: 135.5013 };
  return {
    ...base,
    id: `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: input.name.trim(),
    area: input.area,
    category: input.category,
    lat: center.lat,
    lng: center.lng,
    cost: input.cost ?? base.cost,
    stayMin: input.stayMin ?? base.stayMin,
    popularity: 0.25,
    blurb: "직접 추가한 장소예요. 위치는 지역 중심으로 잡혀 있어 동선은 대략값입니다.",
    custom: true,
  };
}

/**
 * 사용자가 추가한 장소 레지스트리.
 * PLACES는 정적 데이터라 추가분을 담을 수 없어, 조회 지점(findPlace·allPlaces)을
 * 한 곳으로 모으고 화면 쪽에서 setCustomPlaces로 최신 목록을 밀어 넣는다.
 */
let CUSTOM: Place[] = [];

export function setCustomPlaces(list: Place[]) {
  CUSTOM = list;
}

export function allPlaces(): Place[] {
  return CUSTOM.length ? [...PLACES, ...CUSTOM] : PLACES;
}

export function findPlace(id: string): Place | undefined {
  return PLACE_MAP[id] ?? CUSTOM.find((p) => p.id === id);
}
