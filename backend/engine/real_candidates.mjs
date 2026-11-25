import {withTripConditions, withShelterPreference, hasShelterWeather} from './conditions.ts';
/** Real catalogue → the same shared-candidate contract as the demo, without inventing data. */
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {loadRuntimeInputs, availability, toEnginePlace, validateDay} from '../../scripts/validate_real_schedule.mjs';
import {buildConsensus} from './consensus.ts';
import {distanceWeightFor, groupTradeoffs, spendCapFor} from './inputs.ts';
import {withPlaceCatalog} from './places.ts';
import {MEAL_WINDOWS, isMeal} from './schedule.ts';
import {withRouting, conditionSummary, routingSummary} from './routing.ts';
import {defaultLiveCheck} from './live_check.mjs';
import {buildPool, choose, REASON_TEXT} from './real_ai.mjs';

const STRATEGIES = ['average', 'least_misery', 'fairness'];
const LABELS = {average: '평균 만족', least_misery: '최소 불만', fairness: '공정성'};
const roundKm = n => Math.round(n * 100) / 100;

function datesFor(request) {
  const dates = [];
  for (let t = Date.parse(request.startDate + 'T00:00:00Z'); t <= Date.parse(request.endDate + 'T00:00:00Z'); t += 86400000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  if (!dates.length || dates.length > 30 || !request.submissions?.length) throw Error('invalid saved trip');
  return dates;
}

const vetoesOf = request => new Set(request.submissions.flatMap(s => s.vetoes ?? (s.veto ? [s.veto] : [])));
const mustsOf = request => new Set(request.submissions.flatMap(s => s.musts ?? (s.must ? [s.must] : [])));
const limitsFor = request => ({
  budget_krw: spendCapFor(Math.min(...request.submissions.map(s => s.budgetPerDay)), groupTradeoffs(request.submissions).spend),
  step_limit: Math.min(...request.submissions.map(s => s.stepLimit)),
  active_min: Math.min(...request.submissions.map(s => s.activeMin)),
  krw_per_jpy: request.exchange_rate.krw_per_jpy,
});
const passed = (live, id, date) => live.verdicts.get(`${id}|${date}`)?.length === 0;

/** P3 목록에만 있는 그날 후보(listed)를 전략 순위로 줄 세운다.
 * 각자 P3에 담은 곳을 그 사람의 '고른 곳'으로 보고 같은 합의 점수(buildConsensus)를 쓴다.
 * 꼭 가기·1순위는 여기 없다(이미 앞에서 시도). 순위에서 빠진 곳은 원래 순서(여러 명이 담은 곳부터)로 뒤에 붙인다. */
export function rankListed(request, strategy, listed, eligible, picked) {
  const catalogue = eligible.filter(p => listed.includes(p.id));
  if (!catalogue.length) return [];
  const consensus = withPlaceCatalog(catalogue, () => buildConsensus({
    submissions: request.submissions.map(s => ({...s, picks: (s.longlist ?? []).filter(id => !picked.has(id)), must: null, musts: []})),
    nights: 0, strategy, allowPartial: false, slotsPerDay: catalogue.length,
  }));
  const ranked = [...consensus.core, ...consensus.excluded.filter(s => s.excluded === 'time' || s.excluded === 'budget')]
    .map(s => s.place.id).filter(id => listed.includes(id));
  const ids = new Set(catalogue.map(p => p.id));
  return [...new Set([...ranked, ...listed.filter(id => ids.has(id))])];
}

/**
 * 실제 장소 경로의 하루 자리 수 — 활동 시간 안에 들어갈 만큼 정한다.
 * 예전에는 속도만 보고 2~4곳(slotsPerDayFor)이라, 그룹에 '여유'가 한 명만 있어도 하루 2곳에서 끝나
 * 활동 시간을 10~19시로 넣어도 오후 1시쯤 일정이 끝났다(11/16 모의 실험).
 * 한 곳에 드는 시간(체류+이동)을 여유 120분 · 보통 75분 · 빡빡 60분(사이는 직선으로)으로 보고,
 * 그룹의 가장 짧은 활동 시간에 맞춰 하루 2~8곳(paceSlotsFor). 여기에 하루 최소 장소 수(minPlacesFor)를 하한으로 더한다. 3명·10~19시 시뮬레이션에서 여유는 오후 3~4시, 보통은 5시 전후에 끝난다.
 * 실제로 들어가는지는 그날 검사(validateDay: 활동 시간·예산·걷기·영업)가 다시 막는다.
 */
export function paceSlotsFor(pace, activeMin) {
  const t = Math.max(0, Math.min(1, pace));
  const minutesPerPlace = t <= 0.5 ? 120 + (75 - 120) * t * 2 : 75 + (60 - 75) * (t - 0.5) * 2;
  return Math.max(2, Math.min(8, Math.floor(activeMin / minutesPerPlace)));
}
/** 하루 자리 수 = 속도로 정한 수와 하루 최소 장소 수(minPlacesFor) 중 큰 쪽 */
export function realSlotsPerDay(pace, activeMin) {
  return Math.max(paceSlotsFor(pace, activeMin), minPlacesFor(activeMin));
}

/** 이만큼 이상 머무는 곳(USJ·수족관 등)은 '3시간에 2곳' 규칙에서 따로 센다 */
export const LONG_STAY_MIN = 180;
/** 끼니 채우기 후보 식당 수. 실시간 확인이 후보 × 날짜라 묶어 둔다 */
export const MEAL_POOL_SIZE = 10;
/** 못 채운 끼니마다 구성원 장소를 넣을 때 남겨 두는 시간(분) */
const MEAL_RESERVE_MIN = 90;  // 식당 체류는 보통 60–90분
/** 하루 최소 장소 수의 상한. 실제로 들어가는지는 그날 검사(활동 시간·예산·걷기·영업)가 다시 막는다 */
const MIN_PLACES_CAP = 10;
/**
 * 하루 최소 장소 수 — 3시간마다 2곳 (11/25 실험 피드백: 하루 2곳뿐이라 일정이 너무 적었다).
 * 오래 머무는 곳(LONG_STAY_MIN 이상)은 한 곳으로 세고, 그 체류 시간을 뺀 나머지 활동 시간에 규칙을 적용한다.
 * @param longStays 그날 들어간 오래 머무는 곳들의 체류 시간(분)
 */
export function minPlacesFor(activeMin, longStays = []) {
  const rest = Math.max(0, activeMin - longStays.reduce((a, b) => a + b, 0));
  return Math.min(MIN_PLACES_CAP, longStays.length + Math.ceil(rest / 180 * 2));
}

/**
 * 활동 시간에 걸친 끼니 창. 하루는 09:00에 시작한다(validateDay와 같음). 창과 1시간 이상 겹치면 그 끼니를 채운다.
 * 예: 활동 9시간(09–18시) → 아침·점심·저녁, 활동 6시간(09–15시) → 아침·점심.
 */
export const DAY_START_MIN = 9 * 60;
export function mealWindowsFor(activeMin) {
  const end = DAY_START_MIN + activeMin;
  return Object.entries(MEAL_WINDOWS)
    .filter(([, [from, to]]) => Math.min(end, to) - Math.max(DAY_START_MIN, from) >= 60)
    .map(([name, window]) => ({name, window}));
}

/** 원래 고른 곳 하나당 시도할 교체 후보 지점 수. 실시간 확인(Google) 호출 수를 묶어 두기 위한 상한이다 */
export const BRANCH_CANDIDATE_LIMIT = 3;

/**
 * 지점 자동 배치 후보 (docs/branch_auto_placement.md 2장). 실시간 확인·경로 표와 일정 계산이 같은 목록을 쓴다.
 * 고른 곳마다: 같은 branch_group_id의 다른 지점 중 구성원이 직접 담지 않았고, 제외되지 않았고,
 * 누군가 제외한 브랜드가 아니며, 여행일 중 하루라도 운영 조건을 통과하는 지점을 최대 BRANCH_CANDIDATE_LIMIT곳.
 * 순서는 "구성원이 담은 다른 곳 중 가장 가까운 곳까지의 거리"가 짧은 순이다. 교체는 앞뒤 장소와의 이동을 줄이려는 것이라
 * 원래 지점이 아니라 같이 갈 장소들 근처의 지점을 남겨야 한다.
 * @returns {Map<string, string[]>} 고른 곳 → 후보 지점
 */
export function branchCandidates(dataset, profiles, dates, ids, vetoes) {
  const byId = new Map(dataset.places.map(r => [r.place.place_id, r]));
  const human = new Set(ids);
  const vetoedBrands = new Set([...vetoes].map(id => byId.get(id)?.place.brand_id).filter(Boolean));
  const members = new Map();
  for (const r of dataset.places) {
    const g = r.place.branch_group_id;
    if (g) members.set(g, [...(members.get(g) ?? []), r]);
  }
  const km = (a, b) => Math.hypot(a.latitude - b.latitude, (a.longitude - b.longitude) * Math.cos(a.latitude * Math.PI / 180));
  const out = new Map();
  for (const id of human) {
    const p = byId.get(id)?.place;
    if (!p?.branch_group_id || vetoes.has(id) || vetoedBrands.has(p.brand_id)) continue;
    // 같이 갈 다른 장소들(다른 교체 그룹). 없으면 원래 지점과의 거리로 줄 세운다
    // 다른 날 갈 장소도 섞여 있다(날짜 배정 전에 정하므로). 제외한 곳은 뺀다 (#74 재리뷰)
    const others = [...human].filter(x => !vetoes.has(x)).map(x => byId.get(x)?.place)
      .filter(o => o && o.branch_group_id !== p.branch_group_id);
    const score = r => others.length ? Math.min(...others.map(o => km(r.place, o))) : km(p, r.place);
    const list = members.get(p.branch_group_id)
      .filter(r => r.place.place_id !== id && !human.has(r.place.place_id) && !vetoes.has(r.place.place_id)
        && dates.some(date => availability(r, date, profiles, {allowShopping: true}).eligible_for_model))
      .sort((a, b) => score(a) - score(b) || a.place.place_id.localeCompare(b.place.place_id))
      .slice(0, BRANCH_CANDIDATE_LIMIT).map(r => r.place.place_id);
    if (list.length) out.set(id, list);
  }
  return out;
}

/** Call the existing strategy implementation separately for each date/strategy.
 * Only picked, date-eligible real places enter its registry, so neither consensus nor scheduling
 * can introduce a demo place or an unreviewed filler. Missing popularity is left missing.
 * listed: places someone put in their step-1 list (P3) without marking 꼭 가기. They are tried
 * after the picks to fill empty slots.
 * live: every place-date must pass the live check (live_check.mjs) before it can be placed.
 * ai: places nobody listed (real_ai.mjs), tried last and only for slots the members' places left empty.
 */
function calculatePrepared(request, dataset, profiles, dates, picked, listed = [], live, ai = null, mealPool = []) {
  // mealPool이 null이면 끼니 채우기를 끈다 (deps.mealFill === false)
  const byId = new Map(dataset.places.map(r => [r.place.place_id, r]));
  const vetoes = vetoesOf(request), musts = mustsOf(request);
  // 각 참여자의 1순위 꼭 가기(거부된 곳은 건너뛰고 다음 순위가 이어받음). inputs.ts의 mustRounds와 같은 규칙이다.
  // pace 자리 수가 이것을 잘라내지 않는다. 운영·예산·걷기·활동시간 검사는 그대로 적용한다.
  const firstMusts = new Set(request.submissions
    .map(s => (s.musts ?? (s.must ? [s.must] : [])).find(id => !vetoes.has(id)))
    .filter(Boolean));
  const tradeoffs = groupTradeoffs(request.submissions);
  const limits = limitsFor(request);
  // 활동 시간과 속도로 정한 하루 자리 수(realSlotsPerDay). 합의 단계가 아니라 검증을 통과한 장소 수에 적용한다.
  const slots = realSlotsPerDay(tradeoffs.pace, limits.active_min);
  const validationOptions = {allowShopping: true, candidateMetrics: true, distanceWeight: distanceWeightFor(tradeoffs.distance)};
  const eligibleOn = (ids, date) => ids.filter(id => !vetoes.has(id)).flatMap(id => {
    const record = byId.get(id);
    const check = record && availability(record, date, profiles, {allowShopping: true});
    if (!check?.eligible_for_model || !passed(live, id, date)) return [];
    return [toEnginePlace(record, check, limits.krw_per_jpy)];
  });
  const eligibleByDate = dates.map(date => eligibleOn([...picked, ...listed], date));
  // 지점 자동 배치 (docs/branch_auto_placement.md). 같은 교체 그룹(branch_group_id)의 다른 지점만 후보다.
  // 누군가 제외한 브랜드로는 바꾸지 않는다. 구성원이 직접 담은 곳은 그 자체로 배치되므로 교체 후보로 쓰지 않는다.
  const human = new Set([...picked, ...listed]);
  const branches = branchCandidates(dataset, profiles, dates, [...picked, ...listed], vetoes);
  const siblingsOf = id => branches.get(id) ?? [];
  const siblingIds = [...new Set([...branches.values()].flat())];
  const siblingEligibleByDate = dates.map(date => new Set(eligibleOn(siblingIds, date).map(p => p.id)));
  const aiPicks = ai ? [...ai.picks, ...(ai.backup ?? [])] : [];
  const aiById = new Map(aiPicks.map((p, i) => [p.id, {...p, source: i < ai.picks.length ? ai.source : 'rule_added'}]));
  const aiEligibleByDate = dates.map(date => new Set(eligibleOn(aiPicks.map(p => p.id), date).map(p => p.id)));
  // 끼니 채우기 후보: 아무도 담지 않은 식당(실시간 확인을 통과한 곳만). 구성원이 담은 식당을 먼저 시도한다
  const mealEligibleByDate = dates.map(date => eligibleOn(mealPool ?? [], date).filter(isMeal));
  // 그 끼니 창 안에 들어가 식사할 수 있게 여는 곳 (창이 끝나기 30분 전까지 열고, 창이 시작하고 1시간 뒤까지 영업)
  const servesIn = (p, [from, to]) => (p.openingWindows ?? [[p.openFrom, p.openTo, p.lastEntry]])
    .some(([open, close, last]) => open <= to - 30 && close >= from + 60 && (last ?? close) >= from);
  const meals = mealPool ? mealWindowsFor(limits.active_min) : [];
  // 아침 끼니를 채우는 날은 고른 식당 중 아침에 열린 곳을 첫 일정으로 둔다
  if (meals.some(m => m.name === 'breakfast')) validationOptions.breakfast = true;
  // 활동이 일찍 끝나는 날은 점심·저녁 목표 시각을 끼니 창 안에서 당긴다 (예: 09–18시 → 저녁 17:00)
  if (meals.length) {
    const end = DAY_START_MIN + limits.active_min;
    const at = (preferred, [from]) => Math.max(from, Math.min(preferred, end - 90));  // 식당 체류는 보통 90분
    validationOptions.mealAt = {lunch: at(12 * 60, MEAL_WINDOWS.lunch), dinner: at(18 * 60, MEAL_WINDOWS.dinner)};
  }
  const mealPlace = id => {
    const record = byId.get(id);
    return !!record && isMeal({category: record.place.category === '식사' ? 'food' : '', name: record.place.name_ko, mealRole: record.review.meal_role});
  };
  const mealMet = (t, window) => (t?.items ?? []).some(item => mealPlace(item.place_id)
    && item.start_min >= window[0] && item.start_min < window[1]);
  const longStays = t => (t?.items ?? []).filter(item => item.stay_min >= LONG_STAY_MIN).map(item => item.stay_min);
  // early: 원래 지점이 남은 날에 영업하더라도 휴무인 날 바로 다른 지점을 시도할 고른 곳들.
  // 먼저 early 없이(원래 지점을 기다림) 짜고, 그 결과 고른 곳이 빠지면 early로 한 번 더 짜서 더 많이 반영되는 쪽을 쓴다 (#74 재리뷰)
  const plan = (strategy, early) => {
    const scheduled = new Set();
    // 배치된 다른 지점 → {fromPlaceId: 원래 고른 곳, reasonCode, savedMin}
    const branchOf = new Map();
    // 빈 끼니 시간에 규칙으로 넣은 식당
    const mealFilled = new Set();
    const placedNow = (id, accepted) => scheduled.has(id) || accepted.includes(id);
    // 같은 교체 그룹(branch_group_id)은 같은 곳으로 본다. 그룹의 어느 지점이든 이미 들어갔으면 반영된 것이고
    // 다시 넣지 않는다 — 두 사람이 같은 가게의 다른 지점을 골라도 한 번만 방문한다
    const groupOf = id => byId.get(id)?.place.branch_group_id ?? null;
    const covered = (id, accepted = []) => placedNow(id, accepted)
      || [...branchOf].some(([placed, b]) => b.fromPlaceId === id && placedNow(placed, accepted))
      || (!!groupOf(id) && [...scheduled, ...accepted].some(x => x !== id && groupOf(x) === groupOf(id)));
    let estimatedCost = false;
    const days = dates.map((date, index) => {
      // 다른 지점으로 이미 반영된 곳(covered)은 다시 넣지 않는다 — 같은 가게를 두 번 방문하지 않게
      const catalogue = eligibleByDate[index].filter(p => !covered(p.id) && picked.has(p.id));
      // 남은 날짜에 고르게 나눈다. 첫날에 자리 수만큼 몰아 넣으면 장소가 적을 때 뒷날이 빈다.
      const remaining = new Set(eligibleByDate.slice(index).flat().map(p => p.id).filter(id => !covered(id)));
      const share = Math.min(slots, Math.max(1, Math.ceil(remaining.size / (dates.length - index))));
      // 전략에게 그날 후보 전체의 순서를 받는다. 자리 수(slotsPerDay)를 후보 수만큼 열어 두어
      // 앞 순위가 시간·예산 검사에서 떨어져도 다음 순위로 빈자리를 채울 수 있게 한다.
      const consensus = withPlaceCatalog(catalogue, () => buildConsensus({
        submissions: request.submissions, nights: 0, strategy, allowPartial: false,
        slotsPerDay: Math.max(1, catalogue.length),
      }));
      const ranked = [...consensus.core, ...consensus.excluded.filter(s => s.excluded === 'time' || s.excluded === 'budget')]
        .map(s => s.place.id);
      // 꼭 가기는 전략과 무관하게 먼저 시도한다. 검사(운영·예산·걷기·활동시간)는 우회하지 않는다.
      // P3 목록에만 있는 곳은 꼭 가기 뒤에, 같은 전략의 순위로 시도한다(누가 P3에 담았는지가 그 사람의 선호).
      // 꼭 가기가 모두 들어가는 작은 그룹에서도 세 후보가 달라질 여지가 여기서 생긴다 (이슈 #6 피드백 11/16).
      const fillers = rankListed(request, strategy, listed.filter(id => !covered(id)), eligibleByDate[index], picked);
      // 고른 곳이 오늘 운영 조건에 맞지 않고 남은 날에도 영업하지 않으면, 오늘 영업하는 같은 교체 그룹의 다른 지점을 대신 시도한다.
      // 남은 날에 영업하면 원래 지점을 기다린다. 기다렸는데 결국 못 넣으면 plan()을 early로 다시 돌려 휴무인 날 바로 대체한다.
      const eligibleToday = id => eligibleByDate[index].some(p => p.id === id);
      const eligibleLater = id => eligibleByDate.slice(index + 1).some(ps => ps.some(p => p.id === id));
      const substitute = new Map();  // 대신 넣을 지점 → 원래 고른 곳
      const substituteFor = ids => ids.flatMap(id => {
        if (vetoes.has(id) || covered(id) || eligibleToday(id) || (!early.has(id) && eligibleLater(id))) return [];
        const sib = siblingsOf(id).find(x => siblingEligibleByDate[index].has(x) && !scheduled.has(x) && !substitute.has(x));
        if (!sib) return [];
        substitute.set(sib, id);
        return [sib];
      });
      const mustSubs = substituteFor([...musts]);
      const pickSubs = substituteFor([...picked].filter(id => !musts.has(id)));
      const listedSubs = substituteFor(listed);
      const queue = [...ranked.filter(id => musts.has(id)), ...mustSubs, ...ranked.filter(id => !musts.has(id)), ...pickSubs, ...fillers, ...listedSubs];
      let accepted = [], trial = null;
      // reserve: 아직 못 채운 끼니마다 식사 시간(MEAL_RESERVE_MIN)을 활동 시간에서 남겨 두고 검사한다.
      // 구성원 장소가 하루를 다 채워 식당이 못 들어가는 것을 막는다. 1순위 꼭 가기는 남겨 두지 않는다
      const reserved = () => meals.filter(({window}) => !mealMet(trial, window)).length * MEAL_RESERVE_MIN;
      // 이미 채운 끼니 시간대를 그대로 두는 결과인가
      const keepsMeals = next => meals.every(({window}) => !mealMet(trial, window) || mealMet(next, window));
      const tryAdd = (id, reserve = false) => {
        if (covered(substitute.get(id) ?? id, accepted) || covered(id, accepted)) return;
        const activeMin = reserve ? Math.max(0, limits.active_min - reserved()) : limits.active_min;
        const next = validateDay({...limits, active_min: activeMin, date, place_ids: [...accepted, id]}, dataset, profiles, validationOptions);
        // Must-places do not bypass date, cost, last-entry, walking or active-time checks.
        // 끼니로 채운 시간대를 밀어내는 곳은 받지 않는다
        if (next.passed_model_checks && keepsMeals(next)) {
          trial = next;
          accepted = next.items.map(item => item.place_id);
        }
      };
      // least_misery는 날짜마다 따로 계산하면 어제까지 누가 손해 봤는지 모른다.
      // 그래서 여행 전체(앞 날짜 + 오늘 통과분)에서 찜이 가장 덜 반영된 멤버의 찜을 먼저 시도한다.
      const keptRate = m => m.picks.filter(id => covered(id, accepted) || [...substitute].some(([sub, o]) => o === id && accepted.includes(sub))).length / Math.max(1, m.picks.length);
      // 1) 1순위 꼭 가기는 자리 수와 상관없이 먼저 시도한다 (기존 consensus의 '전원 1순위는 코어' 정책과 같음).
      const isFirst = id => firstMusts.has(id) || firstMusts.has(substitute.get(id));
      for (const id of queue.filter(isFirst)) tryAdd(id);
      queue.splice(0, queue.length, ...queue.filter(id => !isFirst(id)));
      // 2) 나머지는 pace 자리 수와 고르게 나눈 몫(share)까지만 채운다. 이미 채운 끼니를 밀어내는 곳은 받지 않는다.
      const placed = () => accepted.filter(id => !mealFilled.has(id)).length;
      while (queue.length && placed() < share) {
        let i = 0;
        if (strategy === 'least_misery' && !musts.has(substitute.get(queue[0]) ?? queue[0])) {
          const rates = request.submissions.map(keptRate);
          const low = Math.min(...rates);
          const worst = request.submissions.filter((_, k) => rates[k] === low);
          i = Math.max(0, queue.findIndex(id => worst.some(m => m.picks.includes(substitute.get(id) ?? id))));
        }
        tryAdd(queue.splice(i, 1)[0], true);
      }
      // 3) 끼니: 활동 시간에 걸친 아침(8–10시)·점심(11–14시)·저녁(17–20시)마다 식당 하나.
      //    아직 그 시간대에 식당이 없으면 구성원이 담은 식당 → 아무도 담지 않은 식당(가까운 순) 순서로 넣어 본다.
      //    넣은 뒤에도 그 시간대에 식당이 와야 받아들인다. 검사(운영·예산·걷기·활동시간)는 우회하지 않는다.
      const near = id => {
        const p = byId.get(id)?.place;
        const here = accepted.map(x => byId.get(x)?.place).filter(Boolean);
        if (!p || !here.length) return 0;
        return Math.min(...here.map(o => Math.hypot(o.latitude - p.latitude, o.longitude - p.longitude)));
      };
      for (const {window} of meals) {
        if (mealMet(trial, window)) continue;
        const member = eligibleByDate[index].filter(p => isMeal(p) && servesIn(p, window) && !covered(p.id, accepted)).map(p => p.id);
        const ruled = mealEligibleByDate[index].filter(p => servesIn(p, window)).map(p => p.id)
          .filter(id => !scheduled.has(id) && !accepted.includes(id) && !mealFilled.has(id) && !covered(id, accepted))
          .sort((a, b) => near(a) - near(b));
        for (const id of [...member, ...ruled].slice(0, 8)) {
          const next = validateDay({...limits, date, place_ids: [...accepted, id]}, dataset, profiles, validationOptions);
          if (!next.passed_model_checks || !mealMet(next, window) || !keepsMeals(next)) continue;
          trial = next;
          accepted = next.items.map(item => item.place_id);
          if (!human.has(id)) mealFilled.add(id);
          break;
        }
      }
      // 4) 하루 최소 장소 수(3시간마다 2곳, 오래 머무는 곳 제외)와 pace 자리 수 중 큰 쪽까지,
      //    구성원 장소로 다 못 채운 날만 아무도 담지 않은 AI 후보로 남은 자리를 채운다.
      const target = () => Math.max(paceSlotsFor(tradeoffs.pace, limits.active_min), minPlacesFor(limits.active_min, longStays(trial)));
      for (const {id} of aiPicks) {
        if (accepted.length >= target()) break;
        if (!scheduled.has(id) && !accepted.includes(id) && aiEligibleByDate[index].has(id)) tryAdd(id);
      }
      for (const [sub, origin] of substitute) {
        if (accepted.includes(sub)) branchOf.set(sub, {fromPlaceId: origin, reasonCode: 'original_unavailable', savedMin: null});
      }
      // 5) 지점 자동 배치: 배치된 구성원 장소마다 같은 교체 그룹의 다른 지점으로 바꿔 보고,
      //    그날 검사(운영·예산·걷기·활동시간)를 모두 통과하면서 이동 시간이 1분 이상 줄어드는 지점 중 가장 짧은 곳을 고른다.
      //    줄지 않거나 같으면 원래 지점을 유지한다. AI·규칙이 추가한 곳은 바꾸지 않는다.
      const moveMin = t => t.items.reduce((total, item) => total + item.move_min, 0);
      for (const id of [...accepted]) {
        if (!accepted.includes(id) || !(human.has(id) || branchOf.has(id))) continue;
        const origin = branchOf.get(id)?.fromPlaceId ?? id;
        const group = groupOf(origin);
        // 같은 그룹을 다른 구성원도 골랐으면 그 지점도 비교한다. 구성원이 고른 지점이 이동을 1분이라도 줄이면
        // 아무도 고르지 않은 지점보다 먼저 쓰고, branch 표시 없이 그 사람의 선택으로 둔다 (#74 재리뷰)
        const memberBranches = group ? [...human].filter(x => x !== id && x !== origin && groupOf(x) === group
          && !vetoes.has(x) && eligibleByDate[index].some(p => p.id === x)) : [];
        const tryBranch = (list, eligible) => {
          let best = null;
          for (const sib of list) {
            if (sib === id || !eligible(sib) || scheduled.has(sib) || accepted.includes(sib)) continue;
            const next = validateDay({...limits, date, place_ids: accepted.map(x => x === id ? sib : x)}, dataset, profiles, validationOptions);
            if (!next.passed_model_checks || next.items.length !== accepted.length || !keepsMeals(next)) continue;
            if (!best || moveMin(next) < moveMin(best.trial)) best = {sib, trial: next};
          }
          return best && moveMin(best.trial) <= moveMin(trial) - 1 ? best : null;
        };
        const member = tryBranch(memberBranches, () => true);
        const best = member ?? tryBranch(siblingsOf(origin), sib => siblingEligibleByDate[index].has(sib));
        if (best) {
          const saved = moveMin(trial) - moveMin(best.trial);
          const before = branchOf.get(id);
          branchOf.delete(id);
          if (!member) branchOf.set(best.sib, before?.reasonCode === 'original_unavailable' ? before
            : {fromPlaceId: origin, reasonCode: 'shorter_route', savedMin: Math.round(saved)});
          trial = best.trial;
          accepted = trial.items.map(item => item.place_id);
        }
      }
      // 지점 교체 뒤에는 끼니로 넣은 식당이 빠졌을 수 있다
      for (const id of [...mealFilled]) if (!accepted.includes(id) && !scheduled.has(id)) mealFilled.delete(id);
      accepted.forEach(id => scheduled.add(id));
      estimatedCost ||= (trial?.items ?? []).some(item => item.cost_status === "estimate");
      return {date, placeIds: accepted, items: (trial?.items ?? []).map(item => {
        const costNote = (item.cost_status === 'not_applicable_shopping' ? ' 쇼핑 구매액은 비용 합계에서 제외됩니다.' : '')
          + (item.cost_status === 'estimate' ? ' 비용은 공식 자료의 기준 금액을 이용한 추정입니다.' : '');
        const branch = branchOf.get(item.place_id);
        if (branch) return {
          placeId: item.place_id, aiAdded: false, filled: false, source: 'selected',
          reasonCode: picked.has(branch.fromPlaceId) ? 'reviewed_date_and_limits' : 'listed_reviewed_date_and_limits',
          reason: (picked.has(branch.fromPlaceId) ? '선택 장소' : '모두가 찾아온 곳')
            + '와 같은 브랜드의 다른 지점으로, 방문일 운영 조건, 실시간 영업 확인과 일일 한도 검사 통과.' + costNote,
          startMin: item.start_min, endMin: item.end_min, branch,
        };
        if (mealFilled.has(item.place_id)) return {
          placeId: item.place_id, aiAdded: false, filled: true, source: 'meal_fill', reasonCode: 'meal_slot',
          reason: '일정의 빈 끼니 시간(아침 8–10시·점심 11–14시·저녁 17–20시)에 규칙으로 추가한 식당입니다.'
            + ' 방문일 운영 조건, 실시간 영업 확인과 일일 한도 검사 통과.' + costNote,
          startMin: item.start_min, endMin: item.end_min,
        };
        const added = aiById.get(item.place_id);
        if (added && !picked.has(item.place_id) && !listed.includes(item.place_id)) return {
          placeId: item.place_id, aiAdded: true, filled: false, source: added.source, reasonCode: added.reasonCode,
          reason: REASON_TEXT[added.reasonCode] + ' 방문일 운영 조건, 실시간 영업 확인과 일일 한도 검사 통과.' + costNote,
          startMin: item.start_min, endMin: item.end_min,
        };
        return {
          placeId: item.place_id, aiAdded: false, filled: false, source: 'selected',
          reasonCode: picked.has(item.place_id) ? 'reviewed_date_and_limits' : 'listed_reviewed_date_and_limits',
          reason: (picked.has(item.place_id) ? '선택 장소' : '모두가 찾아온 곳')
            + ' 중 방문일 운영 조건, 실시간 영업 확인과 일일 한도 검사 통과.' + costNote,
          startMin: item.start_min, endMin: item.end_min,
        };
      }), metrics: {
        walkSteps: trial?.totals.estimated_steps ?? 0,
        costKrw: trial?.totals.selected_admission_and_menu_krw ?? 0,
        totalKm: roundKm(trial?.totals.estimated_total_km ?? 0),
      }};
    });
    // 끼니로 넣은 식당만 있는 일정은 만들지 않는다 — 구성원·AI 장소가 하나도 못 들어가면 실패다
    if (![...scheduled].some(id => !mealFilled.has(id))) throw Error('NO_SCHEDULABLE_REAL_CANDIDATE');
    const aiAdded = [...scheduled].filter(id => !picked.has(id) && !listed.includes(id) && !branchOf.has(id) && !mealFilled.has(id)).length;
    // 같은 교체 그룹의 다른 지점이 들어갔으면 고른 곳이 반영된 것으로 본다
    const unplaced = [...picked].filter(id => !vetoes.has(id) && !covered(id));
    const omitted = unplaced.length;
    const conflicts = [...musts].filter(id => vetoes.has(id)).length;
    const missingMust = [...musts].some(id => !vetoes.has(id) && !covered(id));
    const emptyDays = days.filter(day => !day.placeIds.length).length;
    // Explain whether each omitted choice could extend the final schedule on any date.
    // Keep only reasons shared across all dates, never private IDs or member conditions.
    const exclusionReasons = {};
    for (const id of unplaced) {
      const attempts = days.map(day => {
        const record = byId.get(id);
        if (!record) return ['unknown_place'];
        const check = availability(record, day.date, profiles, {allowShopping: true});
        if (!check.eligible_for_model) return check.reasons;
        if (!passed(live, id, day.date)) return live.verdicts.get(`${id}|${day.date}`) ?? ['live_lookup_failed'];
        const trial = validateDay({...limits, date: day.date, place_ids: [...day.placeIds, id]}, dataset, profiles, validationOptions);
        return trial.passed_model_checks ? ['strategy_selection_or_capacity'] : [...new Set(trial.violations.map(v => v.code))];
      });
      const common = attempts[0].filter(code => attempts.every(reasons => reasons.includes(code)));
      for (const code of common.length ? common : ['date_conditions_vary']) exclusionReasons[code] = (exclusionReasons[code] ?? 0) + 1;
    }
    const planning = {
      status: omitted || missingMust || conflicts || emptyDays ? 'needs_review' : 'model_checks_passed',
      schedule_ready: false, exchange_rate: request.exchange_rate, catalog_count: dataset.places.length,
      scheduled_count: scheduled.size, unplaced_count: omitted, must_satisfied: !missingMust && !conflicts,
      must_veto_conflict_count: conflicts, empty_day_count: emptyDays,
      reason_aggregation: 'common_across_dates', exclusion_reason_counts: exclusionReasons,
      live_check: {source: live.source, checked_on: live.checked_on, failed_place_count: live.failedPlaces,
        fetched_count: live.fetched, reused_count: live.reused},
      ai_fill: {source: ai ? ai.source : 'off', added_count: aiAdded},
      meal_fill: {windows: meals.map(m => m.name), added_count: mealFilled.size},
    };
    const mean = key => days.reduce((total, day) => total + day.metrics[key], 0) / days.length;
    const routes = days.map(day => day.placeIds.map(id => {
      const r = byId.get(id), p = r.place;
      return {id, lat: p.latitude, lng: p.longitude, bagLoad: p.bag_load/2, buildingId: r.review.building_id ?? r.review.within?.building_id};

    }));
    return {strategy, days, planning, metrics: {
      walkStepsPerDay: Math.round(mean('walkSteps')), costKrwPerDay: Math.round(mean('costKrw')), totalKmPerDay: roundKm(mean('totalKm')),
    }, explanationSource: 'rules', summary: `${LABELS[strategy]} 전략으로 실제 장소 ${scheduled.size}곳을 배치한 초안입니다.`
      + (aiAdded ? ` 그중 ${aiAdded}곳은 아무도 담지 않았지만 그룹의 취향·예산·체력에 맞춰 ${ai.source === 'ai_added' ? 'AI가' : '규칙이'} 추가했습니다.` : '')
      + (omitted ? ` 운영·일일 한도·전략 선택 조건으로 ${omitted}곳은 미배치했습니다.` : '')
      + (conflicts ? ` 꼭 가기와 거부 조건이 충돌한 장소가 ${conflicts}곳 있어 거부 조건을 우선 적용했습니다.` : '')
      + (missingMust ? ' 꼭 가는 장소 조건이 충족되지 않았습니다.' : '')
      + (emptyDays ? ` 일정이 비어 있는 날짜가 ${emptyDays}일입니다.` : '')
      + (estimatedCost ? ' 비용에는 공식 자료 기준 추정이 포함됩니다. 쇼핑·교통·숙박은 제외합니다.'
        : ' 비용은 확인된 입장권·대표 메뉴만 포함하며 쇼핑·교통·숙박은 제외합니다.')
      + ' 걸음 수는 장소 사이 이동만 계산한 추정입니다.'
      + ` 환율: 1엔=${request.exchange_rate.krw_per_jpy}원 (${request.exchange_rate.as_of ?? '기준일 미지정'}).`
      + ` 모든 장소는 ${live.source === 'google_places' ? `Google 지도 영업 정보(${live.checked_on} 조회)` : '실시간 영업 확인'}로 폐업·휴무·영업시간 변경이 없는지 확인한 뒤 넣었습니다.`
      + (live.failedPlaces ? ` 실시간 확인을 통과하지 못한 ${live.failedPlaces}곳은 넣지 않았습니다.` : '')
      + (mealFilled.size ? ` 빈 끼니 시간(아침 8–10시·점심 11–14시·저녁 17–20시)에 식당 ${mealFilled.size}곳을 규칙으로 추가했습니다.` : '')
      + ' AI 설명 문장은 사용하지 않았습니다.' + routingSummary(routes) + conditionSummary(days.map((d,i)=>({date:d.date,points:routes[i]})))};
  };
  const branchable = new Set([...picked].filter(id => siblingsOf(id).length));
  const candidates = STRATEGIES.map(strategy => {
    const attempt = early => {
      try { return plan(strategy, early); } catch (error) {
        if (error.message !== 'NO_SCHEDULABLE_REAL_CANDIDATE' || !branchable.size) throw error;
        return null;
      }
    };
    const waited = attempt(new Set());
    if (waited && (!branchable.size || (waited.planning.must_satisfied && !waited.planning.unplaced_count))) return waited;
    // 다시 짤 때는 기다린 결과에서 실제로 빠진 곳만 휴무일에 대체한다. 기다려서 원래 지점으로 들어간 다른 곳까지
    // 형제 지점으로 바뀌지 않게 (#74 재리뷰 2차)
    const placedIn = c => {
      const items = c.days.flatMap(d => d.items);
      const groups = new Set(items.map(i => byId.get(i.placeId)?.place.branch_group_id).filter(Boolean));
      return id => items.some(i => i.placeId === id || i.branch?.fromPlaceId === id)
        || groups.has(byId.get(id)?.place.branch_group_id);
    };
    const inWaited = waited ? placedIn(waited) : () => false;
    // 여행 내내 운영 조건을 통과하는 곳은 어느 날에도 형제 지점으로 대체되지 않으므로(substituteFor의 eligibleToday) 넘기지 않는다.
    // 예산·시간으로만 빠진 곳 때문에 같은 결과를 한 번 더 계획하지 않게 (#74 재리뷰 3차)
    const closedSomeDay = id => eligibleByDate.some(ps => !ps.some(p => p.id === id));
    const missed = new Set([...branchable].filter(id => !inWaited(id) && closedSomeDay(id)));
    if (waited && !missed.size) return waited;
    const early = attempt(missed);
    if (!early) return waited ?? plan(strategy, new Set());  // 둘 다 못 짜면 원래 오류를 그대로 낸다
    if (!waited) return early;
    const better = (!waited.planning.must_satisfied && early.planning.must_satisfied)
      || (early.planning.must_satisfied === waited.planning.must_satisfied && early.planning.unplaced_count < waited.planning.unplaced_count);
    return better ? early : waited;
  });
  return {candidates};
}

/** Live-check request for every reviewed-eligible place-date of the given IDs. */
function liveRequests(ids, dates, byId, profiles) {
  return ids.flatMap(id => dates.flatMap(date => {
    const record = byId.get(id);
    const check = record && availability(record, date, profiles, {allowShopping: true});
    // 점심·저녁처럼 나뉜 영업은 구간을 그대로 넘긴다. 전체 범위(window)로 대조하면 정상 휴게시간을 변경으로 본다
    return check?.eligible_for_model ? [{record, date, windows: check.windows ?? [check.window]}] : [];
  }));
}

/** deps.liveCheck: (requests) → {verdicts, source, checked_on}; default Google (live_check.mjs).
 * deps.choose: AI chooser (real_ai.mjs); null turns the AI fill off.
 * deps.mealFill: false turns the meal-window fill off (tests of unrelated placement rules).
 */
export async function calculateRealCandidates(request, dataset, profiles, routingOptions = {}, deps = {}) {
  const liveCheck = deps.liveCheck ?? defaultLiveCheck();
  const chooser = deps.choose === undefined ? choose : deps.choose;
  const dates = datesFor(request);
  const picked = new Set(request.submissions.flatMap(s => s.picks));
  // 각자 1차 목록에 담은 곳. 여러 명이 담은 곳부터 (같으면 처음 담긴 순서)
  const votes = new Map();
  request.submissions.forEach(s => (s.longlist ?? []).forEach(id => { if (!picked.has(id)) votes.set(id, (votes.get(id) ?? 0) + 1); }));
  const listed = [...votes.keys()].sort((a, b) => votes.get(b) - votes.get(a));
  const byId = new Map(dataset.places.map(r => [r.place.place_id, r]));
  const vetoes = vetoesOf(request);
  const human = [...picked, ...listed].filter(id => !vetoes.has(id));
  // 지점 자동 배치 후보: 구성원 장소와 같은 교체 그룹의 다른 지점. 실시간 확인과 경로 표에 함께 넣는다
  // calculatePrepared와 같은 함수로 계산한다. 제외 브랜드는 빼고, 고른 곳마다 가까운 후보 최대 BRANCH_CANDIDATE_LIMIT곳만
  const siblings = [...new Set([...branchCandidates(dataset, profiles, dates, [...picked, ...listed], vetoes).values()].flat())];
  // 1) 구성원의 장소부터 실시간 확인한다. 확인 결과로 '꼭 가기인데 못 넣는 곳'을 알아야 비슷한 곳을 찾는다
  const live = await liveCheck(liveRequests([...human, ...siblings], dates, byId, profiles));
  let pool = [];
  if (chooser) {
    const limits = limitsFor(request);
    const usable = id => dates.some(date => passed(live, id, date) && availability(byId.get(id), date, profiles, {allowShopping: true}).eligible_for_model);
    const missedMusts = [...mustsOf(request)].filter(id => !vetoes.has(id) && byId.has(id) && !usable(id)).map(id => byId.get(id));
    // 구성원 장소와 같은 교체 그룹의 지점은 상한(3곳)과 상관없이 모두 AI 후보에서 뺀다. 상한 밖 지점을 AI가 넣으면
    // 그룹 단위 반영 때문에 꼭 가기가 branch 표시 없이 '반영'으로 세어진다 (#74 재리뷰)
    const humanGroups = new Set(human.map(id => byId.get(id)?.place.branch_group_id).filter(Boolean));
    const sameGroup = dataset.places.filter(r => humanGroups.has(r.place.branch_group_id)).map(r => r.place.place_id);
    const taken = new Set([...human, ...vetoes, ...siblings, ...sameGroup]);
    const candidates = dataset.places.filter(r => !taken.has(r.place.place_id)).flatMap(record => {
      const date = dates.find(d => availability(record, d, profiles, {allowShopping: true}).eligible_for_model);
      if (!date) return [];
      return [{record, costKrw: toEnginePlace(record, availability(record, date, profiles, {allowShopping: true}), limits.krw_per_jpy).cost}];
    });
    // 빈자리 후보 수: 여행 전체 자리(날짜 × 하루 자리 수)만큼, 10~20곳. 실시간 확인은 후보 × 날짜라 상한을 20으로 둔다
    // (3일·보통 기준 그룹당 실시간 확인 69 → 90건. 30곳이면 92건인데 종료 시각은 같았다). 예전에는 여행 길이와 상관없이 10곳이라
    // 3일 여행에서 날짜·검사로 걸러지면 빈자리를 다 채우지 못해 오후 4~5시에 일정이 끝났다(11/16 모의 실험)
    const size = Math.min(20, Math.max(10, dates.length * realSlotsPerDay(groupTradeoffs(request.submissions).pace, limits.active_min)));
    const draft = buildPool({candidates, submissions: request.submissions, byId, missedMusts, budgetKrw: limits.budget_krw, size});
    // 2) AI 후보도 실시간 확인을 통과한 곳만 모델에 보여 준다
    const poolLive = await liveCheck(liveRequests(draft.map(c => c.id), dates, byId, profiles));
    poolLive.verdicts.forEach((v, k) => live.verdicts.set(k, v));
    live.fetched += poolLive.fetched; live.reused += poolLive.reused;
    pool = draft.filter(c => dates.some(date => passed(live, c.id, date)));
  }
  // 끼니 채우기 후보: 아무도 담지 않은 식당 중 여행일에 운영하는 곳을 구성원 장소에 가까운 순으로 MEAL_POOL_SIZE곳.
  // 구성원 장소·제외·교체 후보·AI 후보와 같은 교체 그룹은 뺀다. AI가 꺼져 있어도 규칙으로 채운다.
  let mealPool = deps.mealFill === false ? null : [];
  if (mealPool && mealWindowsFor(limitsFor(request).active_min).length) {
    const vetoedBrands = new Set([...vetoes].map(id => byId.get(id)?.place.brand_id).filter(Boolean));
    const taken = new Set([...human, ...vetoes, ...siblings, ...pool.map(c => c.id)]);
    const takenGroups = new Set([...taken].map(id => byId.get(id)?.place.branch_group_id).filter(Boolean));
    const anchors = human.map(id => byId.get(id)?.place).filter(Boolean);
    const near = p => anchors.length ? Math.min(...anchors.map(o => Math.hypot(o.latitude - p.latitude, o.longitude - p.longitude))) : 0;
    let draft = dataset.places.filter(r => {
      const p = r.place;
      return !taken.has(p.place_id) && !takenGroups.has(p.branch_group_id) && !vetoedBrands.has(p.brand_id)
        && isMeal({category: p.category === '식사' ? 'food' : '', name: p.name_ko, mealRole: r.review.meal_role})
        && dates.some(date => availability(r, date, profiles, {allowShopping: true}).eligible_for_model);
    }).sort((a, b) => near(a.place) - near(b.place) || a.place.place_id.localeCompare(b.place.place_id))
      ;
    // 아침(8–10시)에 문을 여는 식당은 드물어 가까운 순만으로는 후보에 안 들어온다. 따로 몇 곳을 더한다
    const opensEarly = r => dates.some(date => {
      const check = availability(r, date, profiles, {allowShopping: true});
      return check.eligible_for_model && check.windows.some(([open, close]) => open <= MEAL_WINDOWS.breakfast[1] - 30 && close >= MEAL_WINDOWS.breakfast[0] + 60);
    });
    const ids = [...draft.slice(0, MEAL_POOL_SIZE), ...draft.filter(opensEarly).slice(0, 4)];
    draft = [...new Set(ids.map(r => r.place.place_id))];
    const mealLive = await liveCheck(liveRequests(draft, dates, byId, profiles));
    mealLive.verdicts.forEach((v, k) => live.verdicts.set(k, v));
    live.fetched += mealLive.fetched ?? 0; live.reused += mealLive.reused ?? 0;
    mealPool = draft.filter(id => dates.some(date => passed(live, id, date)));
  }
  const mealSet = new Set(mealPool ?? []);
  // 실패 수는 일정에 넣으려던 곳만 센다. 교체 후보 지점은 실패해도 원래 지점을 유지하므로 빼고 센다
  const siblingSet = new Set(siblings);
  // 끼니 후보 식당도 실패하면 다른 식당을 쓰므로 세지 않는다
  const failed = new Set([...live.verdicts].filter(([k, v]) => v.length && !siblingSet.has(k.split('|')[0]) && !mealSet.has(k.split('|')[0])).map(([k]) => k.split('|')[0]));
  live.failedPlaces = [...failed].filter(id => ![...live.verdicts].some(([k, v]) => k.startsWith(id + '|') && !v.length)).length;
  // AI 후보 전체를 경로 표에 넣는다. 모델이 어느 곳을 고를지 경로 조회 전에는 모른다
  const routed = new Set([...picked, ...listed, ...siblings, ...pool.map(c => c.id), ...(mealPool ?? [])]);
  const points = dataset.places.filter(r => routed.has(r.place.place_id))
    .map(r => ({lat: r.place.latitude, lng: r.place.longitude}));
  // One routing snapshot is reused by every strategy so OSRM work is bounded, not tripled.
  return withTripConditions(request.weather, request.startDate, () =>
    withRouting(points, async () => {
      // 3) 빈자리는 후보 수가 아니라 구성원 장소를 실제로 배치해 본 결과로 센다.
      //    예산·걸음·활동시간 때문에 같이 못 넣는 곳은 자리를 채운 것이 아니다
      let ai = null;
      if (pool.length) {
        const slots = realSlotsPerDay(groupTradeoffs(request.submissions).pace, limitsFor(request).active_min);
        let empty = dates.length * slots;
        try {
          const {candidates} = calculatePrepared(request, dataset, profiles, dates, picked, listed, live, null, mealPool);
          empty = Math.max(...candidates.map(c => c.days.reduce((n, d) => n + Math.max(0, slots - d.placeIds.length), 0)));
        } catch (error) { if (error.message !== 'NO_SCHEDULABLE_REAL_CANDIDATE') throw error; }
        if (empty) ai = await chooser(pool, Math.min(empty, pool.length));
      }
      const run=()=>calculatePrepared(request,dataset,profiles,dates,picked,listed,live,ai,mealPool);
      let wet;
      try { wet=run(); } catch(error) {
        if(!hasShelterWeather() || error.message!=='NO_SCHEDULABLE_REAL_CANDIDATE') throw error;
        return withShelterPreference(false,run);
      }
      if(!hasShelterWeather()) return wet;
      // A roof detour is a soft preference. Do not lose a must-place or otherwise
      // feasible visits merely because extra walking/time exceeds a hard limit.
      let plain;
      try { plain=withShelterPreference(false,run); } catch { return wet; }
      return {candidates:wet.candidates.map((candidate,i)=>{
        const a=candidate.planning,b=plain.candidates[i].planning;
        return (!a.must_satisfied && b.must_satisfied)
          || (a.must_satisfied===b.must_satisfied && b.scheduled_count>a.scheduled_count)
          ? plain.candidates[i] : candidate;
      })};
    }, routingOptions));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const request = JSON.parse(fs.readFileSync(0, 'utf8'));
    const {dataset, profiles} = loadRuntimeInputs();
    process.stdout.write(JSON.stringify(await calculateRealCandidates(request, dataset, profiles)) + '\n');
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
