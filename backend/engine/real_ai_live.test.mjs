import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {calculateRealCandidates} from './real_candidates.mjs';
import {googleLiveCheck, judge, mockLiveCheck, UNAVAILABLE} from './live_check.mjs';
import {choose} from './real_ai.mjs';
import {loadInputs, validateDay} from '../../scripts/validate_real_schedule.mjs';
const {dataset, profiles} = loadInputs();
const request = (ids, {days = 1, must = null, veto = null} = {}) => ({startDate: '2026-10-01',
  endDate: `2026-10-0${days}`, exchange_rate: {krw_per_jpy: '9.5', as_of: '2026-09-30'},
  submissions: ['private-a', 'private-b'].map(memberId => ({memberId, longlist: ids, picks: ids, must, veto,
    budgetPerDay: 100000, stepLimit: 20000, activeMin: 720, tradeoffs: {pace: 1, distance: 0.5, spend: 1}}))});
const listedIn = r => new Set(r.submissions.flatMap(s => [...s.picks, ...s.longlist]));
const withEnv = async (env, fn) => {
  const saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.entries(env).forEach(([k, v]) => v === undefined ? delete process.env[k] : process.env[k] = v);
  try { return await fn(); } finally { Object.entries(saved).forEach(([k, v]) => v === undefined ? delete process.env[k] : process.env[k] = v); }
};
const failing = ids => async reqs => ({source: 'mock', checked_on: null, verdicts: new Map(reqs.map(r =>
  [`${r.record.place.place_id}|${r.date}`, ids.includes(r.record.place.place_id) ? ['live_closed_permanently'] : []]))});

/* ── live verdicts ── */
const hours = (open, close) => ({periods: [0, 1, 2, 3, 4, 5, 6].map(day => ({open: {day, hour: open, minute: 0}, close: {day, hour: close, minute: 0}}))});
test('live judge: unchanged hours pass; closed, shorter, missing or unknown hours fail', () => {
  const ok = {businessStatus: 'OPERATIONAL', regularOpeningHours: hours(9, 21)};
  assert.deepEqual(judge(ok, '2026-12-01', [600, 1200, 1140], '2026-11-04'), []);
  assert.deepEqual(judge({...ok, businessStatus: 'CLOSED_PERMANENTLY'}, '2026-12-01', [600, 1200, 1140], '2026-11-04'), ['live_closed_permanently']);
  assert.deepEqual(judge({...ok, businessStatus: 'CLOSED_TEMPORARILY'}, '2026-12-01', [600, 1200, 1140], '2026-11-04'), ['live_closed_temporarily']);
  assert.deepEqual(judge({businessStatus: 'OPERATIONAL', regularOpeningHours: hours(11, 21)}, '2026-12-01', [600, 1200, 1140], '2026-11-04'), ['live_hours_changed']);
  assert.deepEqual(judge({businessStatus: 'OPERATIONAL'}, '2026-12-01', [600, 1200, 1140], '2026-11-04'), ['live_hours_unavailable']);
  assert.deepEqual(judge(null, '2026-12-01', [600, 1200, 1140], '2026-11-04'), ['live_lookup_failed']);
  // 24시간 영업, 점심·저녁 사이 쉬는 시간
  assert.deepEqual(judge({businessStatus: 'OPERATIONAL', regularOpeningHours: {periods: [{open: {day: 0, hour: 0, minute: 0}}]}}, '2026-12-01', [0, 1440, 1380], '2026-11-04'), []);
  const split = {businessStatus: 'OPERATIONAL', regularOpeningHours: {periods: [
    {open: {day: 2, hour: 11, minute: 0}, close: {day: 2, hour: 15, minute: 0}}, {open: {day: 2, hour: 17, minute: 0}, close: {day: 2, hour: 22, minute: 0}}]}};
  assert.deepEqual(judge(split, '2026-12-01', [660, 1320, 1260], '2026-11-04'), ['live_hours_changed']);
  assert.deepEqual(judge(split, '2026-12-01', [1020, 1320, 1260], '2026-11-04'), []);
});

