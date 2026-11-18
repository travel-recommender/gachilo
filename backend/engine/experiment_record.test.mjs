// 실험 기록의 엔진 만족도 점수 (experiment_record.mjs) — 지점 자동 배치(#74) 반영 기준
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script = fileURLToPath(new URL('./experiment_record.mjs', import.meta.url));
const run = payload => JSON.parse(execFileSync(process.execPath, [...process.execArgv, script], {input: JSON.stringify(payload), encoding: 'utf8'}));
const sub = (memberId, picks, extra = {}) => ({memberId, picks, must: picks[0], veto: null, vetoes: [],
  budgetPerDay: 100000, stepLimit: 10000, ...extra});
const candidate = items => ({strategy: 'average', metrics: {costKrwPerDay: 50000, walkStepsPerDay: 5000},
  days: [{placeIds: items.map(i => i.placeId), items}]});
const payload = (c, subs) => ({roomId: 'room-1', memberId: subs[0].memberId, memberIds: subs.map(s => s.memberId), candidate: c, submissions: subs});

test('고른 지점 대신 같은 가게의 다른 지점이 들어가면 찜·1순위가 반영된 것으로 센다', () => {
  const subs = [sub('a', ['branch_551_honten', 'osaka_010'])];
  const swapped = run(payload(candidate([
    {placeId: 'branch_551_namba_walk', branch: {fromPlaceId: 'branch_551_honten', reasonCode: 'original_unavailable', savedMin: null}},
    {placeId: 'osaka_010'}]), subs));
  assert.equal(swapped.automatic.pickRate, 1);
  assert.equal(swapped.automatic.mustKept, true);
  // 기록하는 placeIds는 실제 배치 그대로
  assert.deepEqual(swapped.placeIds, ['branch_551_namba_walk', 'osaka_010']);
  // 정말 빠졌으면 그대로 못 들어간 것으로 센다
  const missing = run(payload(candidate([{placeId: 'osaka_010'}]), subs));
  assert.equal(missing.automatic.pickRate, 0.5);
  assert.equal(missing.automatic.mustKept, false);
});

test('다른 사람이 고른 같은 그룹 지점이 들어가도 반영으로 센다(엔진 covered와 같음), 제외 판정은 실제 배치 그대로', () => {
  const subs = [sub('a', ['branch_ichiran_umeda_shibata'], {vetoes: ['osaka_026']}), sub('b', ['branch_ichiran_umeda_hankyu'])];
  const r = run(payload(candidate([{placeId: 'branch_ichiran_umeda_hankyu'}]), subs));
  assert.equal(r.automatic.pickRate, 1);
  assert.equal(r.automatic.vetoKept, true);
  assert.equal(r.group.gap, 0);
});

test('실제 카탈로그 ID의 1순위·제외도 채점한다 (데모 카탈로그로 걸러져 늘 만점이던 문제)', () => {
  const subs = [sub('a', ['branch_551_honten', 'osaka_010'], {vetoes: ['osaka_007']})];
  const r = run(payload(candidate([{placeId: 'osaka_010'}, {placeId: 'osaka_007'}]), subs));
  assert.equal(r.automatic.mustKept, false);
  assert.equal(r.automatic.mustRate, 0);
  assert.equal(r.automatic.vetoKept, false);
});
