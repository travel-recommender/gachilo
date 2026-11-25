import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadRuntimeInputs} from '../../scripts/validate_real_schedule.mjs';
import {schedulableDetails} from './schedulable.mjs';

test('미확인 날짜 가안은 선택 가능하지만 추천 대상에는 포함하지 않는다', () => {
  const {dataset, profiles} = loadRuntimeInputs();
  const result = schedulableDetails(['2027-01-01', '2027-01-02'], dataset, profiles);
  assert.ok(result.placeIds.length > 0);
  assert.deepEqual(result.recommendationPlaceIds, []);
});

test('검증된 방문일의 일정 후보는 추천 대상에도 들어간다', () => {
  const {dataset, profiles} = loadRuntimeInputs();
  const result = schedulableDetails(['2026-11-25'], dataset, profiles);
  assert.ok(result.recommendationPlaceIds.length > 0);
  assert.ok(result.recommendationPlaceIds.every(id => result.placeIds.includes(id)));
});