test('live judge: within 7 days the dated current hours (special closures) decide', () => {
  const d = {year: 2026, month: 11, day: 6};
  const current = {periods: [{open: {day: 5, hour: 9, minute: 0, date: d}, close: {day: 5, hour: 21, minute: 0, date: d}}]};
  const place = {businessStatus: 'OPERATIONAL', regularOpeningHours: hours(9, 21), currentOpeningHours: current};
  assert.deepEqual(judge(place, '2026-11-06', [600, 1200, 1140], '2026-11-04'), []);
  // 11/7(토)은 정규시간상 영업하지만 이번 주 특별 휴무라 현재 영업시간에 없다
  assert.deepEqual(judge(place, '2026-11-07', [600, 1200, 1140], '2026-11-04'), ['live_closed_on_visit_date']);
  // 7일 밖은 정규시간 대조
  assert.deepEqual(judge(place, '2026-11-14', [600, 1200, 1140], '2026-11-04'), []);
});

test('Google lookup: no key stops, far match fails, details are cached, the key never goes elsewhere', async () => {
  const record = dataset.places.find(r => r.place.place_id === 'osaka_009');
  const reqs = [{record, date: '2026-10-01', window: [600, 1200, 1140]}];
  await assert.rejects(googleLiveCheck({key: ''})(reqs), new RegExp(UNAVAILABLE));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-'));
  const cacheUrl = pathToFileURL(path.join(dir, 'cache.json'));
  const calls = [];
  const fake = near => async (url, init) => {
    calls.push({url, redirect: init.redirect, key: init.headers['X-Goog-Api-Key']});
    const lat = record.place.latitude + (near ? 0.0002 : 0.01);
    const body = url.endsWith(':searchText') ? {places: [{id: 'g1', displayName: {text: record.place.name}, location: {latitude: lat, longitude: record.place.longitude}}]}
      : {id: 'g1', businessStatus: 'OPERATIONAL', regularOpeningHours: hours(0, 23)};
    return {ok: true, json: async () => body};
  };
  const far = await googleLiveCheck({key: 'k', fetchImpl: fake(false), cacheUrl: pathToFileURL(path.join(dir, 'far.json'))})(reqs);
  assert.deepEqual(far.verdicts.get('osaka_009|2026-10-01'), ['live_no_match']);
  calls.length = 0;
  const first = await googleLiveCheck({key: 'k', fetchImpl: fake(true), cacheUrl})(reqs);
  assert.deepEqual(first.verdicts.get('osaka_009|2026-10-01'), []);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => c.redirect === 'error' && c.key === 'k' && c.url.startsWith('https://places.googleapis.com/v1/')));
  await googleLiveCheck({key: 'k', fetchImpl: fake(true), cacheUrl})(reqs);
  assert.equal(calls.length, 2, 'second run reuses the cached ID and same-day details');
  const cached = JSON.parse(fs.readFileSync(cacheUrl, 'utf8'));
  assert.equal(cached.ids.osaka_009, 'g1');
  assert.ok(!JSON.stringify(cached).includes('"k"'));
  // HTTP 오류는 재시도 없이 실패로 본다
  const errors = await googleLiveCheck({key: 'k', fetchImpl: async () => ({ok: false, json: async () => ({})}),
    cacheUrl: pathToFileURL(path.join(dir, 'err.json'))})(reqs);
  assert.deepEqual(errors.verdicts.get('osaka_009|2026-10-01'), ['live_lookup_failed']);
});

test('Google lookup: an address result is not the place; the same-name result wins over a closer one', async () => {
  const record = dataset.places.find(r => r.place.place_id === 'osaka_009');
  const reqs = [{record, date: '2026-10-01', window: [600, 1200, 1140]}];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-'));
  const {latitude: lat, longitude: lng} = record.place;
  const queries = [];
  const fake = async (url, init) => {
    if (!url.endsWith(':searchText')) return {ok: true, json: async () => ({id: 'castle', businessStatus: 'OPERATIONAL', regularOpeningHours: hours(9, 21)})};
    queries.push(JSON.parse(init.body).textQuery);
    return {ok: true, json: async () => ({places: [
      {id: 'addr', displayName: {text: '大阪城１−１'}, types: ['premise'], location: {latitude: lat, longitude: lng}},
      {id: 'park', displayName: {text: '大阪城公園'}, types: ['park'], location: {latitude: lat + 0.0001, longitude: lng}},
      {id: 'castle', displayName: {text: '大阪城'}, types: ['tourist_attraction'], location: {latitude: lat + 0.0008, longitude: lng}}]})};
  };
  const out = await googleLiveCheck({key: 'k', fetchImpl: fake, cacheUrl: pathToFileURL(path.join(dir, 'c.json'))})(reqs);
  assert.deepEqual(out.verdicts.get('osaka_009|2026-10-01'), []);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'c.json'), 'utf8')).ids.osaka_009, 'castle');
  assert.deepEqual(queries, ['大阪城'], 'name-only query is tried first and is enough');
});

