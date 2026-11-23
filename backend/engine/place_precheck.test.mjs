import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPrecheck, precheckPlaces} from './place_precheck.mjs';
import {calculateRealCandidates} from './real_candidates.mjs';
import {loadInputs} from '../../scripts/validate_real_schedule.mjs';
const {dataset, profiles} = loadInputs();
const ids = ['osaka_009', 'osaka_015'];
const dates = ['2026-10-01', '2026-10-02'];
function context() {
  return {ids, dates, dataset, profiles, budgetKrw: 100000, krwPerJpy: '9.5',
    live: {source: 'google_places', checked_on: '2026-10-01', fetched: 2, reused: 0,
      verdicts: new Map(ids.flatMap(id => dates.map(d => [`${id}|${d}`, []])))}};
}
function responder(checks) {
  return {ok: true, json: async () => ({choices: [{message: {content: JSON.stringify({checks})}}]})};
}
const model = c => async () => responder(buildPrecheck(c).expected);

test('one precheck reviews repeated dates together, returns all supported place-dates, exposes no prompt or key', async () => {
  const c = context(); let count = 0;
  const out = await precheckPlaces(c, {key: 'private-test-key', fetchImpl: async (url, init) => {
    count++; assert.equal(url, 'https://factchat-cloud.mindlogic.ai/v1/gateway/chat/completions/');
    assert.equal(init.redirect, 'error'); assert.equal(init.headers.authorization, 'Bearer private-test-key');
    const body = JSON.parse(init.body), sent = JSON.parse(body.messages[1].content);
    assert.equal(sent.rows.length, 2); assert.deepEqual(sent.rows[0].dates, dates);
    assert.equal(body.temperature, 0); assert.equal(body.max_tokens, 2048);
    assert.ok(!JSON.stringify(sent).includes('osaka_009'));
    return model(c)();
  }});
  assert.equal(count, 1); assert.equal(out.allowed.size, 4); assert.equal(out.audit.source, 'somsom');
  assert.equal(out.audit.place_date_count, 4); assert.match(out.audit.evidence_digest, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(out.audit).includes('private-test-key'));
});

test('closed and missing live hours remain rejected, an AI true cannot clear the hold', async () => {
  const c = context(); c.live.verdicts.set('osaka_009|2026-10-01', ['live_closed_on_visit_date']);
  c.live.verdicts.delete('osaka_015|2026-10-02');
  const out = await precheckPlaces(c, {key: 'k', fetchImpl: model(c)});
  assert.equal(out.allowed.size, 2); assert.equal(out.audit.rejected_place_date_count, 2);
  assert.ok(out.rejected.includes('osaka_009|2026-10-01'));
  await assert.rejects(precheckPlaces(c, {key: 'k', fetchImpl: async () => responder(buildPrecheck(c).expected.map(() => true))}), /AI_PRECHECK_UNAVAILABLE/);
});

test('date holds, unknown IDs, too-short windows and per-place budget excess cannot be promoted', async () => {
  const c = context(); c.ids = [...ids, 'unknown']; c.budgetKrw = 1;
  const facts = buildPrecheck(c);
  assert.deepEqual(facts.expected, [false, true, false]); // Free public visit remains usable.
  const out = await precheckPlaces(c, {key: 'k', fetchImpl: model(c)});
  assert.equal(out.allowed.size, 2);
  assert.ok([...out.allowed].every(key => key.startsWith("osaka_015|")));
  const held = context(); held.profiles = structuredClone(profiles);
  held.profiles.places.osaka_009 = {...held.profiles.places.osaka_009, valid_through: '2026-09-30'};
  assert.equal(buildPrecheck(held).expected[0], false);
  const short = context(); short.profiles = structuredClone(profiles);
  short.profiles.places.osaka_009.window = [600, 601, 600];
  assert.equal(buildPrecheck(short).expected[0], false);
});

test('wrong length, wrong type, false reassurance, extra fields and free prose all abort', async () => {
  const c = context();
  for (const content of ['not JSON', '{"checks":[true]}', '{"checks":["true","true"]}',
    '{"checks":[false,true]}', '{"checks":[true,true],"message":"safe"}']) {
    await assert.rejects(precheckPlaces(c, {key: 'k', fetchImpl: async () => ({ok: true,
      json: async () => ({choices: [{message: {content}}]})})}), /AI_PRECHECK_UNAVAILABLE/);
  }
});

