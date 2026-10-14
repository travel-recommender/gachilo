// PR #46 리뷰 회귀 — 실제 카탈로그와 calculateCandidates → enrich 경로
// 실행: node --test backend/engine/schedule-review.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateCandidates} from './candidates.mjs';
import {enrich} from './ai.ts';

const members = ['a','b'].map((id) => ({id, name:id, color:'#2563eb'}));
const request = (sub) => ({members, startDate:'2026-10-20', endDate:'2026-10-20',
  submissions: members.map((m, i) => ({memberId:m.id, veto:null, stepLimit:30000, activeMin:720, ...sub(i)}))});

test('끼니 배치 때문에 영업시간 안에 갈 수 있는 꼭 가기가 빠지지 않는다', async () => {
  const res = await calculateCandidates(request((i) => ({longlist:['ichiran','kuromon'],
    picks:['ichiran','kuromon'], must:i ? 'kuromon' : 'ichiran', budgetPerDay:200000})), enrich);
  for (const c of res.candidates) {
    const ids = c.days.flatMap(d => d.placeIds);
    assert.ok(ids.includes('ichiran') && ids.includes('kuromon'), `${c.strategy}: ${ids}`);
  }
});

test('자동 추가 식사도 제출 예산 안에서만 고른다', async () => {
  const res = await calculateCandidates(request(() => ({longlist:['glico'], picks:['glico'],
    must:'glico', budgetPerDay:10000})), enrich);
  for (const c of res.candidates) {
    assert.ok(c.metrics.costKrwPerDay <= 10000, `${c.strategy}: ${c.metrics.costKrwPerDay}`);
    assert.ok(c.days.flatMap(d => d.placeIds).includes('glico'));
  }
});