// 리뷰 #63 P1: 이름이 다른 가까운 가게의 영업 정보로 통과시키지 않는다
test('Google lookup: a nearby shop under another name is never the same place', async () => {
  const record = structuredClone(dataset.places.find(r => r.place.place_id === 'osaka_009'));
  record.place.name = '対象店舗A';
  const reqs = [{record, date: '2026-10-01', window: [600, 1200, 1140]}];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-'));
  const cacheUrl = pathToFileURL(path.join(dir, 'c.json'));
  const queries = [];
  const fake = async (url, init) => {
    if (!url.endsWith(':searchText')) throw Error('details must not be fetched for another shop');
    queries.push(JSON.parse(init.body).textQuery);
    return {ok: true, json: async () => ({places: [{id: 'shopB', displayName: {text: '別ブランドB'}, types: ['store'],
      location: {latitude: record.place.latitude + 0.0001, longitude: record.place.longitude}}]})};
  };
  const out = await googleLiveCheck({key: 'k', fetchImpl: fake, cacheUrl})(reqs);
  assert.deepEqual(out.verdicts.get('osaka_009|2026-10-01'), ['live_no_match']);
  assert.equal(queries.length, 2, 'name+address is tried before giving up');
  assert.deepEqual(JSON.parse(fs.readFileSync(cacheUrl, 'utf8')).ids, {}, 'nothing is cached for a non-match');
  // 표기 차이(공백·가운뎃점)는 같은 이름, 포함 관계는 다른 이름
  record.place.name = '丸福珈琲店 千日前本店';
  const spaced = async url => ({ok: true, json: async () => url.endsWith(':searchText')
    ? {places: [{id: 'p', displayName: {text: '丸福珈琲店・千日前本店'}, location: {latitude: record.place.latitude, longitude: record.place.longitude}}]}
    : {businessStatus: 'OPERATIONAL', regularOpeningHours: hours(9, 21)}});
  assert.deepEqual((await googleLiveCheck({key: 'k', fetchImpl: spaced, cacheUrl: pathToFileURL(path.join(dir, 's.json'))})(reqs)).verdicts.get('osaka_009|2026-10-01'), []);
  record.place.name = '大阪城';
  const park = async () => ({ok: true, json: async () => ({places: [{id: 'park', displayName: {text: '大阪城公園'}, location: {latitude: record.place.latitude, longitude: record.place.longitude}}]})});
  assert.deepEqual((await googleLiveCheck({key: 'k', fetchImpl: park, cacheUrl: pathToFileURL(path.join(dir, 'p.json'))})(reqs)).verdicts.get('osaka_009|2026-10-01'), ['live_no_match']);
});

// 리뷰 #63 P2: 전날 시작해 방문일까지 이어지는 영업
test('live judge: a period that opened the day before and runs past midnight covers early hours', () => {
  // 2026-12-01은 화요일(day 2). 월 22:00 → 화 06:00
  const weekly = {businessStatus: 'OPERATIONAL', regularOpeningHours: {periods: [{open: {day: 1, hour: 22, minute: 0}, close: {day: 2, hour: 6, minute: 0}}]}};
  assert.deepEqual(judge(weekly, '2026-12-01', [60, 120, 90], '2026-11-04'), []);
  assert.deepEqual(judge(weekly, '2026-12-01', [60, 480, 400], '2026-11-04'), ['live_hours_changed']);
  // 토 22:00 → 일 06:00: 주가 넘어가도 전날로 본다 (2026-12-06은 일요일)
  const wrap = {businessStatus: 'OPERATIONAL', regularOpeningHours: {periods: [{open: {day: 6, hour: 22, minute: 0}, close: {day: 0, hour: 6, minute: 0}}]}};
  assert.deepEqual(judge(wrap, '2026-12-06', [60, 120, 90], '2026-11-04'), []);
  const d = (day) => ({year: 2026, month: 11, day});
  const dated = {businessStatus: 'OPERATIONAL', regularOpeningHours: weekly.regularOpeningHours, currentOpeningHours: {periods: [
    {open: {day: 4, hour: 22, minute: 0, date: d(5)}, close: {day: 5, hour: 6, minute: 0, date: d(6)}}]}};
  assert.deepEqual(judge(dated, '2026-11-06', [60, 120, 90], '2026-11-04'), []);
  // 당일 저녁에 열어 다음 날 새벽에 닫는 영업도 당일 몫은 그대로
  assert.deepEqual(judge(dated, '2026-11-05', [1380, 1440, 1410], '2026-11-04'), []);
});

