import { distKm, travel } from "./consensus.ts";
import { DETOUR, travelBurdenTotals } from "./routing.ts";
import {bagIncrement, bagExtraCost, withConditionDay} from "./conditions.ts";
import { allPlaces } from "./places.ts";
import type { DayPlan, Place, ScheduleItem, Selection } from "./types.ts";

const DAY_START = 9 * 60;
const DAY_END = 21 * 60;
/** 아침은 하루 첫 일정(9시), 점심은 12시, 저녁은 18시에 맞춘다. 창은 '이 시각에 시작하면 그 끼니'로 본다 */
const BREAKFAST_AT = DAY_START;
const LUNCH: [number, number] = [12 * 60, 13 * 60 + 30];
const DINNER: [number, number] = [18 * 60, 19 * 60 + 30];
/** 끼니 시각 이만큼 전부터 식당을 고르기 시작한다 (그 사이는 기다린다) */
const MEAL_LEAD = 45;
/** 술집은 21시 이후, 자정까지만 */
const BAR_FROM = 21 * 60;
const NIGHT_END = 24 * 60;

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
/** 술집은 따로 카테고리가 없어 이름으로 알아본다 */
export const isBar = (p: Place) => /이자카야|술집|와인바|칵테일|izakaya|\bbar\b|\bpub\b/i.test(p.name);
export const isMeal = (p: Place) => p.category === "food" && !isBar(p) && (!p.mealRole || p.mealRole === "meal");

/** 영업시간 안으로 들어오는 시작 시각. 못 넣으면 null. 술집만 자정까지 둔다 */
function fitOpening(place: Place, arrive: number): number | null {
  const windows = place.openingWindows ?? [[place.openFrom, place.openTo, place.lastEntry ?? place.openTo]];
  for (const [open, close, lastEntry] of windows) {
    const start = Math.max(arrive, open);
    if (start <= lastEntry && start + place.stayMin <= close
        && start + place.stayMin <= (isBar(place) ? NIGHT_END : DAY_END)) return start;
  }
  return null;
}

/** 빈 식사 시간을 채울 가까운 식당·카페를 고른다 */
function pickFiller(
  from: Place | null,
  clock: number,
  used: Set<string>,
  vetoed: Set<string>,
  wantCafe = false,
  /** 늦게 열어 이 시각에 바로 시작할 수 없는 곳은 뺀다 (아침 식사) */
  onTime = false,
  maxCost = Infinity
): Place | null {
  const cands = allPlaces().filter(
    (p) =>
      !used.has(p.id) &&
      !vetoed.has(p.id) &&
      p.cost <= maxCost &&
      (wantCafe ? p.category === "cafe" : isMeal(p)) &&
      (onTime ? fitOpening(p, clock) === clock : fitOpening(p, clock) !== null)
  );
  if (cands.length === 0) return null;
  if (!from) return cands[0];
  // Compare geographic proximity uniformly; travel().km mixes walking routes and transit estimates.
  return cands.reduce((best, p) => (distKm(from, p) < distKm(from, best) ? p : best), cands[0]);
}

