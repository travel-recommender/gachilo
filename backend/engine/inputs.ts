/**
 * 7주차 입력 확장 — 꼭/제외 여러 곳, 트레이드오프 3축, 날짜별 숙소.
 *
 * 이 파일은 "새 입력을 어떻게 읽을 것인가"만 담는다. 채택은 consensus.ts, 배치는 schedule.ts가 한다.
 * 기존 한 개짜리 must/veto도 그대로 받는다. 화면이 바뀌는 동안 서버가 두 형식을 함께 받아야 하기 때문이다.
 */
import { findPlace } from "./places.ts";
import type { Place, Stay, Submission, Tradeoffs } from "./types.ts";

/* ══════════ 1. 꼭 가기 · 제외 — 목록으로 읽기 ══════════ */

/** 꼭 가고 싶은 곳. 앞에 있을수록 본인에게 중요하다(화면의 선택 순서) */
export function mustsOf(sub: Submission): string[] {
  const list = sub.musts ?? (sub.must ? [sub.must] : []);
  return [...new Set(list)].filter((id) => !!findPlace(id));
}

/** 빼고 싶은 곳 */
export function vetoesOf(sub: Submission): string[] {
  const list = sub.vetoes ?? (sub.veto ? [sub.veto] : []);
  return [...new Set(list)].filter((id) => !!findPlace(id));
}

/**
 * 꼭 가고 싶은 곳의 배치 순서.
 *
 * 기획서 원리 2는 "모두가 최소 하나는 지킨다"이다. 개수 제한이 없어지면 많이 찍은 사람이
 * 자리를 쓸어가므로, **전원의 1순위를 먼저 전부 넣고, 그다음 2순위를 돈다.**
 * 같은 순위 안에서는 지금까지 지켜진 '꼭'이 적은 사람이 먼저다. 그래도 같으면 id 순으로
 * 고정해 같은 입력에 같은 결과가 나오게 한다.
 *
 * 거부된 곳은 그 사람의 목록에서 빠지고, 다음 순위가 그 자리를 이어받는다.
 */
export function mustRounds(subs: Submission[], vetoed: Set<string>): { id: string; memberId: string; rank: number }[] {
  const lists = subs.map((s) => ({ memberId: s.memberId, ids: mustsOf(s).filter((id) => !vetoed.has(id)) }));
  const maxLen = Math.max(0, ...lists.map((l) => l.ids.length));
  const kept = new Map(lists.map((l) => [l.memberId, 0]));
  const out: { id: string; memberId: string; rank: number }[] = [];
  const taken = new Set<string>();

  for (let rank = 0; rank < maxLen; rank++) {
    lists
      .filter((l) => l.ids[rank] !== undefined)
      .sort((a, b) => (kept.get(a.memberId)! - kept.get(b.memberId)!) || a.memberId.localeCompare(b.memberId))
      .forEach((l) => {
        const id = l.ids[rank];
        if (taken.has(id)) {
          // 다른 사람의 '꼭'과 같은 곳이면 이미 지켜진 것으로 센다
          kept.set(l.memberId, kept.get(l.memberId)! + 1);
          return;
        }
        taken.add(id);
        kept.set(l.memberId, kept.get(l.memberId)! + 1);
        out.push({ id, memberId: l.memberId, rank });
      });
  }
  return out;
}

/* ══════════ 2. 트레이드오프 3축 ══════════ */

const clamp01 = (n: unknown): number =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;

/** 입력이 없으면 가운데(0.5)로 본다 */
export function tradeoffsOf(sub: Submission): Tradeoffs {
  const t = sub.tradeoffs;
  return { pace: clamp01(t?.pace), distance: clamp01(t?.distance), spend: clamp01(t?.spend) };
}

/**
 * 그룹 값으로 합치기. 축마다 성격이 달라 합치는 방법도 다르다.
 *
 * - pace(빡빡함)·distance(이동 감수)는 **제약**이다. 한 명이라도 힘들면 그 사람이 못 따라오므로
 *   가장 낮은 값을 쓴다(기획서 원리 3의 '하한에 맞춘다').
 * - spend(돈 쓰기)는 **취향**이다. 예산 자체는 이미 하루 예산으로 따로 받아 하한을 쓰고 있으므로,
 *   여기서까지 하한을 쓰면 두 번 깎인다. 평균을 쓴다.
 */
export function groupTradeoffs(subs: Submission[]): Tradeoffs {
  const all = subs.map(tradeoffsOf);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  return {
    pace: Math.min(...all.map((t) => t.pace)),
    distance: Math.min(...all.map((t) => t.distance)),
    spend: mean(all.map((t) => t.spend)),
  };
}

/** 하루에 넣을 '고른 장소' 수. 여유(0) 2곳 ~ 빡빡(1) 4곳 */
export function slotsPerDayFor(pace: number): number {
  return 2 + Math.round(clamp01(pace) * 2);
}

/**
 * 실제로 쓸 상한(원). 예산은 '쓸 수 있는 돈'이고 spend는 '쓰고 싶은 정도'다.
 * 아끼기(0)면 70%, 가운데면 85%, 편하게 쓰기(1)면 100%까지 쓴다.
 */
export function spendCapFor(budget: number, spend: number): number {
  return Math.round(budget * (0.7 + 0.3 * clamp01(spend)));
}

/** 이동 거리에 매기는 벌점 배수. 짧게(0) 1.6배 ~ 멀어도(1) 0.8배 */
export function distanceWeightFor(distance: number): number {
  return 1.6 - 0.8 * clamp01(distance);
}