// 리뷰 #63 P2: 날짜가 바뀌면 같은 응답을 재사용하지 않는다
test('Google lookup: details fetched before Japan midnight are refetched after it', async () => {
  const record = dataset.places.find(r => r.place.place_id === 'osaka_009');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-'));
  const cacheUrl = pathToFileURL(path.join(dir, 'c.json'));
  let details = 0;
  const fake = async url => {
    if (url.endsWith(':searchText')) return {ok: true, json: async () => ({places: [{id: 'g', displayName: {text: record.place.name}, location: {latitude: record.place.latitude, longitude: record.place.longitude}}]})};
    details++;
    return {ok: true, json: async () => ({businessStatus: 'OPERATIONAL', regularOpeningHours: hours(0, 23)})};
  };
  const at = iso => () => new Date(iso);
  const reqs = [{record, date: '2026-11-11', window: [600, 1200, 1140]}];
  const night = await googleLiveCheck({key: 'k', fetchImpl: fake, cacheUrl, now: at('2026-11-04T14:59:00Z')})(reqs); // JST 23:59
  assert.equal(night.checked_on, '2026-11-04');
  assert.deepEqual([night.fetched, night.reused, details], [1, 0, 1]);
  const again = await googleLiveCheck({key: 'k', fetchImpl: fake, cacheUrl, now: at('2026-11-04T14:59:30Z')})(reqs);
  assert.deepEqual([again.fetched, again.reused, details], [0, 1, 1], 'same Japan date reuses');
  const next = await googleLiveCheck({key: 'k', fetchImpl: fake, cacheUrl, now: at('2026-11-04T15:01:00Z')})(reqs); // JST 11/5 00:01
  assert.equal(next.checked_on, '2026-11-05');
  assert.deepEqual([next.fetched, next.reused, details], [1, 0, 2], 'new Japan date refetches');
  // 11/11은 11/4 응답의 7일 범위 밖, 11/5 응답의 범위 안: 판정 기준은 응답을 받은 날이다
  assert.deepEqual(judge({businessStatus: 'OPERATIONAL', regularOpeningHours: hours(9, 21), currentOpeningHours: {periods: []}}, '2026-11-11', [600, 1200, 1140], '2026-11-04'), []);
  // 예전 버전 캐시(느슨한 매칭으로 저장한 ID)는 버린다
  fs.writeFileSync(path.join(dir, 'old.json'), JSON.stringify({ids: {osaka_009: 'wrong'}, details: {}}));
  const seen = [];
  await googleLiveCheck({key: 'k', fetchImpl: async (url, init) => { seen.push(url); return fake(url, init); }, cacheUrl: pathToFileURL(path.join(dir, 'old.json'))})(reqs);
  assert.ok(seen[0].endsWith(':searchText') && !seen.some(u => u.includes('wrong')));
});

/* ── schedule integration ── */
test('a place that fails the live check is never placed and is explained as a live reason', async () => {
  const r = request(['osaka_009', 'osaka_015', 'osaka_017']);
  const {candidates} = await calculateRealCandidates(r, dataset, profiles, {baseUrl: ''}, {liveCheck: failing(['osaka_015']), choose: null});
  for (const c of candidates) {
    assert.ok(!c.days.flatMap(d => d.placeIds).includes('osaka_015'));
    assert.equal(c.planning.exclusion_reason_counts.live_closed_permanently, 1);
    assert.equal(c.planning.live_check.failed_place_count, 1);
    assert.match(c.summary, /실시간 확인을 통과하지 못한 1곳/);
  }
  await assert.rejects(calculateRealCandidates(r, dataset, profiles, {baseUrl: ''},
    {liveCheck: failing(['osaka_009', 'osaka_015', 'osaka_017']), choose: null}), /NO_SCHEDULABLE_REAL_CANDIDATE/);
});

