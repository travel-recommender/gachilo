import test from 'node:test';
import assert from 'node:assert/strict';
import {planningReasonLines, planningResultReasonLines} from '../backend/public/planning-reasons.mjs';

test('legacy saved union counts prompt recalculation instead of claiming every date is blocked',()=>{
  const legacy={exclusion_reason_counts:{outside_reviewed_date_range:106,closed_on_visit_date:2}};
  const snapshot=structuredClone(legacy);
  const lines=planningResultReasonLines(legacy);
  assert.equal(lines.length,1);
  assert.match(lines[0],/방장이 다시 계산/);
  assert.ok(!lines[0].includes('모든 여행일'));
  assert.ok(!lines[0].includes('106'));
  assert.deepEqual(legacy,snapshot);
});
test('tagged results retain the verified common-date labels',()=>{
  assert.deepEqual(planningResultReasonLines({reason_aggregation:'common_across_dates',exclusion_reason_counts:{outside_reviewed_date_range:3}}),
    ['모든 여행일이 검증된 날짜 범위 밖: 3곳']);
});
test('unknown aggregation markers also require recalculation',()=>{
  for (const marker of ['union_across_dates','future_aggregation',null]) {
    const lines=planningResultReasonLines({reason_aggregation:marker,exclusion_reason_counts:{closed_on_visit_date:2}});
    assert.equal(lines.length,1);
    assert.match(lines[0],/집계 기준/);
    assert.ok(!lines[0].includes('모든 여행일'));
  }
});
test('new empty results have no warning, while untagged empty results remain distinguishable',()=>{
  assert.deepEqual(planningResultReasonLines({reason_aggregation:'common_across_dates',exclusion_reason_counts:{}}),[]);
  assert.match(planningResultReasonLines({exclusion_reason_counts:{}})[0],/다시 계산/);
});

test('capacity and timing failures tell users to adjust their itinerary',()=>{
  const lines=planningReasonLines({requested_place_not_scheduled:14,opening_or_last_entry_violation:2,daily_place_limit:1});
  assert.equal(lines.length,3);
  assert.match(lines[0],/시간 부족: 14곳/);
  assert.match(lines[1],/입장 마감시간/);
  assert.match(lines[2],/하루 최대 방문 장소 수/);
  assert.ok(lines.every(line=>!line.includes('추가 확인')));
});
test('unmapped reasons share one row and do not claim a distinct place total',()=>{
  const lines=planningReasonLines({branch_unconfirmed:6,identity_unconfirmed:3,google_maps_permanently_closed:8,address_missing:2});
  assert.equal(lines.length,2);
  assert.equal(lines[0],'주소 미확인: 2곳');
  assert.equal(lines[1],'지점·운영 조건 추가 확인 필요: 미확인 사유 17건 (장소 중복 포함)');
});
test('mixed dates and all-date blockers are visibly distinguished',()=>{
  const lines=planningReasonLines({date_conditions_vary:1,closed_on_visit_date:2,outside_reviewed_date_range:3});
  assert.match(lines[0],/날짜별 미배치 사유가 다름/);
  assert.equal(lines[1],'모든 여행일 휴무: 2곳');
  assert.equal(lines[2],'모든 여행일이 검증된 날짜 범위 밖: 3곳');
});
test('an itinerary with no exclusion reasons renders no warnings',()=>{
  assert.deepEqual(planningReasonLines({}),[]);
});
