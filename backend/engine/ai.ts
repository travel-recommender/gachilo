/**
 * AI 연결 — 규칙 엔진 결과를 근거 JSON으로 만들어 솜솜AI 게이트웨이(OpenAI 호환)에 1회 보내고,
 * 검증을 통과한 결과만 일정에 반영한다. 실패하면 규칙 결과를 그대로 쓴다.
 *
 * 설계 원칙 — 모델은 자유 문장을 쓰지 않는다.
 *   모델이 하는 일은 (1) 후보 중에서 고르기, (2) 어떤 설명이 이번 결과에 해당하는지 고르기 두 가지뿐이다.
 *   문장은 코드가 템플릿으로 만들고 숫자·장소 이름도 코드가 넣는다.
 *   그래서 "없는 장소를 말한다", "없는 숫자를 만든다"가 구조적으로 불가능하다.
 *
 * 환경변수
 *   SOMSOM_API_KEY   동덕여대 솜솜AI API 키. 없으면 AI를 건너뛰고 규칙 결과로 응답한다
 *   SOMSOM_MODEL     기본 gemini-3.5-flash-lite
 *   SOMSOM_BASE_URL  기본 https://factchat-cloud.mindlogic.ai/v1/gateway
 *   AI_TIMEOUT_MS    기본 12000
 *   AI_MOCK          호출 없이 고정 응답 (검사용) 1=정상 · bad=JSON 깨짐 · halluc=없는 장소 · freetext=자유 문장
 */
import { allPlaces } from "./places.ts";
import { distKm, toView, tripBudget, utilityOf } from "./consensus.ts";
import type { ConsensusResult, Place, Selection, Submission } from "./types.ts";

/* ══════════ 1. 근거 JSON ══════════ */

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildEvidence(res: ConsensusResult, submissions: Submission[], days: number, slotsPerDay = 3) {
  const subs = submissions.map((s) => toView(s, days));
  const capacity = days * slotsPerDay;

  // 규칙이 AI 대신 넣어 둔 곳은 빼고 그 자리를 모델에 돌려준다
  const humanCore = res.core.filter((s) => !s.aiAdded);
  const fixedCost = humanCore.reduce((a, s) => a + s.place.cost, 0);
  const budget = Math.min(...submissions.map((s) => tripBudget(s, days)));
  const remaining = Math.max(0, budget - fixedCost);

  const taken = new Set([...res.selections, ...res.excluded].map((s) => s.place.id));
  const picked = new Set(subs.flatMap((s) => s.picks));
  const vetoed = new Set(subs.map((s) => s.veto).filter(Boolean) as string[]);
  const pickedCats = subs.map((s) => new Set(s.picks.map((id) => allPlaces().find((p) => p.id === id)?.category)));

  const ep = (p: Place) => ({
    id: p.id, name: p.name, area: p.area, category: p.category,
    cost_won: p.cost, stay_min: p.stayMin, open: `${hhmm(p.openFrom)}-${hhmm(p.openTo)}`,
  });

  const slots = Math.max(0, capacity - humanCore.length);

  // 카테고리별로 돌아가며 뽑는다. popularity가 상수여도 후보가 한 카테고리에 쏠리지 않는다
  const scored = allPlaces()
    .filter((p) => !taken.has(p.id) && !picked.has(p.id) && !vetoed.has(p.id) && p.cost <= remaining)
    .map((p) => {
      const u = subs.map((s) => utilityOf(p, s));
      return { ...ep(p), fit_min: r2(Math.min(...u)), fit_avg: r2(u.reduce((a, b) => a + b, 0) / u.length),
               taste_match: pickedCats.filter((c) => c.has(p.category)).length };
    })
    .filter((c) => Number.isFinite(c.fit_avg) && c.fit_min >= 0.2)
    .sort((a, b) => b.fit_avg - a.fit_avg || a.id.localeCompare(b.id));

  const byCat = new Map<string, typeof scored>();
  scored.forEach((c) => byCat.set(c.category, [...(byCat.get(c.category) ?? []), c]));
  const ai_candidates: typeof scored = [];
  while (ai_candidates.length < 10 && [...byCat.values()].some((v) => v.length)) {
    for (const list of byCat.values()) {
      const next = list.shift();
      if (next && ai_candidates.length < 10) ai_candidates.push(next);
    }
  }

  const used = [...humanCore, ...res.options].map((s) => s.place)
    .concat(allPlaces().filter((p) => ai_candidates.some((c) => c.id === p.id)));
  const areas = [...new Set(used.map((p) => p.area))].sort();
  const center = (a: string) => {
    const ps = used.filter((p) => p.area === a);
    return { lat: ps.reduce((s, p) => s + p.lat, 0) / ps.length, lng: ps.reduce((s, p) => s + p.lng, 0) / ps.length } as Place;
  };
  const area_km: Record<string, number> = {};
  for (let i = 0; i < areas.length; i++)
    for (let j = i + 1; j < areas.length; j++)
      area_km[`${areas[i]}|${areas[j]}`] = Math.round(distKm(center(areas[i]), center(areas[j])) * 10) / 10;

  const sel = (s: Selection, tier: "core" | "option") => ({
    ...ep(s.place), tier,
    reason: s.mustOf ? "must" : tier === "core" ? "votes" : "partial",
    votes: s.votes,
  });

  return {
    task: "plan" as const,
    trip: { city: "오사카", days, members: subs.length },
    group_limits: {
      budget_per_person_won: budget,
      fixed_cost_won: fixedCost,
      remaining_budget_won: remaining,
      walk_steps_per_day: Math.min(...subs.map((s) => s.stepLimit)),
      walk_km_per_day: Math.round(Math.min(...subs.map((s) => s.walkLimit)) * 10) / 10,
      active_min_per_day: Math.min(...subs.map((s) => s.activeMin)),
    },
    ai_slots: slots,
    fixed: [...humanCore.map((s) => sel(s, "core")), ...res.options.map((s) => sel(s, "option"))],
    ai_candidates,
    excluded: res.excluded.map((s) => ({ id: s.place.id, name: s.place.name, reason: s.excluded ?? "time" })),
    area_km,
  };
}
export type Evidence = ReturnType<typeof buildEvidence>;

