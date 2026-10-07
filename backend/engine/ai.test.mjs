import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConsensus, travel } from './consensus.ts';
import { allPlaces } from './places.ts';
import { buildEvidence, buildPlanSchedule, validatePlan, validateScheduledPlan, renderSummary } from './ai.ts';

const subs = [
  { memberId: 'm1', longlist: [], picks: ['glico', 'kuromon', 'umeda_sky', 'nakazaki', 'ichiran'], must: 'umeda_sky', veto: 'shinsaibashi', budgetPerDay: 75000, stepLimit: 8500, activeMin: 480 },
  { memberId: 'm2', longlist: [], picks: ['osaka_castle', 'kaiyukan', 'tempozan', 'glico', 'rikuro'], must: 'kaiyukan', veto: 'usj', budgetPerDay: 70000, stepLimit: 7000, activeMin: 360 },
  { memberId: 'm3', longlist: [], picks: ['nakazaki', 'amemura', 'nmao', 'osaka_castle', 'kuromon'], must: 'osaka_castle', veto: null, budgetPerDay: 100000, stepLimit: 13000, activeMin: 540 },
];
const res = buildConsensus({ submissions: subs, nights: 3, strategy: 'fairness', allowPartial: true });
const ev = buildEvidence(res, subs, 4);
const selection = (id, reason_code = 'budget_fits') => ({ ai_added: [{ id, reason_code }], summary: ['ai_filled'] });
const empty = (summary) => ({ ai_added: [], summary });
const candidate = ev.ai_candidates[0].id;

for (const code of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 1, null, ['must_kept']]) {
  test(`reject undeclared summary/reason ${JSON.stringify(code)}`, () => {
    assert.ok(validatePlan(empty([code]), ev).length);
    assert.ok(validatePlan(selection(candidate, code), ev).length);
  });
}

test('malformed AI entries return validation errors, never throw', () => {
  for (const entry of [null, {}, 42, { id: candidate, reason_code: {} }]) {
    assert.ok(validatePlan({ ai_added: [entry], summary: ['ai_filled'] }, ev).length);
  }
});

test('category_gap rejects the reported existing landmark category', () => {
  assert.ok(ev.fixed.some((f) => f.tier === 'core' && f.category === 'landmark'));
  assert.ok(validatePlan(selection('shinsekai', 'category_gap'), ev).some((e) => e.includes('category_gap')));
});

test('category_gap allows a new category but rejects duplicate additions of it', () => {
  const evidence = structuredClone(ev);
  evidence.fixed = evidence.fixed.filter((f) => f.category !== ev.ai_candidates[0].category);
  assert.deepEqual(validatePlan(selection(candidate, 'category_gap'), evidence), []);
  evidence.ai_candidates.push({ ...ev.ai_candidates[0], id: 'second-same-category' });
  evidence.ai_slots = 2;
  const out = selection(candidate, 'category_gap');
  out.ai_added.push({ id: 'second-same-category', reason_code: 'budget_fits' });
  assert.ok(validatePlan(out, evidence).some((e) => e.includes('category_gap')));
});

test('near_fixed requires a nearby fixed place; fit and cost reasons also require evidence', () => {
  const evidence = structuredClone(ev);
  evidence.ai_candidates[0].near_fixed_ids = [];
  assert.ok(validatePlan(selection(candidate, 'near_fixed'), evidence).some((e) => e.includes('near_fixed')));
  evidence.ai_candidates[0].fit_min = 0.19;
  assert.ok(validatePlan(selection(candidate, 'no_one_dislikes'), evidence).some((e) => e.includes('no_one_dislikes')));
  evidence.ai_candidates[0].cost_won = evidence.group_limits.remaining_budget_won + 1;
  assert.ok(validatePlan(selection(candidate), evidence).some((e) => e.includes('budget_fits')));
});

test('empty choices with free slots do not mean no_room; truly full input does', () => {
  assert.equal(ev.ai_slots, 1);
  assert.ok(ev.ai_candidates.length);
  assert.ok(validatePlan(empty(['no_room']), ev).length);
  assert.deepEqual(validatePlan(empty(['no_room']), { ...ev, ai_slots: 0 }), []);
  assert.ok(validatePlan(selection(candidate), { ...ev, ai_slots: 0 }).length);
});

const musts = ['usj', 'kaiyukan', 'science_museum'];
const tight = musts.map((must, i) => ({ memberId: `m${i}`, longlist: musts, picks: musts, must, veto: null,
  budgetPerDay: 200000, stepLimit: 1000, activeMin: 600 }));
const tightRes = buildConsensus({ submissions: tight, nights: 0, strategy: 'fairness', allowPartial: true });
const tightEv = buildEvidence(tightRes, tight, 1);
const tightPlan = empty(['must_kept', 'walk_limited']);
const tightSchedule = buildPlanSchedule(tightPlan, tightRes, tight, 1).schedule;

test('final schedule rejects missing musts and exceeded walking limit from the review', () => {
  assert.deepEqual(validatePlan(tightPlan, tightEv), []);
  const errors = validateScheduledPlan(tightPlan, tightEv, tightSchedule);
  assert.ok(errors.some((e) => e.includes('꼭 가고 싶은 장소 누락')));
  assert.ok(errors.some((e) => e.includes('도보 한도 초과')));
  assert.throws(() => renderSummary(tightPlan, tightEv, tightSchedule));
  assert.throws(() => renderSummary(tightPlan, tightEv), /최종 일정/);
});

