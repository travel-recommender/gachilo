/**
 * H4 사용자 실험 모드 (docs/실험설계_10주차.md 2장·5장·7장).
 *
 * - 웹을 NEXT_PUBLIC_EXPERIMENT_MODE=1 로 띄우면 그 웹에서 열리는 모든 방이 실험 방이다.
 *   실험은 그룹마다 따로 띄운 실험용 서버(scripts/experiment_support.py)에 붙여 진행하므로
 *   방마다 표시를 다는 대신 실행 설정 하나로 구분한다. 새로고침·재접속·뒤로 가기에도 그대로다.
 * - 일정은 "일정 A · B · C"로만 보여준다. 어느 전략이 어느 글자인지는 그룹(방)마다 섞고,
 *   같은 그룹 안에서는 모두 같은 글자를 본다 (5.1 — 철수와 영희의 일정 A는 같은 일정).
 * - 화면에 놓이는 순서는 사람마다 섞는다 (2장).
 * - 설명 문장은 참가자 순번(방 참여자 목록 순서)에 따라 5.3 표대로 일정마다 켜고 끈다.
 *
 * 무작위는 방·참여자 id에서 만든 시드로 정한다. 같은 사람은 몇 번을 들어와도 같은 배정을 본다.
 */
import type { SharedStrategy } from "./shared-results-api";

export const EXPERIMENT_MODE = process.env.NEXT_PUBLIC_EXPERIMENT_MODE === "1";

export type Letter = "A" | "B" | "C";
export const LETTERS: Letter[] = ["A", "B", "C"];
const STRATEGIES: SharedStrategy[] = ["average", "least_misery", "fairness"];

/** 5.3 — 순번별 설명을 붙이는 일정. 7번째부터 다시 1번 */
export const EXPLAIN_TABLE: Letter[][] = [
  ["A"],
  ["B", "C"],
  ["B"],
  ["A", "C"],
  ["C"],
  ["A", "B"],
];

