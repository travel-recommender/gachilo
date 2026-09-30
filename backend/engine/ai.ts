/**
 * AI 연결 — 규칙 엔진 결과를 근거 JSON으로 만들어 솜솜AI 게이트웨이(OpenAI 호환)에 1회 보내고,
 * 검증을 통과한 결과만 일정에 반영한다. 실패하면 규칙 결과를 그대로 쓴다.
 *
 * 환경변수
 *   SOMSOM_API_KEY   동덕여대 솜솜AI API 키. 없으면 AI를 건너뛴다 (서버는 그대로 동작)
 *   SOMSOM_MODEL     기본 gpt-4o-mini. /v1/gateway/models/ 로 목록을 보고 바꾼다
 *   SOMSOM_BASE_URL  기본 https://factchat-cloud.mindlogic.ai/v1/gateway
 *   AI_TIMEOUT_MS    기본 12000
 *   AI_MOCK          호출 없이 고정 응답 (테스트용)
 *                    1=정상 · bad=JSON 깨짐 · halluc=없는 장소
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
  const human = res.selections.filter((s) => !s.aiAdded);
  const humanCore = human.filter((s) => s.tier === "core");
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

  const ai_candidates = allPlaces()
    .filter((p) => !taken.has(p.id) && !picked.has(p.id) && !vetoed.has(p.id) && p.cost <= remaining)
    .map((p) => {
      const u = subs.map((s) => utilityOf(p, s));
      return { ...ep(p), fit_min: r2(Math.min(...u)), fit_avg: r2(u.reduce((a, b) => a + b, 0) / u.length),
               taste_match: pickedCats.filter((c) => c.has(p.category)).length };
    })
    .filter((c) => c.fit_min >= 0.2)
    .sort((a, b) => b.fit_avg - a.fit_avg || a.id.localeCompare(b.id))
    .slice(0, 10);

  const used = [...human.map((s) => s.place), ...allPlaces().filter((p) => ai_candidates.some((c) => c.id === p.id))];
  const areas = [...new Set(used.map((p) => p.area))].sort();
  const center = (a: string) => {
    const ps = used.filter((p) => p.area === a);
    return { lat: ps.reduce((s, p) => s + p.lat, 0) / ps.length, lng: ps.reduce((s, p) => s + p.lng, 0) / ps.length } as Place;
  };
  const area_km: Record<string, number> = {};
  for (let i = 0; i < areas.length; i++)
    for (let j = i + 1; j < areas.length; j++)
      area_km[`${areas[i]}|${areas[j]}`] = Math.round(distKm(center(areas[i]), center(areas[j])) * 10) / 10;

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
    ai_slots: Math.max(0, capacity - humanCore.length),
    fixed: human.map((s) => ({ ...ep(s.place), tier: s.tier,
      reason: s.mustOf ? "must" : s.tier === "core" ? "votes" : "partial", votes: s.votes })),
    ai_candidates,
    excluded: res.excluded.map((s) => ({ id: s.place.id, name: s.place.name, reason: s.excluded ?? "time" })),
    area_km,
  };
}
export type Evidence = ReturnType<typeof buildEvidence>;

/* ══════════ 2. 프롬프트 (논문 2.3 구조) ══════════ */

export const SYSTEM_PROMPT = `당신은 그룹 여행의 합의안을 정리하는 가이드입니다.
규칙 엔진이 "어디를 갈지"의 대부분을 이미 정했습니다. 당신이 할 일은 두 가지뿐입니다.

1. 추가: ai_candidates 중에서 최대 ai_slots개를 골라 ai_added에 넣습니다.
   - cost_won 합이 group_limits.remaining_budget_won 이하여야 합니다.
   - fit_min이 높은 곳(누구에게도 싫지 않은 곳)을 우선하고, fixed와 카테고리가 겹치지 않게 섞습니다.
   - 넣을 만한 곳이 없으면 빈 배열로 둡니다.
2. 설명: ai_added마다 reason 1문장, 전체 summary 2~4문장.

[사실 규칙 — 반드시 지킬 것]
- 장소는 입력의 id로만 가리킵니다. 문장에서는 이름 대신 {{id}}라고 씁니다. 예: "{{osaka_castle}}에서 시작해요."
- 입력에 없는 장소·지역·가게는 절대 쓰지 않습니다.
- 숫자는 입력에 있는 값을 그대로 옮길 때만 씁니다. 더하거나 나누어 새 숫자를 만들지 않습니다.
- 입력에 없는 정보(영업시간 설명, 가격 변동, 평점·리뷰, 교통 노선, 날씨, 예약, 대기 줄)는 쓰지 않습니다.
- 특정 사람을 가리키지 않습니다. "가장 빠듯한 분" 같은 표현도 안 됩니다. "모두", "그룹"으로만 말합니다.
- 입력 JSON의 필드 이름(ai_slots, fit_min, cost_won 등)을 문장에 쓰지 않습니다. 사람이 읽는 말로만 씁니다.
- 확실하지 않으면 쓰지 말고 생략합니다.

[출력] 아래 JSON 하나만. 설명·코드블록 없이.
{"ai_added":[{"id":"...","reason":"..."}],"summary":["...","..."]}`;

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
    { id: "hankyu", name: "한큐백화점 우메다", area: "우메다", category: "shopping", cost_won: 55000, stay_min: 90, open: "10:00-20:00", fit_min: 0.3, fit_avg: 0.39, taste_match: 0 },
    { id: "nakazaki", name: "나카자키초 카페거리", area: "우메다", category: "cafe", cost_won: 9000, stay_min: 60, open: "11:00-19:00", fit_min: 0.33, fit_avg: 0.38, taste_match: 1 },
  ],
  excluded: [{ id: "usj", name: "유니버설 스튜디오 재팬", reason: "veto" }],
  area_km: { "난바|오사카성": 3.1, "난바|우메다": 3.6, "오사카성|우메다": 3.2 },
};

