/** 장소 카테고리 */
export type CategoryId =
  | "landmark"   // 명소·관광
  | "food"       // 식사
  | "cafe"       // 카페·디저트
  | "shopping"   // 쇼핑
  | "culture"    // 문화·전시
  | "activity"   // 체험·액티비티
  | "nature";    // 자연·공원

export interface Category {
  id: CategoryId;
  label: string;
  color: string;
}

/** 실내 노출 정도 — 날씨 반영에 쓰인다 (0 완전 실내 ~ 1 완전 실외) */
export type Exposure = 0 | 0.3 | 0.6 | 1;

export interface Place {
  id: string;
  name: string;
  area: string;             // 지역 (우메다, 난바 등)
  category: CategoryId;
  lat: number;
  lng: number;
  /** 1인 예상 지출(원). 0이면 무료 */
  cost: number;
  /** 평균 체류 시간(분) */
  stayMin: number;
  /** 영업 시작·종료 (분 단위, 0시 기준). 예: 10:00 → 600 */
  openFrom: number;
  openTo: number;
  /** 실외 노출 정도 */
  exposure: Exposure;
  /** 지하상가·아케이드로 연결되는가 */
  covered: boolean;
  /** 쇼핑으로 짐이 늘어나는 정도 (0~1) */
  bagLoad: number;
  /**
   * 보편적 매력도 (0~1).
   * 직접 고르지 않은 사람에게도 어느 정도 효용을 주는 값으로,
   * '아무도 1순위는 아니지만 모두 무난한' 후보를 만든다.
   * 실제 구현에서는 리뷰 수·평점으로 산출한다.
   */
  popularity: number;
  blurb: string;
  /** 사용자가 직접 추가한 장소인가 (좌표·비용이 추정값) */
  custom?: boolean;
}

export interface Member {
  id: string;
  name: string;
  color: string;
}

/** 각자의 비공개 입력 */
export interface Submission {
  memberId: string;
  /**
   * 1차 — 검색으로 직접 찾은 5곳.
   * 그룹 후보 풀은 전원의 longlist를 합친 것이다.
   */
  longlist: string[];
  /** 2차 — 그룹 후보 풀에서 다시 고른 가고 싶은 장소 id 목록 */
  picks: string[];
  /** 꼭 가고 싶은 곳 (picks 중 하나) */
  must: string | null;
  /** 가고 싶지 않은 곳 */
  veto: string | null;
  /** 하루에 쓸 수 있는 돈(원). 여행 전체 예산은 일수를 곱해 구한다 */
  budgetPerDay: number;
  /** 하루 걸을 수 있는 걸음 수(보) */
  stepLimit: number;
  /** 하루 활동 가능 시간(분) */
  activeMin: number;
}

/**
 * 계산용으로 단위를 환산한 입력.
 * 사용자는 '하루 얼마·몇 보'로 말하지만 합의 계산은 '여행 총액·km'로 한다.
 */
export interface SubmissionView extends Submission {
  /** 여행 전체 예산(원) = budgetPerDay × 일수 */
  budget: number;
  /** 하루 걷기 한계(km) = stepLimit × 보폭 */
  walkLimit: number;
}

export type Strategy = "average" | "least_misery" | "fairness";

/** 채택 결과의 한 장소 */
export interface Selection {
  place: Place;
  /** 몇 명이 골랐는가 */
  votes: number;
  /** 누구의 '꼭'인가 */
  mustOf: string | null;
  /** 코어(전원) / 옵션(일부) */
  tier: "core" | "option";
  /** 옵션일 때 참여 가능한 사람 */
  participants: string[];
  /** 제외됐다면 이유 */
  excluded?: "veto" | "budget" | "time" | "walk";
  /** 아무도 고르지 않았지만 합의에 맞아 AI가 채운 곳인가 */
  aiAdded?: boolean;
}

export interface MemberSatisfaction {
  memberId: string;
  /** 내가 고른 곳 중 채택된 비율 */
  pickRate: number;
  /** 내 '꼭'이 지켜졌는가 */
  mustKept: boolean;
  /** 내 예산 대비 실제 비용 (1이면 딱 맞음, <1 여유) */
  budgetUse: number;
  /** 내 걷기 한계 대비 실제 (1이면 딱 맞음) */
  walkUse: number;
  /** 내 거부가 지켜졌는가 */
  vetoKept: boolean;
  /** 종합 만족도 0~1 */
  score: number;
}

export interface ConsensusResult {
  strategy: Strategy;
  selections: Selection[];
  core: Selection[];
  options: Selection[];
  excluded: Selection[];
  satisfaction: MemberSatisfaction[];
  /** 그룹 지표 */
  metrics: {
    mean: number;
    min: number;
    std: number;
    gini: number;
    mustKeptRate: number;
    perPersonCost: number;
  };
}

export interface ScheduleItem {
  place: Place;
  /** filled = 선택되지 않았지만 빈 시간을 채우려고 넣은 장소 */
  tier: "core" | "option" | "filled";
  /** 시작 시각 (분) */
  startMin: number;
  endMin: number;
  /** 직전 장소에서의 이동 (분, km) */
  moveMin: number;
  moveKm: number;
  participants: string[];
}

export interface DayPlan {
  day: number;
  items: ScheduleItem[];
  /** 실제로 걷는 거리(km) — 체력 제약은 이 값으로 따진다 */
  walkKm: number;
  /** 대중교통 포함 총 이동 거리(km) */
  totalKm: number;
  totalMoveMin: number;
  cost: number;
}