export interface ScheduleOptions {
  /** 짐 무게를 고려해 쇼핑을 하루 뒤쪽으로 미룰 것인가 */
  considerBags?: boolean;
  /** 빈 식사 시간을 자동으로 채울 것인가 */
  fillMeals?: boolean;
  /** 1인 여행 전체 예산(원). 자동 추가 식사는 선택 장소 비용을 뺀 나머지 안에서만 고른다 */
  budget?: number;
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
 * 끼니는 아침 9시·점심 12시·저녁 18시에 맞추고, 식당은 되도록 끼니 시각에만 넣는다.
 * 술집은 다른 곳을 다 넣은 뒤 21시 이후에 넣는다.
 */
function buildDay(
  sels: Selection[],
  opts: ScheduleOptions,
  globalUsed: Set<string>,
  stay: Place | null = null,
  mealBudget = Infinity
): { items: ScheduleItem[]; dropped: Selection[]; mealSpent: number } {
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
  let mealSpent = 0;

  /** notBefore: 끼니·술집처럼 그 시각까지 기다렸다 시작하는 곳 */
  const place = (p: Place, tier: ScheduleItem["tier"], participants: string[], notBefore = 0) => {
    const move = prev ? travel(prev, p) : { km: 0, min: 0, walkKm: 0, mode: "walk" as const };
    const start = fitOpening(p, Math.max(clock + move.min, notBefore));
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
    load += bagIncrement(p.bagLoad);
    if (tier === "filled") mealSpent += p.cost;
    if (isMeal(p) && inWindow(start, LUNCH)) mealsDone.lunch = true;
    if (isMeal(p) && inWindow(start, DINNER)) mealsDone.dinner = true;
    return true;
  };

  // 아침 — 9시에 바로 여는 가까운 식당·카페를 채운다
  if (opts.fillMeals) {
    const b = pickFiller(prev, BREAKFAST_AT, used, vetoed, false, true, mealBudget)
      ?? pickFiller(prev, BREAKFAST_AT, used, vetoed, true, true, mealBudget);
    if (b) place(b, "filled", [], BREAKFAST_AT);
  }

  // 술집은 맨 뒤로 미룬다
  const bars = remaining.filter((s) => isBar(s.place));
  bars.forEach((s) => remaining.splice(remaining.indexOf(s), 1));

  while (remaining.length) {
    const nearLunch = inWindow(clock, [LUNCH[0] - MEAL_LEAD, LUNCH[1]]) && !mealsDone.lunch;
    const nearDinner = inWindow(clock, [DINNER[0] - MEAL_LEAD, DINNER[1]]) && !mealsDone.dinner;
    const mealTime = nearLunch || nearDinner;
    const mealAt = nearLunch ? LUNCH[0] : nearDinner ? DINNER[0] : 0;

    // 식사 시간이면 남은 후보 중 식당을 우선 고르고, 아니면 식당은 끼니 때로 미룬다
    let pool = remaining;
    let notBefore = 0;
    const meals = remaining.filter((s) => isMeal(s.place));
    if (mealTime) {
      if (meals.length) { pool = meals; notBefore = mealAt; }
      else if (opts.fillMeals) {
        const filler = pickFiller(prev, Math.max(clock, mealAt), used, vetoed, false, false, mealBudget - mealSpent);
        if (filler && place(filler, "filled", [], mealAt)) continue;
      }
    } else if (meals.length < remaining.length) {
      // 다음 끼니 시각 + MEAL_LEAD 안에 끝나는 곳을 먼저 고른다. 오래 머무는 곳이 끼니를 밀어내지 않게
      const others = remaining.filter((s) => !isMeal(s.place));
      const nextMeal = !mealsDone.lunch && clock < LUNCH[0] ? LUNCH[0] : !mealsDone.dinner && clock < DINNER[0] ? DINNER[0] : 0;
      const fits = others.filter((s) =>
        !nextMeal || clock + (prev ? travel(prev, s.place).min : 0) + s.place.stayMin <= nextMeal + MEAL_LEAD);
      if (fits.length) pool = fits;
      else if (meals.length) {
        // 끼니 전에 끝낼 곳이 없으면 먼저 먹고 간다
        pool = meals;
        notBefore = nextMeal;
      } else pool = others;
    } else {
      // 식당만 남았으면 다음 끼니 시각까지 기다린다
      notBefore = !mealsDone.lunch && clock < LUNCH[0] ? LUNCH[0] : !mealsDone.dinner && clock < DINNER[0] ? DINNER[0] : 0;
    }

    // 이번 끼니를 넘기면 문을 닫는 식당은 이번 끼니에 먼저 넣는다. 그중에서도 '꼭 가기'가 먼저다
    const later = notBefore === LUNCH[0] ? DINNER[0] : notBefore === DINNER[0] ? DINNER[1] : 0;
    const urgency = (s: Selection) =>
      later && isMeal(s.place) && fitOpening(s.place, later) === null ? (s.mustOf ? 2 : 1) : 0;

    // 거리 + 짐 부담으로 다음 장소를 고른다
    const scored = pool.map((s) => {
      // Keep the original distance/packing score scale without mixing routing sources.
      const d = prev ? distKm(prev, s.place) * DETOUR : 0;
      // Carry accumulated bags on this leg. Buying now also adds burden to the
      // next leg: use the mean remaining walking distance as a bounded lookahead.
      // The old (1-load) term became negative and rewarded shopping after load>1.
      const onward = remaining.filter(other => other !== s).map(other => travel(s.place,other.place).walkKm);
      if (!onward.length && stay) onward.push(travel(s.place,stay).walkKm);
      const nextWalk = onward.length ? onward.reduce((a,b)=>a+b,0)/onward.length : 0;
      const incoming = prev ? travel(prev,s.place) : null;
      const incomingWalk = incoming?.walkKm ?? 0;
      const bagPenalty = opts.considerBags
        ? bagExtraCost(incomingWalk,load) + bagExtraCost(nextWalk,bagIncrement(s.place.bagLoad)) : 0;
      return { sel: s, cost: d * (opts.distanceWeight ?? 1) + bagPenalty };
    });
    scored.sort((a, b) => urgency(b.sel) - urgency(a.sel) || a.cost - b.cost);

    const chosen = scored[0].sel;
    remaining.splice(remaining.indexOf(chosen), 1);
    // 끼니 시각에 못 넣으면 지금 바로 넣어 본 뒤에야 탈락시킨다
    if (!place(chosen.place, chosen.tier, chosen.participants, notBefore)
      && !(notBefore && place(chosen.place, chosen.tier, chosen.participants))) {
      dropped.push({ ...chosen, excluded: "time" });
    }
  }

  // 남은 식사 시간 채우기
  if (opts.fillMeals) {
    // 마지막 일정이 너무 일찍 끝났으면 저녁까지 억지로 끌지 않는다
    if (!mealsDone.dinner && clock < DINNER[1] && DINNER[0] - clock <= 150) {
      const c = Math.max(clock, DINNER[0]);
      const f = pickFiller(prev, c, used, vetoed, false, false, mealBudget - mealSpent);
      if (f) place(f, "filled", [], c);
    }
  }

  // 술집 — 21시 이후
  bars.forEach((s) => {
    if (!place(s.place, s.tier, s.participants, BAR_FROM)) dropped.push({ ...s, excluded: "time" });
  });

  return { items: items.sort((a, b) => a.startMin - b.startMin), dropped, mealSpent };
}

function buildSchedulePrepared(
  selections: Selection[],
  days: number,
  opts: ScheduleOptions = {}
): { plans: DayPlan[]; dropped: Selection[] } {
  const buckets = clusterByDay(selections, days);
  const plans: DayPlan[] = [];
  const dropped: Selection[] = [];

  const globalUsed = new Set<string>(selections.map((s) => s.place.id));
  // 자동 식사에 쓸 수 있는 돈 — 선택 장소 비용을 먼저 빼고, 남은 날수로 나눠 앞날이 다 쓰지 않게 한다
  let mealWallet = (opts.budget ?? Infinity) - selections.reduce((sum, s) => sum + s.place.cost, 0);
  buckets.forEach((bucket, i) => withConditionDay(i, () => {
    const stay = opts.staysByDay?.[i] ?? null;
    const { items, dropped: d, mealSpent } = buildDay(bucket, opts, globalUsed, stay,
      Math.max(0, mealWallet / (days - i)));
    mealWallet -= mealSpent;
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
      walkKmRaw: walkKm,
      totalKm: Math.round(totalKm * 10) / 10,
      totalMoveMin: move,
      cost,
      ...(stay ? { stayName: stay.name, stayOutKm, stayBackKm } : {}),
    });
  }));

  return { plans, dropped };
}

/** Compare the two feasible visit orders when they keep exactly the same daily
 * places. A local greedy bag preference must not increase its own trip cost.
 * This is a baseline guard, not a global route optimizer or a new hard limit.
 */
export function buildSchedule(selections:Selection[], days:number, opts:ScheduleOptions={}) {
  const weighted=buildSchedulePrepared(selections,days,opts);
  if(!opts.considerBags) return weighted;
  const baseline=buildSchedulePrepared(selections,days,{...opts,considerBags:false});
  const sameVisits=weighted.plans.every((p,i)=>
    p.items.map(x=>x.place.id).sort().join('\0')===baseline.plans[i].items.map(x=>x.place.id).sort().join('\0'));
  const score=(result:typeof weighted)=>result.plans.reduce((sum,p,i)=>sum+withConditionDay(i,()=>{
    const stay=opts.staysByDay?.[i];
    return travelBurdenTotals([...(stay?[stay]:[]),...p.items.map(x=>x.place),...(stay?[stay]:[])]).carryingCost;
  }),0);
  return sameVisits && score(baseline)<score(weighted) ? baseline : weighted;
}
