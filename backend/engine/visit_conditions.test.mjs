// 방문 조건 안내 — 검토 자료·실시간 조회·출처를 장소·날짜별로 묶는다 (이슈 #6 RAG, 혜인)
// 실행: node --test backend/engine/visit_conditions.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRuntimeInputs} from '../../scripts/validate_real_schedule.mjs';
import {visitConditions, validateRequest, sourcesOf} from './visit_conditions.mjs';

const {dataset, profiles} = loadRuntimeInputs();
const evidencePolicy = {today: '2026-11-18'};
const live = (verdict = () => []) => {
  const calls = [];
  const fn = async requests => {
    calls.push(...requests.map(r => `${r.record.place.place_id}|${r.date}`));
    return {source: 'test', checked_on: '2026-11-11', fetched: requests.length, reused: 0,
      verdicts: new Map(requests.map(r => [`${r.record.place.place_id}|${r.date}`, verdict(r)]))};
  };
  fn.calls = calls;
  return fn;
};

test('요청 검사: 장소 1~30곳, 날짜 1~7일, 중복·형식 오류 거절', () => {
  assert.throws(() => validateRequest({placeIds: [], dates: ['2026-11-17']}));
  assert.throws(() => validateRequest({placeIds: ['a', 'a'], dates: ['2026-11-17']}));
  assert.throws(() => validateRequest({placeIds: ['a'], dates: ['11/17']}));
  assert.throws(() => validateRequest({placeIds: Array.from({length: 31}, (_, i) => `p${i}`), dates: ['2026-11-17']}));
  assert.throws(() => validateRequest({placeIds: ['a'], dates: Array(8).fill('2026-11-17')}));
  validateRequest({placeIds: ['a'], dates: ['2026-11-17']});
});

test('모르는 장소 ID는 거절한다', async () => {
  await assert.rejects(visitConditions({placeIds: ['nope'], dates: ['2026-11-17']}, dataset, profiles, {evidencePolicy, liveCheck: live()}), /unknown placeIds/);
});