/* ══════════ 2. 출력 어휘 — 모델은 여기 있는 코드만 고를 수 있다 ══════════ */

/** 받침에 맞는 조사. "신세카이 거리를", "오사카성은" */
function josa(word: string, pair: "을" | "은" | "이" | "과"): string {
  const last = word.trim().slice(-1).charCodeAt(0);
  const has = last >= 0xac00 && last <= 0xd7a3 ? (last - 0xac00) % 28 !== 0 : true;
  const map = { "을": ["를", "을"], "은": ["는", "은"], "이": ["가", "이"], "과": ["와", "과"] } as const;
  return word + map[pair][has ? 1 : 0];
}

/** AI가 장소를 추가한 이유. 문장은 코드가 만든다 */
const REASON_TEXT: Record<string, (name: string) => string> = {
  budget_fits: (n) => `${josa(n, "은")} 남은 예산 안에서 갈 수 있어요.`,
  no_one_dislikes: (n) => `${josa(n, "은")} 누구에게도 부담스럽지 않은 곳이에요.`,
  near_fixed: (n) => `${josa(n, "은")} 이미 정해진 곳들과 가까워 이동이 적어요.`,
  category_gap: (n) => `${josa(n, "은")} 지금 일정에 없는 종류라 하루가 단조롭지 않아요.`,
};

/** 전체 설명. 근거가 있을 때만 쓸 수 있다 */
const SUMMARY_TEXT: Record<string, (e: Evidence, added: Place[]) => string> = {
  must_kept: (e) => `${e.fixed.filter((f) => f.reason === "must").length}곳의 '꼭 가고 싶은 곳'은 모두 지켰어요.`,
  ai_filled: (_e, a) => `남은 자리에는 ${josa(a.map((p) => p.name).join(", "), "을")} 넣었어요.`,
  no_room: () => `모두가 고른 곳으로 일정이 다 차서 더 넣지 않았어요.`,
  slots_filled: (e) => `남은 ${e.ai_slots}자리를 모두 채웠어요.`,
  budget_limited: (e) => `남은 예산 ${e.group_limits.remaining_budget_won.toLocaleString("ko-KR")}원 안에서 고를 수 있는 곳만 담았어요.`,
  options_free: (e) => `${e.fixed.filter((f) => f.tier === "option").length}곳은 원하는 분만 가는 일정으로 남겼어요.`,
  veto_excluded: () => `빼 달라고 한 곳은 일정에서 제외했어요.`,
  walk_limited: (e) => `하루 ${e.group_limits.walk_km_per_day}km 안에서 움직이도록 맞췄어요.`,
};