test('missing key, HTTP failure and timeout never report a completed AI review', async () => {
  const c = context();
  await assert.rejects(precheckPlaces(c, {key: '', fetchImpl: () => assert.fail('no call')}), /AI_PRECHECK_UNAVAILABLE/);
  await assert.rejects(precheckPlaces(c, {key: 'k', fetchImpl: async () => ({ok: false})}), /AI_PRECHECK_UNAVAILABLE/);
  await assert.rejects(precheckPlaces(c, {key: 'k', timeoutMs: 5, fetchImpl: (_u, init) => new Promise((_resolve, reject) =>
    init.signal.addEventListener('abort', () => reject(Error('private provider details'))))}), /AI_PRECHECK_UNAVAILABLE/);
});

test('oversized input is rejected before a paid request; rehearsal is labeled mock', async () => {
  const c = context(); c.ids = Array.from({length: 501}, (_, i) => `unknown-${i}`);
  await assert.rejects(precheckPlaces(c, {key: 'k', fetchImpl: () => assert.fail('oversized request')}), /AI_PRECHECK_INPUT_LIMIT/);
  const offline = context(); offline.live.source = 'mock';
  const out = await precheckPlaces(offline, {fetchImpl: () => assert.fail('mock must not call provider')});
  assert.equal(out.audit.source, 'mock');
});

test('engine runs live lookup then precheck then filling/A-B-C, with the same audit on all three', async () => {
  const events = [];
  const request = {startDate: dates[0], endDate: dates[1], exchange_rate: {krw_per_jpy: '9.5', as_of: '2026-09-30'},
    submissions: ['private-member-a', 'private-member-b'].map(memberId => ({memberId, longlist: ids, picks: ids,
      must: ids[0], veto: null, budgetPerDay: 100000, stepLimit: 20000, activeMin: 720}))};
  let input;
  const out = await calculateRealCandidates(request, dataset, profiles, {baseUrl: ''}, {
    liveCheck: async reqs => { events.push('live'); return {source: 'google_places', checked_on: '2026-10-01', fetched: 0, reused: 0,
      verdicts: new Map(reqs.map(r => [`${r.record.place.place_id}|${r.date}`, []]))}; },
    precheckOptions: {key: 'k', fetchImpl: async (_url, init) => {
      events.push('precheck'); input = JSON.parse(JSON.parse(init.body).messages[1].content);
      const checks = input.rows.map(r => r.dataReady && r.liveConfirmed && r.costKrw <= input.budgetKrw
        && r.windows.some(([o,c,l]) => o <= l && o + r.stayMin <= c));
      return responder(checks);
    }},
    choose: async pool => {events.push('fill'); return {source: 'rule_added', picks: pool.map(c => ({id:c.id, reasonCode:'budget_fits'}))};},
  });
  assert.equal(events.filter(e => e === 'precheck').length, 1);
  assert.ok(events.lastIndexOf('live') < events.indexOf('precheck'));
  assert.ok(events.indexOf('fill') > events.indexOf('precheck'));
  assert.equal(out.candidates.length, 3);
  for (const c of out.candidates) assert.deepEqual(c.planning.ai_precheck, out.candidates[0].planning.ai_precheck);
  assert.ok(!JSON.stringify(input).includes('private-member'));
});

test('AI refusal aborts before candidate creation or filling, leaving no partial A/B/C', async () => {
  const request = {startDate: dates[0], endDate: dates[1], exchange_rate: {krw_per_jpy: '9.5'},
    submissions: [{picks: ids, longlist: ids, budgetPerDay: 100000, stepLimit: 20000, activeMin: 720}]};
  await assert.rejects(calculateRealCandidates(request, dataset, profiles, {baseUrl: ''}, {
    liveCheck: async reqs => ({source: 'google_places', checked_on: '2026-10-01', fetched: 0, reused: 0,
      verdicts: new Map(reqs.map(r => [`${r.record.place.place_id}|${r.date}`, []]))}),
    precheckOptions: {key: 'k', fetchImpl: async () => ({ok: false})},
    choose: async () => assert.fail('no A/B/C planning or fill before precheck succeeds'),
  }), /AI_PRECHECK_UNAVAILABLE/);
});
