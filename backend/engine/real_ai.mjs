/** AI fill for real rooms: places nobody listed, suggested for the group's taste, budget and stamina.
 * Same rule as the demo (ai.ts): the model only picks from a code-built pool and attaches a reason
 * code; sentences, numbers and names come from code. Every pick still goes through the caller's
 * date, live and day-limit checks. If the model is off or its answer fails validation,
 * the rule order is used and the items are marked rule_added instead of ai_added.
 */
import {engineCategory} from '../../scripts/validate_real_schedule.mjs';

const POOL_SIZE = 10;
const NEAR_KM = 1.5;

export const REASON_TEXT = {
  similar_to_must: '꼭 가고 싶은 장소로 꼽혔지만 일정에 넣지 못한 곳과 같은 유형의 가까운 장소입니다.',
  group_taste: '구성원들이 고른 장소 유형과 맞고 누구에게도 부담이 크지 않은 장소입니다.',
  budget_fits: '하루 예산 안에서 빈자리를 채울 수 있는 장소입니다.',
};
// Each reason must be backed by the pool entry the code built, not by the model's say-so.
const REASON_OK = {
  similar_to_must: c => c.similar_to_must,
  group_taste: c => c.fit_min >= 0.3,
  budget_fits: c => c.cost_ok,
};

const km = (a, b) => {
  const r = Math.PI / 180, dLat = (b.latitude - a.latitude) * r, dLng = (b.longitude - a.longitude) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
};
const r2 = n => Math.round(n * 100) / 100;

/** Rule-built pool. candidates: [{record, costKrw}] already date-eligible and not listed by anyone.
 * missedMusts: 꼭 가기 records that cannot be scheduled on any trip date. Never sent to the model by ID.
 */
export function buildPool({candidates, submissions, byId, missedMusts, budgetKrw}) {
  const tasteOf = s => {
    const cats = [...s.picks, ...(s.longlist ?? [])].map(id => byId.get(id)?.place.category).filter(Boolean);
    const out = {};
    cats.forEach(c => (out[c] = (out[c] ?? 0) + 1 / cats.length));
    return out;
  };
  const tastes = submissions.map(tasteOf);
  const scored = candidates.map(({record, costKrw}) => {
    const p = record.place;
    const similar = missedMusts.some(m => m.place.category === p.category && km(m.place, p) <= NEAR_KM);
    // ai.ts/utilityOf와 같은 꼴: 취향 + 예산 비중 + 긴 체류 부담. 실제 데이터에 없는 인기도 항은 뺀다
    const fits = submissions.map((s, i) => {
      let u = 0.08 + 0.42 * (tastes[i][p.category] ?? 0) + (similar ? 0.3 : 0);
      const share = s.budgetPerDay ? costKrw / s.budgetPerDay : 0;
      if (share > 0.25) u *= Math.max(0.25, 1 - (share - 0.25) * 2);
      if (p.stay_min > 120 && s.activeMin < 450) u *= 0.8;
      return Math.max(0, Math.min(1, u));
    });
    return {id: p.place_id, name: p.name_ko || p.name, category: engineCategory(p.category), cost_krw: costKrw,
      stay_min: p.stay_min, fit_avg: r2(fits.reduce((a, b) => a + b, 0) / fits.length), fit_min: r2(Math.min(...fits)),
      similar_to_must: similar, cost_ok: costKrw <= budgetKrw};
  }).filter(c => c.cost_ok && c.fit_min >= 0.2)
    .sort((a, b) => Number(b.similar_to_must) - Number(a.similar_to_must) || b.fit_avg - a.fit_avg || a.id.localeCompare(b.id));
  // 비슷한 곳을 먼저 두되 한 유형으로 몰리지 않게 유형별로 돌아가며 뽑는다
  const byCat = new Map();
  scored.forEach(c => byCat.set(c.category, [...(byCat.get(c.category) ?? []), c]));
  const pool = [];
  while (pool.length < POOL_SIZE && [...byCat.values()].some(v => v.length)) {
    for (const list of byCat.values()) if (list.length && pool.length < POOL_SIZE) pool.push(list.shift());
  }
  return pool;
}