const SHOT_OUT = {
  ai_added: [
    { id: "castle_park", reason: "{{osaka_castle}} 바로 옆이라 이동 없이 쉬어 갈 수 있고, 모두에게 무난한 자연 코스예요." },
    { id: "nakazaki", reason: "남은 예산 안에 들어오는 카페 코스로, {{umeda_sky}} 가기 전에 들르기 좋아요." },
  ],
  summary: [
    "모두의 '꼭 가고 싶은 곳'인 {{osaka_castle}}를 코어로 지켰어요.",
    "{{hankyu}}는 남은 예산에 비해 부담이 커서 넣지 않았어요.",
    "{{umeda_sky}}는 원하는 사람만 가는 일정으로 남겼어요.",
  ],
};

export interface PlanOutput { ai_added: { id: string; reason: string }[]; summary: string[] }

/* ══════════ 3. 모델 호출 ══════════ */

const MOCK: PlanOutput = process.env.AI_MOCK_ADD ? { ai_added: [{ id: process.env.AI_MOCK_ADD, reason: `{{${process.env.AI_MOCK_ADD}}}는 모두에게 무난해요.` }], summary: [`{{${process.env.AI_MOCK_ADD}}}를 남은 예산 안에서 넣었어요.`] } : { ai_added: [], summary: ["규칙이 정한 일정을 그대로 사용했어요."] };

export async function callModel(ev: Evidence): Promise<string> {
  const mock = process.env.AI_MOCK;
  if (mock === "1") return JSON.stringify(MOCK);
  // fallback 경로 확인용 — 모델이 실제로 이렇게 답하는 경우들을 흉내 낸다
  if (mock === "bad") return "알겠습니다! 아래와 같이 일정을 만들었어요.\n{\"ai_added\": [{\"id\": ";
  if (mock === "halluc")
    return JSON.stringify({ ai_added: [{ id: "kyoto_tower", reason: "교토타워는 평점이 높아요." }],
                            summary: ["1인 72,000원으로 맞췄어요."] });

  const base = process.env.SOMSOM_BASE_URL ?? "https://factchat-cloud.mindlogic.ai/v1/gateway";
  const model = process.env.SOMSOM_MODEL ?? "gpt-4o-mini";
  const timeout = Number(process.env.AI_TIMEOUT_MS ?? 12000);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(`${base}/chat/completions/`, {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.SOMSOM_API_KEY ?? ""}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 1200,
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

/* ══════════ 4. 검증 ══════════ */

const TOPIC_BLOCK = ["호선", "노선", "지하철", "전철", "JR", "평점", "별점", "리뷰", "미슐랭", "웨이팅", "예약 필수", "날씨"];
/** "미도스지선으로 이동" 같은 노선 언급. "동선으로 구성"처럼 평범한 말은 걸리지 않는다 */
const LINE_RE = /[가-힣]{2,}선(을 타|를 타|으로 이동|을 이용|으로 갈아|에서 내)/;
/** 문장에 그대로 나오면 안 되는 입력 JSON 필드 이름 (snake_case) */
const FIELD_RE = /[a-z]{2,}_[a-z_]{2,}/;
const PRIVACY_BLOCK = ["님", "빠듯한 분", "부담스러워하는 분", "체력이 약한", "돈이 없"];

function numbersIn(v: unknown, out = new Set<number>()): Set<number> {
  if (typeof v === "number") out.add(v);
  else if (typeof v === "string") (v.match(/\d+(\.\d+)?/g) ?? []).forEach((n) => out.add(Number(n)));
  else if (Array.isArray(v)) v.forEach((x) => numbersIn(x, out));
  else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => { numbersIn(k, out); numbersIn(x, out); });
  return out;
}
function numbersInText(t: string): number[] {
  const out: number[] = [];
  for (const m of t.replace(/\{\{[^}]+\}\}/g, " ").matchAll(/(\d+(?:\.\d+)?)\s*만(?:\s*(\d+)\s*천)?|(\d[\d,]*(?:\.\d+)?)/g))
    out.push(m[1] ? Number(m[1]) * 10000 + (m[2] ? Number(m[2]) * 1000 : 0) : Number(m[3].replace(/,/g, "")));
  return out;
}