/** 32비트 FNV-1a */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — 시드가 같으면 같은 수열 */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const next = rng(hash(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 그룹(방) 안에서 공통인 전략 → 글자 */
export function letterMap(roomId: string): Record<SharedStrategy, Letter> {
  const order = shuffled(STRATEGIES, `letters:${roomId}`);
  return Object.fromEntries(order.map((s, i) => [s, LETTERS[i]])) as Record<SharedStrategy, Letter>;
}

export function strategyOf(roomId: string, letter: string | null): SharedStrategy | null {
  if (!letter) return null;
  const map = letterMap(roomId);
  return STRATEGIES.find((s) => map[s] === letter) ?? null;
}

/** 참가자 순번 (1부터). 방 참여자 목록 순서 = 방을 만들 때 이름을 넣은 순서 */
export function seatOf(memberId: string, memberIds: readonly string[]): number | null {
  const i = memberIds.indexOf(memberId);
  return i < 0 ? null : i + 1;
}

/** 이 순번이 설명을 보는 일정 */
export function explainedLetters(seat: number): Letter[] {
  return EXPLAIN_TABLE[(seat - 1) % EXPLAIN_TABLE.length];
}

export interface ExperimentSlot {
  strategy: SharedStrategy;
  letter: Letter;
  /** 이 사람 화면에서의 위치 (1부터) */
  order: number;
  /** 설명 문장을 보여주는가 */
  explained: boolean;
}

export interface ExperimentAssignment {
  seat: number;
  /** 화면에 놓이는 순서대로 */
  slots: ExperimentSlot[];
}

/**
 * 한 참가자의 배정. 순번을 모르면(참여자 목록에 없음) null — 화면은 일정을 보여주지 않는다.
 * 응답 저장(조은)은 이 값으로 표시 이름·전략·표시 순서·설명 조건을 함께 남긴다.
 */
export function assignment(roomId: string, memberId: string, memberIds: readonly string[]): ExperimentAssignment | null {
  const seat = seatOf(memberId, memberIds);
  if (seat === null) return null;
  const map = letterMap(roomId);
  const explained = new Set(explainedLetters(seat));
  const order = shuffled(LETTERS, `order:${roomId}:${memberId}`);
  const slots = order.map((letter, i) => {
    const strategy = STRATEGIES.find((s) => map[s] === letter)!;
    return { strategy, letter, order: i + 1, explained: explained.has(letter) };
  });
  return { seat, slots };
}

export const scheduleName = (letter: Letter) => `일정 ${letter}`;

/** 실험 모드 P7 안내 문구. 방장 확정·전략 이름은 말하지 않는다 */
export function experimentStatusLine(
  snap: { status: string; submittedCount: number; memberCount: number } | null,
  online: boolean,
  seated: boolean,
): string {
  if (!online) return "실험용 화면은 여행방에서만 열려요. 받은 초대 링크로 들어와 주세요.";
  if (!seated) return "참여자 명단에서 내 자리를 찾지 못했어요. 진행자에게 알려 주세요.";
  if (!snap) return "참여 현황을 불러오는 중이에요.";
  switch (snap.status) {
    case "collecting": return "모두 입력을 마치면 일정 3개가 나와요. 잠시 기다려 주세요.";
    case "awaiting_result":
    case "calculating": return "전원 입력이 끝났어요. 일정 3개를 만드는 중이에요.";
    case "awaiting_selection":
    case "ready": return "일정 3개가 나왔어요. 하나씩 눌러 살펴본 뒤, 다른 사람과 상의하지 말고 설문에 답해 주세요.";
    default: return "";
  }
}

/** 전략 이름 — 실험 화면 문장에 섞이면 안 된다 (5.4) */
export const STRATEGY_WORDS = ["평균", "최소 불만", "공정성", "average", "least_misery", "fairness"];

/** 실제 장소 결과의 계획 요약 (backend/candidate_results.py planning). 데모 방에는 없다 */
type PlanningLike = {
  must_satisfied: boolean;
  unplaced_count: number;
  reason_aggregation?: string;
  exclusion_reason_counts: Record<string, number>;
};
type CandidateLike = {
  metrics: { walkStepsPerDay: number; costKrwPerDay: number };
  days: { items: { placeId: string; source: string }[] }[];
  planning?: PlanningLike | null;
};
type MineLike = {
  picks: string[]; must: string | null; veto: string | null; vetoes?: string[];
  budgetPerDay: number; stepLimit: number;
};

/**
 * 못 넣은 이유 — 참가자용 짧은 말. 코드는 backend/engine/real_candidates.mjs · live_check.mjs가 낸다.
 * 여러 날짜에 공통인 이유만 온다(reason_aggregation = common_across_dates). 한 곳에 이유가 여러 개일 수 있다.
 */
const UNPLACED_REASON: Record<string, string> = {
  closed_on_visit_date: "여행 날짜에 모두 휴무",
  outside_reviewed_date_range: "여행 날짜의 운영 정보가 확인되지 않음",
  outside_place_reviewed_date_range: "여행 날짜의 운영 정보가 확인되지 않음",
  budget_exceeded: "하루 예산 초과",
  step_limit_exceeded: "하루 걸음 한도 초과",
  active_minutes_exceeded: "하루 활동 시간 초과",
  requested_place_not_scheduled: "이동·체류 시간을 넣을 시간이 부족",
  opening_or_last_entry_violation: "영업·입장 마감 시간과 맞지 않음",
  daily_place_limit: "하루에 갈 수 있는 곳 수가 다 참",
  strategy_selection_or_capacity: "하루에 갈 수 있는 곳 수가 다 참",
  date_conditions_vary: "날짜마다 이유가 다름",
  live_closed_permanently: "폐업",
  live_closed_temporarily: "임시 휴업",
  live_closed_on_visit_date: "여행 날짜에 모두 휴무",
  live_hours_changed: "영업시간이 바뀜",
};

const OTHER = "그 밖의 운영 조건";

/** 아무도 고르지 않은 곳을 넣은 주체. P8 표시(badgeOf)와 같다: ai_added = "AI 추천", 나머지 = "추천" */
const FILL_REASON: [source: string, phrase: string][] = [
  ["ai_added", "모두의 취향·예산에 맞아 AI가 골라 넣었"],
  // AI가 꺼져 있거나 답이 검증을 통과하지 못하면 같은 후보를 규칙 순서로 넣는다 (backend/engine/real_ai.mjs)
  ["rule_added", "모두의 취향·예산에 맞아 규칙에 따라 골라 넣었"],
  ["meal_fill", "빈 식사 시간을 채우려고 넣었"],
];

/**
 * 5.4 "모두에게 같은 설명" — 같은 일정을 보는 그룹 모두에게 같은 문장. 실제 장소 결과(planning)가 있을 때만.
 * 다른 사람의 입력(누구의 1순위·제외·예산·걸음 수치)은 드러내지 않는다. 숫자는 그룹 합계·장소 수만 쓴다.
 */
export function groupExplanation(c: CandidateLike): string[] {
  const p = c.planning;
  const lines: string[] = [];
  const unpicked = c.days.flatMap((d) => d.items).filter((it) => it.source !== "selected");
  const parts = FILL_REASON
    .map(([source, phrase]) => [unpicked.filter((it) => it.source === source).length, phrase] as const)
    .filter(([n]) => n > 0);
  const other = unpicked.length - parts.reduce((a, [n]) => a + n, 0);
  if (other) parts.push([other, "조건에 맞아 넣었"] as const);
  if (parts.length === 1) lines.push(`아무도 고르지 않은 ${parts[0][0]}곳은 ${parts[0][1]}어요.`);
  else if (parts.length > 1) {
    lines.push(`아무도 고르지 않은 곳 중 ${parts.map(([n, phrase], i) => `${n}곳은 ${phrase}${i < parts.length - 1 ? "고" : "어요."}`).join(", ")}`);
  }
  if (!p) return lines;
  lines.unshift(
    p.must_satisfied ? "모두의 1순위 꼭 가기가 모두 들어갔어요." : "1순위 꼭 가기 중 일부는 이번 일정에 들어가지 못했어요.",
    // 실제 장소 경로는 제외한 곳을 후보에서 빼고, 하루마다 그룹에서 가장 적은 걸음 한도로 검사한다
    "누군가 제외한 곳은 넣지 않았어요.",
    "하루 걸음 수는 그룹에서 가장 적은 걸음 한도를 넘지 않아요.",
  );
  if (p.unplaced_count > 0) {
    const counts = new Map<string, number>();
    const known = p.reason_aggregation === "common_across_dates";
    for (const [code, n] of Object.entries(known ? p.exclusion_reason_counts : {})) {
      const label = UNPLACED_REASON[code] ?? OTHER;
      counts.set(label, (counts.get(label) ?? 0) + n);
    }
    // 많은 이유부터, 같으면 가나다순. "그 밖의 운영 조건"은 맨 뒤 — 결과마다 문장 순서가 흔들리지 않게
    const why = [...counts]
      .sort(([la, a], [lb, b]) => Number(la === OTHER) - Number(lb === OTHER) || b - a || la.localeCompare(lb, "ko"))
      .map(([label, n]) => `${label} ${n}곳`).join(", ");
    lines.push(`꼭 가기로 고른 곳 중 ${p.unplaced_count}곳은 넣지 못했어요${why ? ` (${why})` : ""}.`);
  }
  return lines;
}

/**
 * 실험 모드의 설명 문장 (5.4). 엔진 결과와 내 입력으로 정해진 틀을 채운다. 문장을 만드는 데 AI는 쓰지 않는다.
 * 서버 요약(summary)은 첫 문장에 전략 이름이 들어 있어 실험 화면에 쓰지 않는다.
 * 순서: 모두에게 같은 설명(groupExplanation) → 나에게만 보이는 설명.
 */
export function experimentExplanation(c: CandidateLike, mine: MineLike, nameOf: (id: string) => string): string[] {
  const placed = new Set(c.days.flatMap((d) => d.items.map((it) => it.placeId)));
  const lines: string[] = groupExplanation(c);
  const picks = mine.picks;
  if (picks.length) {
    const kept = picks.filter((id) => placed.has(id)).length;
    lines.push(`내 꼭 가기 ${picks.length}곳 중 ${kept}곳이 들어갔어요.`);
  }
  if (mine.must) {
    lines.push(placed.has(mine.must)
      ? `내 1순위 ${nameOf(mine.must)}은(는) 들어갔어요.`
      : `내 1순위 ${nameOf(mine.must)}은(는) 이번 일정에 들어가지 못했어요.`);
  }
  const vetoes = mine.vetoes ?? (mine.veto ? [mine.veto] : []);
  // 그룹 문장("누군가 제외한 곳은 넣지 않았어요")이 있으면 같은 말을 반복하지 않는다
  if (vetoes.length && !(c.planning && vetoes.every((id) => !placed.has(id)))) {
    lines.push(vetoes.some((id) => placed.has(id))
      ? "내가 제외한 곳 중 일부가 들어 있어요."
      : "내가 제외한 곳은 넣지 않았어요.");
  }
  const pct = (a: number, b: number) => Math.round((a / b) * 100);
  if (mine.budgetPerDay > 0 && mine.stepLimit > 0) {
    lines.push(`하루 예산의 ${pct(c.metrics.costKrwPerDay, mine.budgetPerDay)}%, 걸음 한도의 ${pct(c.metrics.walkStepsPerDay, mine.stepLimit)}%를 써요.`);
  }
  return lines;
}