test('without the model, rules fill empty slots with unlisted places that pass every check', async () => {
  const r = request(['osaka_009'], {days: 3});
  await withEnv({SOMSOM_API_KEY: undefined, AI_MOCK: undefined}, async () => {
    const {candidates} = await calculateRealCandidates(r, dataset, profiles, {baseUrl: ''}, {liveCheck: mockLiveCheck('pass')});
    for (const c of candidates) {
      const added = c.days.flatMap(d => d.items).filter(i => i.aiAdded);
      assert.ok(added.length > 0);
      assert.ok(added.every(i => i.source === 'rule_added' && !listedIn(r).has(i.placeId) && i.reason.includes('실시간 영업 확인')));
      assert.equal(c.planning.ai_fill.source, 'rule_added');
      assert.equal(c.planning.ai_fill.added_count, added.length);
      assert.equal(c.planning.empty_day_count, 0);
      assert.match(c.summary, /규칙이 추가/);
      for (const d of c.days) {
        const v = validateDay({date: d.date, place_ids: d.placeIds, budget_krw: 100000, step_limit: 20000, active_min: 720, krw_per_jpy: '9.5'},
          dataset, profiles, {allowShopping: true, candidateMetrics: true, distanceWeight: 1.2});
        assert.equal(v.passed_model_checks, true);
        assert.ok(d.placeIds.length <= 4); // pace 1 → 하루 4자리
      }
    }
  });
});

test('validated model picks are ai_added; hallucinated or broken answers fall back to rules', async () => {
  const r = request(['osaka_009'], {days: 2});
  for (const [mock, source] of [['1', 'ai_added'], ['halluc', 'rule_added'], ['bad', 'rule_added']]) {
    await withEnv({AI_MOCK: mock}, async () => {
      const {candidates} = await calculateRealCandidates(r, dataset, profiles, {baseUrl: ''}, {liveCheck: mockLiveCheck('pass')});
      assert.equal(candidates[0].planning.ai_fill.source, source, mock);
      assert.ok(candidates[0].days.flatMap(d => d.items).some(i => i.source === source));
      assert.ok(!JSON.stringify(candidates).includes('kyoto_tower'));
    });
  }
});

test('a must that cannot be placed pulls in a similar nearby place of the same type', async () => {
  const must = 'osaka_015';
  const r = request(['osaka_009', must], {days: 2, must});
  await withEnv({SOMSOM_API_KEY: undefined, AI_MOCK: undefined}, async () => {
    const {candidates} = await calculateRealCandidates(r, dataset, profiles, {baseUrl: ''}, {liveCheck: failing([must])});
    const added = candidates[0].days.flatMap(d => d.items).filter(i => i.aiAdded);
    const category = dataset.places.find(p => p.place.place_id === must).place.category;
    const similar = added.filter(i => i.reasonCode === 'similar_to_must');
    assert.ok(similar.length > 0);
    assert.ok(similar.every(i => dataset.places.find(p => p.place.place_id === i.placeId).place.category === category));
    assert.equal(candidates[0].planning.must_satisfied, false);
  });
});

test('AI fill never adds a vetoed place, and the model sees no member IDs or limits', async () => {
  const pool = [{id: 'x', name: 'X', category: 'cafe', cost_krw: 0, stay_min: 60, fit_avg: 0.5, fit_min: 0.4, similar_to_must: false, cost_ok: true}];
  let seen;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => { seen = init.body; return {ok: true, json: async () => ({choices: [{message: {content: '{"ai_added":[{"id":"x","reason_code":"group_taste"}]}'}}]})}; };
  try {
    await withEnv({SOMSOM_API_KEY: 'test', AI_MOCK: undefined}, async () => {
      const out = await choose(pool, 1);
      assert.equal(out.source, 'ai_added');
    });
  } finally { globalThis.fetch = realFetch; }
  for (const key of ['private-', 'budgetPerDay', 'stepLimit', 'cost_ok', 'memberId']) assert.ok(!seen.includes(key), key);
  // 근거 없는 이유 코드는 버린다
  const noBasis = await withEnv({AI_MOCK: undefined, SOMSOM_API_KEY: undefined}, () => choose(pool, 1));
  assert.equal(noBasis.source, 'rule_added');
  const veto = 'osaka_017';
  const r = request(['osaka_009'], {days: 3, veto});
  const {candidates} = await calculateRealCandidates(r, dataset, profiles, {baseUrl: ''}, {liveCheck: mockLiveCheck('pass')});
  for (const c of candidates) assert.ok(!c.days.flatMap(d => d.placeIds).includes(veto));
});