/** 사실 오류 목록. 비어 있어야 AI 결과를 쓴다 */
export function validatePlan(out: PlanOutput, ev: Evidence): string[] {
  const errs: string[] = [];
  const cand = new Map(ev.ai_candidates.map((c) => [c.id, c]));
  const mentionable = new Set([...ev.fixed.map((f) => f.id), ...cand.keys(), ...ev.excluded.map((e) => e.id)]);

  out.ai_added.forEach((a) => { if (!cand.has(a.id)) errs.push(`후보 밖 장소: ${a.id}`); });
  if (out.ai_added.length > ev.ai_slots) errs.push(`추가 ${out.ai_added.length}곳 > 자리 ${ev.ai_slots}곳`);
  const dup = new Set(out.ai_added.map((a) => a.id));
  if (dup.size !== out.ai_added.length) errs.push("같은 장소를 두 번 추가");
  const cost = out.ai_added.reduce((s, a) => s + (cand.get(a.id)?.cost_won ?? 0), 0);
  if (cost > ev.group_limits.remaining_budget_won) errs.push(`추가 비용 ${cost} > 남은 예산 ${ev.group_limits.remaining_budget_won}`);

  const nums = numbersIn(ev);
  [out.ai_added.length, ev.fixed.length, ev.excluded.length, ev.trip.members].forEach((n) => nums.add(n));
  const areas = new Set([...ev.fixed, ...ev.ai_candidates].map((p) => p.area));
  const names = new Map(allPlaces().map((p) => [p.name, p.id]));

  [...out.ai_added.map((a, i) => [`reason[${i}]`, a.reason] as const),
   ...out.summary.map((t, i) => [`summary[${i}]`, t] as const)].forEach(([where, t]) => {
    if (typeof t !== "string") return errs.push(`${where}: 문자열 아님`);
    for (const m of t.matchAll(/\{\{([^}]+)\}\}/g)) if (!mentionable.has(m[1])) errs.push(`${where}: 없는 장소 {{${m[1]}}}`);
    numbersInText(t).forEach((n) => { if (!nums.has(n)) errs.push(`${where}: 입력에 없는 숫자 ${n}`); });
    const plain = t.replace(/\{\{[^}]+\}\}/g, " ");
    names.forEach((id, name) => { if (plain.includes(name) && !mentionable.has(id)) errs.push(`${where}: 없는 장소 이름 ${name}`); });
    [...new Set(allPlaces().map((p) => p.area))].forEach((a) => { if (plain.includes(a) && !areas.has(a)) errs.push(`${where}: 없는 지역 ${a}`); });
    TOPIC_BLOCK.forEach((w) => { if (plain.includes(w)) errs.push(`${where}: 근거 없는 정보 (${w})`); });
    const line = plain.match(LINE_RE);
    if (line) errs.push(`${where}: 근거 없는 교통 정보 (${line[0]})`);
    const field = plain.match(FIELD_RE);
    if (field) errs.push(`${where}: 입력 필드 이름이 문장에 그대로 나옴 (${field[0]})`);
    PRIVACY_BLOCK.forEach((w) => { if (plain.includes(w)) errs.push(`${where}: 개인 지칭 (${w})`); });
  });
  return errs;
}

/** {{id}} → 장소 이름 */
export function render(t: string): string {
  const names = new Map(allPlaces().map((p) => [p.id, p.name]));
  return t.replace(/\{\{([^}]+)\}\}/g, (_, id) => names.get(id) ?? id);
}

/* ══════════ 5. 규칙 결과에 합치기 ══════════ */

export interface Enriched {
  selections: Selection[];
  summary: string;
  ai: { used: boolean; reason: string; added: string[]; errors: string[]; ms: number };
}

/**
 * 규칙 결과 + AI 제안 → 일정 재료.
 * 어떤 경우에도 예외를 던지지 않는다. AI가 실패하면 규칙 결과를 그대로 돌려준다.
 */
export async function enrich(
  res: ConsensusResult, submissions: Submission[], days: number, fallbackSummary: string
): Promise<Enriched> {
  const base = res.selections.filter((s) => !s.aiAdded);
  const off = (reason: string, errors: string[] = [], ms = 0): Enriched =>
    ({ selections: res.selections, summary: fallbackSummary, ai: { used: false, reason, added: [], errors, ms } });

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
      selections: [...base, ...added],
      summary: plan.summary.map(render).join(" "),
      ai: { used: true, reason: "ok", added: added.map((s) => s.place.id), errors: [], ms },
    };
  } catch (e) {
    return off(e instanceof Error ? e.message : "알 수 없는 오류", [], Date.now() - t0);
  }
}