/** 각 설명을 쓸 수 있는 조건. 근거와 맞지 않으면 검증에서 걸린다 */
const SUMMARY_OK: Record<string, (e: Evidence, added: Place[]) => boolean> = {
  must_kept: (e) => e.fixed.some((f) => f.reason === "must"),
  ai_filled: (_e, a) => a.length > 0,
  no_room: (e, a) => e.ai_slots === 0 || a.length === 0,
  slots_filled: (e, a) => a.length > 0 && a.length === e.ai_slots,
  budget_limited: (e) => e.group_limits.remaining_budget_won > 0,
  options_free: (e) => e.fixed.some((f) => f.tier === "option"),
  veto_excluded: (e) => e.excluded.some((x) => x.reason === "veto"),
  walk_limited: () => true,
};

export interface PlanOutput {
  ai_added: { id: string; reason_code: string }[];
  summary: string[];
}

export const SYSTEM_PROMPT = `당신은 그룹 여행의 합의안을 정리하는 가이드입니다.
규칙 엔진이 "어디를 갈지"의 대부분을 이미 정했습니다. 당신이 할 일은 두 가지뿐입니다.

1. 추가: ai_candidates 중에서 최대 ai_slots개를 골라 ai_added에 넣습니다.
   - cost_won 합이 group_limits.remaining_budget_won 이하여야 합니다.
   - fit_min이 높은 곳(누구에게도 싫지 않은 곳)을 우선하고, fixed와 카테고리가 겹치지 않게 섞습니다.
   - 넣을 만한 곳이 없으면 빈 배열로 둡니다.
   - 고른 곳마다 reason_code를 하나 붙입니다:
     budget_fits(남은 예산 안) · no_one_dislikes(모두에게 무난) · near_fixed(기존 일정과 가까움) · category_gap(없는 종류를 채움)
2. 설명 고르기: 이번 결과에 해당하는 설명 코드를 summary에 2~4개 고릅니다. 근거에 없는 것은 고르지 않습니다.
     must_kept(꼭 가고 싶은 곳이 있고 지켜짐) · ai_filled(장소를 하나라도 추가함)
     slots_filled(남은 자리를 전부 채움) · no_room(한 곳도 추가하지 않음. 추가했다면 쓸 수 없음)
     budget_limited(남은 예산이 제한이 됨) · options_free(옵션 장소가 있음) · veto_excluded(거부된 곳이 있음)
     walk_limited(걷기 한도에 맞춤)
   - ai_filled와 no_room은 함께 쓸 수 없습니다. 자리를 다 채웠으면 slots_filled를 씁니다.

문장은 앱이 직접 만듭니다. 당신은 문장을 쓰지 않습니다.
입력에 주어진 것 외의 장소·숫자·사실을 만들어 내지 마십시오. 코드가 아닌 글자를 쓰면 거부됩니다.

[출력] 아래 JSON 하나만. 설명·코드블록 없이.
{"ai_added":[{"id":"...","reason_code":"..."}],"summary":["must_kept","ai_filled"]}`;

const SHOT_IN = {
  task: "plan", trip: { city: "오사카", days: 2, members: 3 },
  group_limits: { budget_per_person_won: 100000, fixed_cost_won: 43000, remaining_budget_won: 57000,
    walk_steps_per_day: 8000, walk_km_per_day: 5.6, active_min_per_day: 420 },
  ai_slots: 2,
  fixed: [
    { id: "osaka_castle", name: "오사카성 천수각", area: "오사카성", category: "landmark", cost_won: 6000, stay_min: 90, open: "09:00-17:00", tier: "core", reason: "must", votes: 2 },
    { id: "kuromon", name: "쿠로몬 시장", area: "난바", category: "food", cost_won: 25000, stay_min: 60, open: "09:00-17:00", tier: "core", reason: "votes", votes: 2 },
    { id: "umeda_sky", name: "우메다 스카이빌딩 공중정원", area: "우메다", category: "landmark", cost_won: 15000, stay_min: 90, open: "09:30-22:30", tier: "option", reason: "partial", votes: 1 },
  ],
  ai_candidates: [
    { id: "castle_park", name: "오사카성 공원", area: "오사카성", category: "nature", cost_won: 0, stay_min: 60, open: "05:00-23:00", fit_min: 0.41, fit_avg: 0.47, taste_match: 1 },
    { id: "nakazaki", name: "나카자키초 카페거리", area: "우메다", category: "cafe", cost_won: 9000, stay_min: 60, open: "11:00-19:00", fit_min: 0.33, fit_avg: 0.38, taste_match: 1 },
  ],
  excluded: [{ id: "usj", name: "유니버설 스튜디오 재팬", reason: "veto" }],
  area_km: { "난바|오사카성": 3.1, "난바|우메다": 3.6, "오사카성|우메다": 3.2 },
};