const SYSTEM_PROMPT = `당신은 그룹 여행 일정의 빈자리를 채울 장소를 고르는 도우미입니다.
입력의 candidates 중에서만 고르고, 최대 slots개를 추천 순서대로 ai_added에 넣습니다.
고른 곳마다 reason_code를 하나 붙입니다: similar_to_must(similar_to_must가 true일 때만), group_taste(fit_min이 0.3 이상일 때만), budget_fits.
목록에 없는 장소, 자유 문장, 숫자를 만들지 않습니다. JSON 한 개만 출력합니다.
{"ai_added":[{"id":"...","reason_code":"..."}]}`;

async function callModel(input) {
  const mock = process.env.AI_MOCK;
  if (mock === 'halluc') return JSON.stringify({ai_added: [{id: 'kyoto_tower', reason_code: 'budget_fits'}]});
  if (mock === 'bad') return '{"ai_added": [';
  if (mock) return JSON.stringify({ai_added: input.candidates.slice(0, input.slots).map(c =>
    ({id: c.id, reason_code: c.similar_to_must ? 'similar_to_must' : 'budget_fits'}))});
  const base = process.env.SOMSOM_BASE_URL ?? 'https://factchat-cloud.mindlogic.ai/v1/gateway';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Number(process.env.AI_TIMEOUT_MS ?? 12000));
  try {
    const r = await fetch(`${base}/chat/completions/`, {method: 'POST', signal: ctl.signal,
      headers: {'content-type': 'application/json', authorization: `Bearer ${process.env.SOMSOM_API_KEY ?? ''}`},
      body: JSON.stringify({model: process.env.SOMSOM_MODEL ?? 'gemini-3.5-flash-lite', temperature: 0, max_tokens: 400,
        response_format: {type: 'json_object'},
        messages: [{role: 'system', content: SYSTEM_PROMPT}, {role: 'user', content: JSON.stringify(input)}]})});
    const data = await r.json();
    if (!r.ok) throw Error(`HTTP ${r.status}`);
    return data.choices?.[0]?.message?.content ?? '';
  } finally { clearTimeout(timer); }
}

/** Validated model order → [{id, reasonCode}] and source 'ai_added'; otherwise rule order, 'rule_added'. */
export async function choose(pool, slots) {
  const ruleOrder = {source: 'rule_added', picks: pool.map(c => ({id: c.id,
    reasonCode: c.similar_to_must ? 'similar_to_must' : c.fit_min >= 0.3 ? 'group_taste' : 'budget_fits'}))};
  if (!pool.length || !slots || (!process.env.SOMSOM_API_KEY && !process.env.AI_MOCK)) return ruleOrder;
  try {
    // 모델에는 장소 정보와 그룹 집계만 준다. 누가 무엇을 골랐는지·개인 한도는 보내지 않는다
    const candidates = pool.map(({cost_ok, ...c}) => c);
    const text = await callModel({slots, candidates});
    const out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const byId = new Map(pool.map(c => [c.id, c]));
    const picks = out?.ai_added;
    if (!Array.isArray(picks) || !picks.length || picks.length > slots) return ruleOrder;
    if (new Set(picks.map(p => p?.id)).size !== picks.length) return ruleOrder;
    for (const p of picks) {
      const c = byId.get(p?.id);
      if (!c || !Object.hasOwn(REASON_OK, p.reason_code) || !REASON_OK[p.reason_code](c)) return ruleOrder;
    }
    // 모델이 고른 순서 뒤에 나머지 규칙 순서를 붙여, 검사에서 떨어진 자리를 규칙 후보가 이어받게 한다
    const chosen = new Set(picks.map(p => p.id));
    return {source: 'ai_added', picks: picks.map(p => ({id: p.id, reasonCode: p.reason_code})),
      backup: ruleOrder.picks.filter(p => !chosen.has(p.id))};
  } catch { return ruleOrder; }
}