test('automatic meals count toward final cost; rounded day walking totals cannot hide overflow', () => {
  const evidence = structuredClone(tightEv);
  evidence.fixed = evidence.fixed.filter((f) => f.id === 'usj');
  const items = tightSchedule.plans[0].items;
  assert.ok(items.some((it) => it.tier === 'filled'));
  evidence.group_limits.budget_per_person_won = items[0].place.cost;
  assert.ok(validateScheduledPlan(empty(['must_kept']), evidence, tightSchedule).some((e) => e.includes('비용')));
  evidence.group_limits.budget_per_person_won = 1000000;
  const walk = items.reduce((km, it, i) => km + (i ? travel(items[i - 1].place, it.place).walkKm : 0), 0);
  evidence.group_limits.walk_km_per_day = walk - 0.001;
  const rounded = structuredClone(tightSchedule);
  rounded.plans[0].walkKm = evidence.group_limits.walk_km_per_day;
  assert.ok(validateScheduledPlan(empty(['walk_limited']), evidence, rounded).some((e) => e.includes('도보')));
});

test('an AI venue removed during time placement cannot be described as added', () => {
  const out = selection(candidate);
  const schedule = buildPlanSchedule(out, res, subs, 4).schedule;
  schedule.plans.forEach((day) => { day.items = day.items.filter((it) => it.place.id !== candidate); });
  assert.ok(validateScheduledPlan(out, ev, schedule).some((e) => e.includes('AI 추가 장소 누락')));
});

test('near_fixed must still be nearby on the same scheduled day', () => {
  const castle = allPlaces().find((p) => p.id === 'osaka_castle');
  const park = allPlaces().find((p) => p.id === 'castle_park');
  assert.equal(travel(castle, park).mode, 'walk');
  const evidence = structuredClone(ev);
  evidence.fixed = [{ ...evidence.fixed[0], id: castle.id, tier: 'core', reason: 'votes', category: castle.category }];
  evidence.ai_candidates = [{ ...evidence.ai_candidates[0], id: park.id, cost_won: park.cost, near_fixed_ids: [castle.id] }];
  const out = selection(park.id, 'near_fixed');
  const day = (places) => ({ items: places.map((place) => ({ place })) });
  assert.ok(validateScheduledPlan(out, evidence, { plans: [day([castle]), day([park])], dropped: [] }).some((e) => e.includes('near_fixed')));
  assert.deepEqual(validateScheduledPlan(out, evidence, { plans: [day([castle, park])], dropped: [] }), []);
});

// Run the actual JSON CLI with an in-process fetch stub. No key, paid call or external network is used.
function runCLI(submissions, plan) {
  const temp = mkdtempSync(join(tmpdir(), 'pr34-ai-'));
  try {
    const stub = join(temp, 'stub.mjs');
    writeFileSync(stub, `globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: ${JSON.stringify(JSON.stringify(plan))} } }] }) });`);
    const env = { ...process.env, SOMSOM_API_KEY: 'offline-test', AI_DEBUG: '1' };
    delete env.AI_MOCK;
    const result = spawnSync(process.execPath, ['--import', stub, fileURLToPath(new URL('./run.mjs', import.meta.url))], {
      env, encoding: 'utf8', timeout: 10000,
      input: JSON.stringify({ strategy: 'fairness', startDate: '2026-10-06', endDate: '2026-10-06',
        members: submissions.map((s) => ({ id: s.memberId, name: s.memberId })), submissions }),
    });
    assert.equal(result.status, 0, result.stderr);
    return { result: JSON.parse(result.stdout), ai: JSON.parse(result.stderr.trim()) };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

test('actual run.mjs falls back instead of publishing false must/walking claims', () => {
  const { result, ai } = runCLI(tight, tightPlan);
  assert.equal(ai.used, false);
  assert.equal(ai.reason, '최종 일정 검증 실패');
  assert.match(result.summary, /제약 충족은 아직 보장하지 않습니다/);
  assert.doesNotMatch(result.summary, /모두 지켰어요|이내로 배치/);
  assert.deepEqual(Object.keys(result).sort(), ['days', 'strategy', 'summary']);
});

test('actual run.mjs still uses valid AI output after final validation', () => {
  const simple = ['a', 'b'].map((memberId) => ({ memberId, longlist: ['glico'], picks: ['glico'], must: 'glico', veto: null,
    budgetPerDay: 100000, stepLimit: 20000, activeMin: 600 }));
  const { result, ai } = runCLI(simple, empty(['must_kept', 'walk_limited']));
  assert.equal(ai.used, true, JSON.stringify(ai));
  assert.ok(result.days[0].placeIds.includes('glico'));
  assert.match(result.summary, /1곳의 '꼭 가고 싶은 곳'은 모두 지켰어요/);
});

test('actual run.mjs retains a valid AI-added venue and its explanation', () => {
  const simple = ['a', 'b'].map((memberId) => ({ memberId, longlist: ['glico'], picks: ['glico'], must: 'glico', veto: null,
    budgetPerDay: 100000, stepLimit: 20000, activeMin: 600 }));
  const consensus = buildConsensus({ submissions: simple, nights: 0, strategy: 'fairness', allowPartial: true });
  const evidence = buildEvidence(consensus, simple, 1);
  const chosen = evidence.ai_candidates.find((c) => {
    const out = selection(c.id, 'no_one_dislikes');
    return validateScheduledPlan(out, evidence, buildPlanSchedule(out, consensus, simple, 1).schedule).length === 0;
  });
  assert.ok(chosen, 'fixture must have at least one schedulable candidate');
  const { result, ai } = runCLI(simple, selection(chosen.id, 'no_one_dislikes'));
  assert.equal(ai.used, true, JSON.stringify(ai));
  assert.deepEqual(ai.added, [chosen.id]);
  assert.ok(result.days[0].placeIds.includes(chosen.id));
  assert.ok(result.summary.includes(chosen.name));
});