test('실시간 성공에도 오래된 검토 자료를 구분하고 영업시간·출처·확인 시각을 함께 준다', async () => {
  const check = live();
  const stable = structuredClone(dataset);
  stable.places.find(r => r.place.place_id === 'osaka_007').field_sources.opening_hours.checked_at = '2026-09-01';
  const out = await visitConditions({placeIds: ['osaka_007'], dates: ['2026-11-17']}, stable, profiles, {evidencePolicy, liveCheck: check});
  assert.equal(out.liveSource, 'test');
  assert.equal(out.checkedOn, '2026-11-11');
  const [place] = out.places;
  const [day] = place.dates;
  assert.equal(day.status, 'confirmed');
  assert.ok(day.evidenceCheck.reasons.includes('evidence_stale'));
  assert.ok(!day.notices.some(n => n.code.startsWith('evidence_')));
  assert.equal(day.live, 'confirmed');
  assert.ok(day.notices.every(n => n.source === 'review'));
  assert.ok(day.scheduleHours.length >= 1 && /^\d\d:\d\d$/.test(day.scheduleHours[0].open));
  assert.equal(typeof day.openingHours, 'string');
  assert.equal('hours' in day, false);
  assert.ok(place.sources.length >= 1);
  for (const s of place.sources) assert.match(s.url, /^https?:\/\//);
  assert.deepEqual(check.calls, ['osaka_007|2026-11-17']);
});

test('입장 예약이 필요한 곳은 확인 필요로 안내하고, 갈 수는 있으므로 실시간 조회도 한다', async () => {
  const check = live();
  const out = await visitConditions({placeIds: ['osaka_002'], dates: ['2026-11-17']}, dataset, profiles, {evidencePolicy, liveCheck: check});
  const [day] = out.places[0].dates;
  assert.equal(day.status, 'check');
  assert.ok(day.notices.some(n => n.code === 'entry_time_reservation_required' && n.source === 'review'));
  assert.equal(day.live, 'confirmed');
  assert.deepEqual(check.calls, ['osaka_002|2026-11-17']);
});

test('실시간 결과: 휴업은 갈 수 없음, 시간 변경은 확인 필요, 조회 실패는 변경과 구분한다', async () => {
  const run = async code => (await visitConditions({placeIds: ['osaka_007'], dates: ['2026-11-17']}, dataset, profiles,
    {evidencePolicy, liveCheck: live(() => [code])})).places[0].dates[0];
  const closed = await run('live_closed_temporarily');
  assert.equal(closed.status, 'closed'); assert.equal(closed.live, 'closed');
  const changed = await run('live_hours_changed');
  assert.equal(changed.status, 'check'); assert.equal(changed.live, 'changed');
  const failed = await run('live_lookup_failed');
  assert.equal(failed.status, 'check'); assert.equal(failed.live, 'failed');
  assert.ok(failed.notices.every(n => n.text.length > 0));
});

test('실시간 조회를 할 수 없으면(키 없음·오류) 검토 자료는 그대로 주고 확인 필요로 표시한다', async () => {
  const out = await visitConditions({placeIds: ['osaka_007'], dates: ['2026-11-17']}, dataset, profiles,
    {evidencePolicy, liveCheck: async () => { throw Error('LIVE_CHECK_UNAVAILABLE'); }});
  assert.equal(out.liveSource, 'unavailable');
  const [day] = out.places[0].dates;
  assert.equal(day.status, 'check');
  assert.equal(day.live, 'unavailable');
  assert.ok(day.scheduleHours.length >= 1);
  assert.ok(day.notices.some(n => n.code === 'live_unavailable'));
});

test('검토 기간 밖 날짜는 확인 필요로 안내한다', async () => {
  const out = await visitConditions({placeIds: ['osaka_007'], dates: ['2026-12-05']}, dataset, profiles, {evidencePolicy, liveCheck: live()});
  const [day] = out.places[0].dates;
  assert.equal(day.status, 'check');
  assert.ok(day.notices.some(n => n.code === 'outside_reviewed_date_range'));
});

test('출처는 URL마다 한 번, 가장 최근 확인일을 남긴다', () => {
  const record = {field_sources: {
    opening_hours: {urls: ['https://a.example/'], checked_at: '2026-10-01'},
    website: {urls: ['https://a.example/', 'https://b.example/'], checked_at: '2026-09-01'},
  }};
  const sources = sourcesOf(record, {source_urls: ['https://a.example/'], checked_at: '2026-11-04'});
  assert.deepEqual(sources, [
    {url: 'https://a.example/', label: '운영 정보', checkedAt: '2026-11-04'},
    {url: 'https://b.example/', label: '공식 사이트', checkedAt: '2026-09-01'},
  ]);
  assert.deepEqual(sourcesOf({field_sources: {website: {url: 'javascript:alert(1)'}}}, null), []);
  assert.deepEqual(sourcesOf({field_sources: {website: {kind: 'osm', url: 'https://www.openstreetmap.org/node/1'}}}, null),
    [{url: 'https://www.openstreetmap.org/node/1', label: '지도 정보', checkedAt: null}]);
});

test('일정 엔진이 가격 조건으로 좁힌 구간을 영업시간으로 내보내지 않는다 (카니도라쿠 점심·이치란 심야 할증)', async () => {
  const day = async id => (await visitConditions({placeIds: [id], dates: ['2026-11-16']}, dataset, profiles, {evidencePolicy, liveCheck: live()})).places[0].dates[0];
  const kani = await day('osaka_025');
  assert.match(kani.openingHours, /11:00–23:00/);
  assert.match(kani.openingHours, /최종입장22:00/);
  assert.deepEqual(kani.scheduleHours, [{open: '11:00', close: '16:00', latestStart: null}]);
  assert.match(kani.costBasis, /점심/);
  const ichiran = await day('osaka_026');
  assert.match(ichiran.openingHours, /카운터 24시간/);
  assert.match(ichiran.openingHours, /테이블석 08:00–23:00/);
  assert.deepEqual(ichiran.scheduleHours, [{open: '08:00', close: '22:00', latestStart: null}]);
  assert.match(ichiran.costBasis, /심야 할증/);
});

test('휴무일에는 영업시간도 일정에 넣는 시간도 보여주지 않는다', async () => {
  const run = await visitConditions({placeIds: ['osaka_008'], dates: ['2026-11-19']}, dataset, profiles, {evidencePolicy, liveCheck: live()});
  const [day] = run.places[0].dates;
  assert.equal(day.status, 'closed');
  assert.equal(day.openingHours, null);
  assert.deepEqual(day.scheduleHours, []);
});


test('잘못된 추가 근거·예외 날짜는 해당 장소만 경고하고 다른 장소 조회를 보존한다', async () => {
  for (const corrupt of ['assertion', 'exception']) {
    const copy = structuredClone(dataset), pp = structuredClone(profiles);
    const r = copy.places.find(r => r.place.place_id === 'osaka_007');
    if (corrupt === 'assertion') r.review.visit_evidence = [{place_id:'other', field:'cost', value:1}];
    else pp.places.osaka_007.exceptions = {'2026-02-30':{closed:true}};
    const result = await visitConditions({placeIds:['osaka_007','osaka_010'],dates:['2026-11-18']},copy,pp,{evidencePolicy,liveCheck:live()});
    const [bad, good] = result.places;
    assert.equal(bad.dates[0].status,'check');
    assert.deepEqual(bad.dates[0].evidenceCheck.reasons,['evidence_invalid']);
    assert.deepEqual(bad.evidence.entries,[]);
    assert.ok(bad.sources.length);
    assert.ok(good.evidence.entries.length);
    assert.ok(!good.dates[0].evidenceCheck.reasons.includes('evidence_invalid'));
  }
});

test('실제 근거 충돌은 경고하지만 이미 휴무인 결과를 덮어쓰지 않는다', async () => {
  const copy = structuredClone(dataset), r = copy.places.find(r=>r.place.place_id==='osaka_007');
  r.review.visit_evidence = [{place_id:'osaka_007',field:'cost',value:999999,kind:'official_web_review',
    urls:['https://www.skybldg.co.jp/'],checked_at:'2026-11-18',valid_from:'2026-11-01',valid_through:'2026-11-30'}];
  for (const code of [null,'live_closed_temporarily']) {
    const out = await visitConditions({placeIds:['osaka_007'],dates:['2026-11-18']},copy,profiles,
      {evidencePolicy,liveCheck:live(()=>code?[code]:[])});
    const d=out.places[0].dates[0];
    assert.equal(d.status,code?'closed':'check');
    assert.ok(d.evidenceCheck.reasons.includes('evidence_conflict'));
    assert.equal(d.notices.filter(n=>n.code==='evidence_review_required').length,1);
  }
});

test('11월 말 경계를 넘겨 검토 기간을 연장하거나 자료 경고를 주 안내에 중복하지 않는다', async () => {
  const dates=['2026-11-30','2026-12-01'];
  const out=await visitConditions({placeIds:['osaka_007'],dates},dataset,profiles,{evidencePolicy,liveCheck:live()});
  const [inside,outside]=out.places[0].dates;
  assert.equal(inside.status,'confirmed');
  assert.equal(outside.status,'check');
  assert.ok(outside.notices.some(n=>n.code==='outside_reviewed_date_range'));
  assert.ok(outside.evidenceCheck.reasons.includes('evidence_period'));
  assert.ok(!outside.notices.some(n=>n.code==='evidence_period'));
});
