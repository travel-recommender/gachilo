import test from 'node:test';
import assert from 'node:assert/strict';
import {weatherRouteNotice,withoutWeatherRouteNotice} from '../src/lib/weather-route-notice.ts';

test('old/local and baseline-only results never claim a weather detour',()=>{
  for(const s of [undefined,'기존 경로. 지붕 정보 미확인.','예보 35°C, 우회 0구간'])assert.equal(weatherRouteNotice(s),null);
});
test('selected server candidate supplies exactly its own notice without duplicate summary text',()=>{
  const first='근거.\n날씨 경로 안내: 폭염을 피하는 경로예요. 추가 약 1분.\n';
  const second='근거.\n날씨 경로 안내: 비를 피하는 경로예요. 추가 약 3분.\n';
  assert.equal(weatherRouteNotice(first),'폭염을 피하는 경로예요. 추가 약 1분.');
  assert.equal(weatherRouteNotice(second),'비를 피하는 경로예요. 추가 약 3분.');
  assert.equal(withoutWeatherRouteNotice(first),'근거.');
});