const SHOT_OUT: PlanOutput = {
  ai_added: [
    { id: "castle_park", reason_code: "near_fixed" },
    { id: "nakazaki", reason_code: "budget_fits" },
  ],
  summary: ["must_kept", "ai_filled", "options_free", "veto_excluded"],
};

/* ══════════ 3. 모델 호출 ══════════ */

function mockOutput(ev: Evidence): unknown {
  const mode = process.env.AI_MOCK;
  if (mode === "halluc") return { ai_added: [{ id: "kyoto_tower", reason_code: "budget_fits" }], summary: ["must_kept"] };
  if (mode === "freetext") return { ai_added: [], summary: ["교토타워를 방문해요.", "모든 장소의 입장료는 0원이에요."] };
  const first = ev.ai_candidates[0];
  return first && ev.ai_slots > 0
    ? { ai_added: [{ id: first.id, reason_code: "no_one_dislikes" }], summary: ["must_kept", "ai_filled"] }
    : { ai_added: [], summary: ["must_kept", "no_room"] };
}

export async function callModel(ev: Evidence): Promise<string> {
  const mock = process.env.AI_MOCK;
  if (mock === "bad") return "알겠습니다! 아래와 같이 정리했어요.\n{\"ai_added\": [{\"id\": ";
  if (mock) return JSON.stringify(mockOutput(ev));

  const base = process.env.SOMSOM_BASE_URL ?? "https://factchat-cloud.mindlogic.ai/v1/gateway";
  const model = process.env.SOMSOM_MODEL ?? "gemini-3.5-flash-lite";
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Number(process.env.AI_TIMEOUT_MS ?? 12000));
  try {
    const r = await fetch(`${base}/chat/completions/`, {
      method: "POST",
      signal: ctl.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.SOMSOM_API_KEY ?? ""}` },
      body: JSON.stringify({
        model, temperature: 0, max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(SHOT_IN) },
          { role: "assistant", content: JSON.stringify(SHOT_OUT) },
          { role: "user", content: JSON.stringify(ev) },
        ],
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message ?? `HTTP ${r.status}`);
    return data.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

export function parsePlan(text: string): PlanOutput {
  const s = text.replace(/```json|```/g, "").trim();
  const o = JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
  if (!Array.isArray(o.ai_added) || !Array.isArray(o.summary)) throw new Error("스키마 불일치");
  return o;
}

/* ══════════ 4. 검증 — 근거와 대조한다 ══════════ */

export function validatePlan(out: PlanOutput, ev: Evidence): string[] {
  const errs: string[] = [];
  const cand = new Map(ev.ai_candidates.map((c) => [c.id, c]));
  const byId = new Map(allPlaces().map((p) => [p.id, p]));

  out.ai_added.forEach((a, i) => {
    if (typeof a?.id !== "string") return errs.push(`ai_added[${i}]: id가 없음`);
    if (!cand.has(a.id)) errs.push(`후보 밖 장소: ${a.id}`);
    if (!REASON_TEXT[a.reason_code]) errs.push(`ai_added[${i}]: 알 수 없는 이유 코드 (${a.reason_code})`);
  });
  if (out.ai_added.length > ev.ai_slots) errs.push(`추가 ${out.ai_added.length}곳 > 자리 ${ev.ai_slots}곳`);
  if (new Set(out.ai_added.map((a) => a.id)).size !== out.ai_added.length) errs.push("같은 장소를 두 번 추가");
  const cost = out.ai_added.reduce((s, a) => s + (cand.get(a.id)?.cost_won ?? 0), 0);
  if (cost > ev.group_limits.remaining_budget_won)
    errs.push(`추가 비용 ${cost} > 남은 예산 ${ev.group_limits.remaining_budget_won}`);

  const added = out.ai_added.map((a) => byId.get(a.id)).filter(Boolean) as Place[];
  const seen = new Set<string>();
  out.summary.forEach((code, i) => {
    if (typeof code !== "string" || !SUMMARY_TEXT[code]) return errs.push(`summary[${i}]: 알 수 없는 설명 코드 (${String(code).slice(0, 20)})`);
    if (!SUMMARY_OK[code](ev, added)) errs.push(`summary[${i}]: 근거가 없는 설명 (${code})`);
    if (seen.has(code)) errs.push(`summary[${i}]: 같은 설명 반복 (${code})`);
    seen.add(code);
  });
  if (out.summary.includes("ai_filled") && out.summary.includes("no_room"))
    errs.push("summary: ai_filled와 no_room을 함께 씀 (자리를 다 채웠다면 slots_filled)");
  if (!out.summary.length) errs.push("summary가 비어 있음");
  return errs;
}

/** 코드 → 사람이 읽는 문장. 장소 이름과 숫자는 여기서 들어간다 */
export function renderSummary(out: PlanOutput, ev: Evidence): string {
  const byId = new Map(allPlaces().map((p) => [p.id, p]));
  const added = out.ai_added.map((a) => byId.get(a.id)).filter(Boolean) as Place[];
  const lines = out.summary.map((code) => SUMMARY_TEXT[code](ev, added));
  out.ai_added.forEach((a) => {
    const place = byId.get(a.id);
    if (place) lines.push(REASON_TEXT[a.reason_code](place.name));
  });
  return lines.join(" ");
}

/* ══════════ 5. 규칙 결과에 합치기 ══════════ */

export interface Enriched {
  /** 다 같이 가는 일정에 넣을 장소. 옵션은 절대 들어가지 않는다 */
  core: Selection[];
  summary: string;
  ai: {
    used: boolean; reason: string; added: string[]; errors: string[]; ms: number;
    /** AI가 추가한 곳마다, 그 판단에 쓰인 입력값을 그대로 남긴다 (근거 추적용) */
    basis: { id: string; name: string; reason_code: string; fit_min: number; fit_avg: number;
             taste_match: number; cost_won: number }[];
  };
}

/**
 * 규칙 결과 + AI 제안 → 일정 재료.
 * 어떤 경우에도 예외를 던지지 않는다. AI가 실패하면 규칙의 core를 그대로 돌려준다.
 */
export async function enrich(
  res: ConsensusResult, submissions: Submission[], days: number, fallbackSummary: string
): Promise<Enriched> {
  const off = (reason: string, errors: string[] = [], ms = 0): Enriched =>
    ({ core: res.core, summary: fallbackSummary, ai: { used: false, reason, added: [], errors, ms, basis: [] } });

  if (!process.env.SOMSOM_API_KEY && !process.env.AI_MOCK) return off("SOMSOM_API_KEY 없음");

  const t0 = Date.now();
  try {
    const ev = buildEvidence(res, submissions, days);
    const plan = parsePlan(await callModel(ev));
    const errs = validatePlan(plan, ev);
    const ms = Date.now() - t0;
    if (errs.length) return off("검증 실패", errs, ms);

    const byId = new Map(allPlaces().map((p) => [p.id, p]));
    const memberIds = submissions.map((s) => s.memberId);
    const added: Selection[] = plan.ai_added.flatMap((a) => {
      const place = byId.get(a.id);
      return place ? [{ place, votes: 0, mustOf: null, tier: "core" as const, participants: memberIds, aiAdded: true }] : [];
    });
    return {
      core: [...res.core.filter((s) => !s.aiAdded), ...added],
      summary: renderSummary(plan, ev),
      ai: {
        used: true, reason: "ok", added: added.map((s) => s.place.id), errors: [], ms,
        basis: plan.ai_added.flatMap((a) => {
          const c = ev.ai_candidates.find((x) => x.id === a.id);
          return c ? [{ id: c.id, name: c.name, reason_code: a.reason_code, fit_min: c.fit_min,
                        fit_avg: c.fit_avg, taste_match: c.taste_match, cost_won: c.cost_won }] : [];
        }),
      },
    };
  } catch (e) {
    return off(e instanceof Error ? e.message : "알 수 없는 오류", [], Date.now() - t0);
  }
}
