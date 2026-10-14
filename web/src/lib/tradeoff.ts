/**
 * P6 trade off 세 축. 화면 값은 0~1이고 0이 왼쪽이다.
 * 축끼리 서로 묶여 있다 — 멀리 다니거나 알차게 다니면 교통비·입장료가 들어서
 * '아껴서'를 끝까지 내릴 수 없다. 그 하한을 여기서 정한다. (검사: web/_test/tradeoff.test.ts)
 */
import type { TripExtras } from "./extras";

export type Tradeoff = TripExtras["tradeoff"];
export type TradeKey = keyof Tradeoff;

export const TRADES: { key: TradeKey; left: string; right: string }[] = [
  { key: "pace", left: "알차게", right: "느긋하게" },
  { key: "distance", left: "가까이", right: "멀리도" },
  { key: "spend", left: "아껴서", right: "넉넉히" },
];

/** '멀리도' 끝(1)에서 아낄 수 있는 한계. 가운데까지는 묶지 않는다 */
const FAR_FLOOR = 0.5;
/** '알차게' 끝(0)에서 아낄 수 있는 한계 */
const BUSY_FLOOR = 0.4;
/** 둘 다 끝이어도 이보다 위로는 올리지 않는다 */
const MAX_FLOOR = 0.7;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** '아껴서' 쪽으로 내릴 수 있는 가장 낮은 값과 그 이유 */
export function spendFloor(t: Pick<Tradeoff, "pace" | "distance">): { floor: number; reason: string | null } {
  const far = Math.max(0, t.distance - 0.5) * 2 * FAR_FLOOR;
  const busy = Math.max(0, 0.5 - t.pace) * 2 * BUSY_FLOOR;
  const floor = round2(Math.min(MAX_FLOOR, far + busy));
  if (floor <= 0) return { floor: 0, reason: null };
  const why = far > 0 && busy > 0 ? "멀리, 알차게 다니면" : far > 0 ? "멀리 다니면" : "알차게 다니면";
  return { floor, reason: `${why} 교통비·입장료가 들어서 더 아끼긴 어려워요` };
}

/** 한 축을 움직인 뒤 나머지를 묶음에 맞춘다. '아껴서'는 하한 밑으로 내려가지 않는다 */
export function moveTrade(t: Tradeoff, key: TradeKey, value: number): Tradeoff {
  const next = { ...t, [key]: Math.max(0, Math.min(1, value)) };
  return { ...next, spend: Math.max(next.spend, spendFloor(next).floor) };
}

/**
 * 서버·엔진 값으로. 엔진의 pace는 1이 빡빡함(하루 4곳)이라 화면의 '알차게'(0)와 방향이 반대다.
 * distance·spend는 방향이 같다 (backend/engine/inputs.ts). 되돌리기는 room-state.ts의 extrasFrom.
 */
export function toServerTradeoffs(t: Tradeoff): Tradeoff {
  const m = moveTrade(t, "spend", t.spend);
  return { pace: round2(1 - m.pace), distance: round2(m.distance), spend: round2(m.spend) };
}
