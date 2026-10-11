import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateCandidates, STRATEGIES} from './candidates.mjs';
import {buildConsensus, kmToSteps} from './consensus.ts';
import {buildSchedule} from './schedule.ts';
import {setMembers} from './places.ts';

const members = ['secret-a','secret-b','secret-c'].map((id,i) => ({id, name:`private-name-${i}`, color:'#2563eb'}));
const submissions = members.map((m,i) => ({memberId:m.id, longlist:['glico','umeda_sky'],
  picks:i ? ['umeda_sky'] : ['glico'], must:null, veto:'usj',
  budgetPerDay:50000, stepLimit:10000, activeMin:480}));
const request = {members, submissions, startDate:'2026-10-07',endDate:'2026-10-08'};

test('three real strategy computations project only the final shared schedule and its metrics', async () => {
  const result = await calculateCandidates(request);
  assert.deepEqual(result.candidates.map(c => c.strategy), STRATEGIES);
  setMembers(members);
  for (const candidate of result.candidates) {
    const consensus = buildConsensus({submissions,nights:1,strategy:candidate.strategy,allowPartial:true});
    const schedule = buildSchedule(consensus.core,2,{considerBags:true,fillMeals:true,vetoed:new Set(['usj'])});
    assert.deepEqual(candidate.days.map(d => d.placeIds), schedule.plans.map(d => d.items.map(i => i.place.id)));
    const costs = schedule.plans.map(d => d.cost);
    assert.equal(candidate.metrics.costKrwPerDay,Math.round(costs.reduce((a,b)=>a+b)/2));
    candidate.days.forEach((d,i) => {
      assert.equal(d.metrics.walkSteps,kmToSteps(schedule.plans[i].walkKm));
      assert.ok(!d.placeIds.includes('usj'));
      assert.deepEqual(d.items.map(x=>x.placeId),d.placeIds);
      for (const x of d.items) {
        assert.equal(x.filled,x.source==='meal_fill');
        assert.equal(x.aiAdded,['rule_added','ai_added'].includes(x.source));
        if (x.source !== 'selected') assert.ok(x.reason);
      }
    });
  }
  const encoded = JSON.stringify(result);
  for (const forbidden of ['secret-a','private-name','participants','mustOf','satisfaction','budgetPerDay']) assert.ok(!encoded.includes(forbidden));
});

test('explanation failure preserves all three rule candidates', async () => {
  assert.deepEqual(await calculateCandidates(request,async()=>{throw Error('offline');}),await calculateCandidates(request));
});

test('optional AI adapter uses the returned final schedule, not a second rule calculation', async () => {
  let called = 0;
  const result = await calculateCandidates(request,async (res,subs,days) => {
    called++;
    const schedule = buildSchedule(res.core,days,{considerBags:true,fillMeals:false,vetoed:new Set(['usj'])});
    return {core:res.core,schedule,summary:'검증된 설명',ai:{used:true,added:[],basis:[]}};
  });
  assert.equal(called,3);
  for (const c of result.candidates) {
    assert.equal(c.summary,'검증된 설명');
    assert.equal(c.explanationSource,'ai');
    assert.ok(c.days.flatMap(d=>d.items).every(i=>!i.filled));
  }
});