/* ══════════ 3. 날짜별 숙소 ══════════ */

/**
 * 숙소는 장소 목록에 없는 좌표이므로, 일정 계산에서만 쓰는 가짜 Place로 감싼다.
 * 비용 0·체류 0분·24시간이라 예산·시간 계산에 영향을 주지 않고 거리만 더해진다.
 */
export function stayAsPlace(stay: Stay): Place {
  return {
    id: `stay:${stay.date}`,
    name: stay.name || "숙소",
    area: "숙소",
    category: "landmark",
    lat: stay.lat,
    lng: stay.lng,
    cost: 0,
    stayMin: 0,
    openFrom: 0,
    openTo: 24 * 60,
    exposure: 0,
    covered: true,
    bagLoad: 0,
    popularity: 0,
    blurb: "",
    custom: true,
  };
}

/**
 * 날짜별 숙소를 일차 순서로 편다. 그날 숙소가 없으면 null이고, 그 날은 숙소 계산을 건너뛴다.
 *
 * 참여자마다 숙소가 다르면 **가장 많은 사람이 적은 숙소**를 그날의 기준으로 삼는다.
 * 같이 자는 숙소가 여러 개라는 것은 입력 실수일 가능성이 높으므로 conflicts로 함께 돌려주고,
 * 화면에서 확인을 받는다. 임의로 중간 지점을 만들지 않는다.
 */
export function staysByDay(
  stays: Stay[] | undefined,
  startDate: string,
  days: number
): { byDay: (Place | null)[]; conflicts: { date: string; names: string[] }[] } {
  const byDay: (Place | null)[] = Array.from({ length: days }, () => null);
  const conflicts: { date: string; names: string[] }[] = [];
  if (!stays?.length) return { byDay, conflicts };

  const start = Date.parse(`${startDate}T00:00:00Z`);
  const grouped = new Map<string, Stay[]>();
  stays.forEach((s) => grouped.set(s.date, [...(grouped.get(s.date) ?? []), s]));

  grouped.forEach((list, date) => {
    const index = Math.round((Date.parse(`${date}T00:00:00Z`) - start) / 86400000);
    if (!Number.isFinite(index) || index < 0 || index >= days) return;

    const counts = new Map<string, { stay: Stay; n: number }>();
    list.forEach((s) => {
      const key = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
      const hit = counts.get(key);
      if (hit) hit.n += 1;
      else counts.set(key, { stay: s, n: 1 });
    });

    const ranked = [...counts.values()].sort((a, b) => b.n - a.n || a.stay.name.localeCompare(b.stay.name));
    byDay[index] = stayAsPlace(ranked[0].stay);
    if (ranked.length > 1) conflicts.push({ date, names: ranked.map((r) => r.stay.name) });
  });

  return { byDay, conflicts };
}

/* ══════════ 4. 서버가 쓰는 입력 검증 ══════════ */

export interface InputIssue { field: string; message: string }

/** 계산 전에 거르는 입력 오류. 빈 배열이면 통과다 */
export function validateSubmissions(subs: Submission[], knownIds?: Set<string>): InputIssue[] {
  const issues: InputIssue[] = [];
  const known = (id: string) => (knownIds ? knownIds.has(id) : !!findPlace(id));

  subs.forEach((s, i) => {
    const where = `submissions[${i}]`;
    const musts = s.musts ?? (s.must ? [s.must] : []);
    const vetoes = s.vetoes ?? (s.veto ? [s.veto] : []);

    if (!Array.isArray(s.picks)) issues.push({ field: `${where}.picks`, message: "picks는 배열이어야 합니다" });
    [["musts", musts], ["vetoes", vetoes]].forEach(([name, list]) => {
      (list as string[]).forEach((id) => {
        if (typeof id !== "string") return issues.push({ field: `${where}.${name}`, message: "장소 id는 문자열이어야 합니다" });
        if (!known(id)) issues.push({ field: `${where}.${name}`, message: `알 수 없는 장소: ${id}` });
      });
    });

    // 한 사람이 같은 곳을 꼭·제외로 동시에 고르는 것은 입력 실수다
    const both = musts.filter((id) => vetoes.includes(id));
    both.forEach((id) => issues.push({ field: `${where}.musts`, message: `꼭 가기와 빼기에 같은 장소: ${id}` }));

    if (s.tradeoffs) {
      (["pace", "distance", "spend"] as const).forEach((k) => {
        const v = s.tradeoffs?.[k];
        if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1))
          issues.push({ field: `${where}.tradeoffs.${k}`, message: "0과 1 사이의 값이어야 합니다" });
      });
    }
  });
  return issues;
}

/** 숙소 입력 검증 */
export function validateStays(stays: Stay[] | undefined): InputIssue[] {
  if (!stays) return [];
  const issues: InputIssue[] = [];
  stays.forEach((s, i) => {
    const where = `stays[${i}]`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s?.date ?? "")) issues.push({ field: `${where}.date`, message: "YYYY-MM-DD 형식이어야 합니다" });
    if (typeof s?.lat !== "number" || typeof s?.lng !== "number" || !Number.isFinite(s.lat) || !Number.isFinite(s.lng))
      issues.push({ field: `${where}`, message: "좌표(lat·lng)가 필요합니다. 주소는 서버에서 먼저 좌표로 바꿔 보내주세요" });
  });
  return issues;
}
