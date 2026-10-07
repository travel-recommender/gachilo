import { travel } from "./consensus.ts";
import { allPlaces } from "./places.ts";
import type { DayPlan, Place, ScheduleItem, Selection } from "./types.ts";

const DAY_START = 9 * 60;
const DAY_END = 21 * 60;
const LUNCH: [number, number] = [11 * 60 + 30, 13 * 60 + 30];
const DINNER: [number, number] = [17 * 60 + 30, 19 * 60 + 30];

export const fmtTime = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** 지역으로 1차 묶고, 남으면 가장 적게 찬 날에 채운다 */
function clusterByDay(sels: Selection[], days: number): Selection[][] {
  const groups = new Map<string, Selection[]>();
  sels.forEach((s) => {
    const list = groups.get(s.place.area) ?? [];
    list.push(s);
    groups.set(s.place.area, list);
  });

  const ordered = [...groups.values()].sort((a, b) => b.length - a.length);
  const buckets: Selection[][] = Array.from({ length: days }, () => []);
  const maxPerDay = Math.ceil(sels.length / days) + 1;

  ordered.forEach((group) => {
    group.forEach((sel) => {
      let target = buckets.findIndex(
        (b) => b.some((x) => x.place.area === sel.place.area) && b.length < maxPerDay
      );
      if (target < 0) {
        target = buckets.reduce((min, b, i) => (b.length < buckets[min].length ? i : min), 0);
      }
      buckets[target].push(sel);
    });
  });

  return buckets;
}

const inWindow = (t: number, w: [number, number]) => t >= w[0] && t <= w[1];
const isMeal = (p: Place) => p.category === "food";

/** 영업시간 안으로 들어오는 시작 시각. 못 넣으면 null */
function fitOpening(place: Place, arrive: number): number | null {
  const start = Math.max(arrive, place.openFrom);
  if (start + place.stayMin > place.openTo) return null;
  if (start + place.stayMin > DAY_END) return null;
  return start;
}

/** 빈 식사 시간을 채울 가까운 식당·카페를 고른다 */
function pickFiller(
  from: Place | null,
  clock: number,
  used: Set<string>,
  vetoed: Set<string>,
  wantCafe = false
): Place | null {
  const cands = allPlaces().filter(
    (p) =>
      !used.has(p.id) &&
      !vetoed.has(p.id) &&
      (wantCafe ? p.category === "cafe" : p.category === "food") &&
      fitOpening(p, clock) !== null
  );
  if (cands.length === 0) return null;
  if (!from) return cands[0];
  return cands.reduce((best, p) => (travel(from, p).km < travel(from, best).km ? p : best), cands[0]);
}

export interface ScheduleOptions {
  /** 짐 무게를 고려해 쇼핑을 하루 뒤쪽으로 미룰 것인가 */
  considerBags?: boolean;
  /** 빈 식사 시간을 자동으로 채울 것인가 */
  fillMeals?: boolean;
  vetoed?: Set<string>;
  /**
   * 일차별 숙소. 그날 숙소가 있으면 하루가 숙소에서 시작해 숙소로 끝난다.
   * 숙소 자체는 일정 항목으로 넣지 않고, 이동 거리·시간에만 반영한다.
   */
  staysByDay?: (Place | null)[];
  /** 이동 거리에 매기는 벌점 배수 (inputs.ts의 distanceWeightFor) */
  distanceWeight?: number;
}

/**
 * 하루 일정을 시간 순으로 쌓는다.
 * 매 시점에 남은 후보 중 (거리 + 식사 시간대 적합도 + 짐)을 함께 보고 다음 장소를 고른다.
 */
