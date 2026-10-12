/**
 * 화면에서 받지만 아직 서버·알고리즘이 쓰지 않는 입력 (#35에서 연결한다).
 * 방·참여자마다 따로여야 한다 — 다른 자리로 들어가면 초기화하고 그 사람의 서버 입력에서 다시 만든다.
 * 기본값과 복원은 room-state.ts에 있다 (타입만 두어 node 검사에서도 그대로 읽힌다).
 */
/** 숙소 한 곳. 좌표는 지도 검색으로 고른 경우에만 있다 */
export interface Lodging {
  address: string;
  lat?: number;
  lng?: number;
}

export interface TripExtras {
  /** 꼭 가기·제외는 개수 제한이 없어서 목록으로 둔다. 서버에는 picks·must·veto로 줄여 보낸다 */
  mustList: string[];
  vetoList: string[];
  arrivalAirport: string;
  departureAirport: string;
  /** "HH:MM" */
  arrivalTime: string;
  departureTime: string;
  /** 박마다 하나 (첫째 날 숙소, 둘째 날 숙소…) */
  lodgings: Lodging[];
  /** 하루 활동 시작·종료 "HH:MM". activeMin은 이 차이로 정한다 */
  dayStart: string;
  dayEnd: string;
  /** 0~1. 0은 왼쪽(바쁘게·이동 짧게·절약) */
  tradeoff: { pace: number; distance: number; spend: number };
  /** P8에서 고친 날짜별 장소 순서 (없으면 계산 결과 그대로) */
  planEdits: Record<number, string[]>;
  confirmed: boolean;
}
