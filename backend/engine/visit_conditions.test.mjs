// 방문 조건 안내 — 검토 자료·실시간 조회·출처를 장소·날짜별로 묶는다 (이슈 #6 RAG, 혜인)
// 실행: node --test backend/engine/visit_conditions.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRuntimeInputs} from '../../scripts/validate_real_schedule.mjs';
import {visitConditions, validateRequest, sourcesOf} from './visit_conditions.mjs';

const {dataset, profiles} = loadRuntimeInputs();
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
  await assert.rejects(visitConditions({placeIds: ['nope'], dates: ['2026-11-17']}, dataset, profiles, {liveCheck: live()}), /unknown placeIds/);
});

test('검토 자료와 실시간 조회가 모두 맞으면 확인됨, 영업시간·출처·확인 시각을 함께 준다', async () => {
  const check = live();
  const out = await visitConditions({placeIds: ['osaka_007'], dates: ['2026-11-17']}, dataset, profiles, {liveCheck: check});
  assert.equal(out.liveSource, 'test');
  assert.equal(out.checkedOn, '2026-11-11');
  const [place] = out.places;
  const [day] = place.dates;
  assert.equal(day.status, 'confirmed');
  assert.equal(day.live, 'confirmed');
  assert.deepEqual(day.notices, []);
  assert.ok(day.hours.length >= 1 && /^\d\d:\d\d$/.test(day.hours[0].open));
  assert.ok(place.sources.length >= 1);
  for (const s of place.sources) assert.match(s.url, /^https?:\/\//);
  assert.deepEqual(check.calls, ['osaka_007|2026-11-17']);
});

test('입장 예약이 필요한 곳은 확인 필요로 안내하고, 갈 수는 있으므로 실시간 조회도 한다', async () => {
  const check = live();
  const out = await visitConditions({placeIds: ['osaka_002'], dates: ['2026-11-17']}, dataset, profiles, {liveCheck: check});
  const [day] = out.places[0].dates;
  assert.equal(day.status, 'check');
  assert.ok(day.notices.some(n => n.code === 'entry_time_reservation_required' && n.source === 'review'));
  assert.equal(day.live, 'confirmed');
  assert.deepEqual(check.calls, ['osaka_002|2026-11-17']);
});

test('실시간 결과: 휴업은 갈 수 없음, 시간 변경은 확인 필요, 조회 실패는 변경과 구분한다', async () => {
  const run = async code => (await visitConditions({placeIds: ['osaka_007'], dates: ['2026-11-17']}, dataset, profiles,
    {liveCheck: live(() => [code])})).places[0].dates[0];
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
    {liveCheck: async () => { throw Error('LIVE_CHECK_UNAVAILABLE'); }});
  assert.equal(out.liveSource, 'unavailable');
  const [day] = out.places[0].dates;
  assert.equal(day.status, 'check');
  assert.equal(day.live, 'unavailable');
  assert.ok(day.hours.length >= 1);
  assert.ok(day.notices.some(n => n.code === 'live_unavailable'));
});

test('검토 기간 밖 날짜는 확인 필요로 안내한다', async () => {
  const out = await visitConditions({placeIds: ['osaka_007'], dates: ['2026-12-05']}, dataset, profiles, {liveCheck: live()});
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