function buildDay(
  sels: Selection[],
  opts: ScheduleOptions,
  globalUsed: Set<string>,
  stay: Place | null = null
): { items: ScheduleItem[]; dropped: Selection[] } {
  const remaining = [...sels];
  const items: ScheduleItem[] = [];
  const dropped: Selection[] = [];
  const used = globalUsed;
  const vetoed = opts.vetoed ?? new Set<string>();

  let clock = DAY_START;
  // 숙소가 있으면 하루의 출발점이 숙소다. 첫 장소까지의 이동이 그만큼 더해진다.
  let prev: Place | null = stay;
  let load = 0;
  let mealsDone = { lunch: false, dinner: false };

  const place = (p: Place, tier: ScheduleItem["tier"], participants: string[]) => {
    const move = prev ? travel(prev, p) : { km: 0, min: 0, walkKm: 0, mode: "walk" as const };
    const start = fitOpening(p, clock + move.min);
    if (start === null) return false;
    items.push({
      place: p,
      tier,
      startMin: start,
      endMin: start + p.stayMin,
      moveMin: move.min,
      moveKm: move.km,
      participants,
    });
    clock = start + p.stayMin;
    prev = p;
    used.add(p.id);
    load += p.bagLoad;
    if (isMeal(p) && inWindow(start, LUNCH)) mealsDone.lunch = true;
    if (isMeal(p) && inWindow(start, DINNER)) mealsDone.dinner = true;
    return true;
  };

  while (remaining.length) {
    const nearLunch = inWindow(clock, [LUNCH[0] - 45, LUNCH[1]]) && !mealsDone.lunch;
    const nearDinner = inWindow(clock, [DINNER[0] - 45, DINNER[1]]) && !mealsDone.dinner;
    const mealTime = nearLunch || nearDinner;

    // 식사 시간이면 남은 후보 중 식당을 우선 고른다
    let pool = remaining;
    if (mealTime) {
      const meals = remaining.filter((s) => isMeal(s.place));
      if (meals.length) pool = meals;
      else if (opts.fillMeals) {
        const filler = pickFiller(prev, clock, used, vetoed);
        if (filler && place(filler, "filled", [])) continue;
      }
    }

    // 거리 + 짐 부담으로 다음 장소를 고른다
    const scored = pool.map((s) => {
      const d = prev ? travel(prev, s.place).km : 0;
      const bagPenalty = opts.considerBags ? s.place.bagLoad * 2.5 * (1 - load) : 0;
      return { sel: s, cost: d * (opts.distanceWeight ?? 1) + bagPenalty };
    });
    scored.sort((a, b) => a.cost - b.cost);

    const chosen = scored[0].sel;
    remaining.splice(remaining.indexOf(chosen), 1);
    if (!place(chosen.place, chosen.tier, chosen.participants)) {
      dropped.push({ ...chosen, excluded: "time" });
    }
  }

  // 남은 식사 시간 채우기
  if (opts.fillMeals) {
    // 마지막 일정이 너무 일찍 끝났으면 저녁까지 억지로 끌지 않는다
    if (!mealsDone.dinner && clock < DINNER[1] && DINNER[0] - clock <= 150) {
      const c = Math.max(clock, DINNER[0]);
      const f = pickFiller(prev, c, used, vetoed);
      if (f) {
        clock = c;
        place(f, "filled", []);
      }
    }
  }

  return { items: items.sort((a, b) => a.startMin - b.startMin), dropped };
}

export function buildSchedule(
  selections: Selection[],
  days: number,
  opts: ScheduleOptions = {}
): { plans: DayPlan[]; dropped: Selection[] } {
  const buckets = clusterByDay(selections, days);
  const plans: DayPlan[] = [];
  const dropped: Selection[] = [];

  const globalUsed = new Set<string>(selections.map((s) => s.place.id));
  buckets.forEach((bucket, i) => {
    const stay = opts.staysByDay?.[i] ?? null;
    const { items, dropped: d } = buildDay(bucket, opts, globalUsed, stay);
    dropped.push(...d);

    let walkKm = 0;
    let totalKm = 0;
    let move = 0;
    let cost = 0;
    // 숙소에서 출발하므로 첫 장소까지의 이동도 하루 합계에 들어간다
    let prev: Place | null = stay;
    let stayOutKm: number | undefined;
    let stayBackKm: number | undefined;
    if (stay && items.length) stayOutKm = Math.round(travel(stay, items[0].place).km * 10) / 10;
    items.forEach((it) => {
      if (prev) {
        const m = travel(prev, it.place);
        walkKm += m.walkKm;
        totalKm += m.km;
        move += m.min;
      }
      cost += it.place.cost;
      prev = it.place;
    });

    // 마지막 장소에서 숙소로 돌아가는 길
    if (stay && items.length) {
      const back = travel(items[items.length - 1].place, stay);
      walkKm += back.walkKm;
      totalKm += back.km;
      move += back.min;
      stayBackKm = Math.round(back.km * 10) / 10;
    }

    plans.push({
      day: i + 1,
      items,
      walkKm: Math.round(walkKm * 10) / 10,
      totalKm: Math.round(totalKm * 10) / 10,
      totalMoveMin: move,
      cost,
      ...(stay ? { stayName: stay.name, stayOutKm, stayBackKm } : {}),
    });
  });

  return { plans, dropped };
}
