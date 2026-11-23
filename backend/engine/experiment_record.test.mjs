import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {calculateRealCandidates} from './real_candidates.mjs';
import {mockLiveCheck} from './live_check.mjs';
import {loadRuntimeInputs} from '../../scripts/validate_real_schedule.mjs';
import {experimentExplanation} from '../../web/src/lib/experiment.ts';

const {dataset, profiles} = loadRuntimeInputs();
const byId = new Map(dataset.places.map(r => [r.place.place_id, r.place]));

test('actual closure replacement agrees across engine, personal text and exported metrics for all strategies', async () => {
  const original = 'branch_551_honten', actual = 'branch_551_namba_walk';
  const submissions = ['a','b'].map(memberId => ({memberId, longlist:[original], picks:[original],
    must:original, veto:null, budgetPerDay:200000, stepLimit:30000, activeMin:720}));
  const request = {startDate:'2026-11-17', endDate:'2026-11-17', submissions,
    exchange_rate:{krw_per_jpy:'9.5', as_of:'2026-11-15'}};
  const {candidates} = await calculateRealCandidates(request,dataset,profiles,{baseUrl:''},
    {liveCheck:mockLiveCheck('pass'), choose:null});
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'branch-export-'));
  try {
    const catalog = path.join(temp,'catalog.json');fs.writeFileSync(catalog,JSON.stringify(dataset));
    const jobs = submissions.flatMap(sub => candidates.map(candidate => ({roomId:'regression',
      memberId:sub.memberId,memberIds:['a','b'],candidate,submissions})));
    const records = JSON.parse(execFileSync(process.execPath,
      [fileURLToPath(new URL('./experiment_record.mjs',import.meta.url)),catalog],
      {input:JSON.stringify(jobs),encoding:'utf8'}));
    for (let i=0;i<jobs.length;i++) {
      const {candidate,memberId} = jobs[i], sub = submissions.find(s=>s.memberId===memberId);
      assert.deepEqual(candidate.days.flatMap(d=>d.placeIds),[actual]);
      assert.equal(candidate.planning.must_satisfied,true);
      assert.equal(records[i].automatic.pickRate,1);
      assert.equal(records[i].automatic.mustKept,true);
      assert.equal(records[i].automatic.mustRate,1);
      const text = experimentExplanation(candidate,sub,id=>byId.get(id).name_ko,id=>byId.get(id)?.branch_group_id);
      assert.ok(text.includes('내 꼭 가기 1곳 중 1곳이 들어갔어요.'));
      assert.ok(text.some(s=>s.includes('같은 가게의 다른 지점인')));
      assert.ok(text.includes('1순위를 고른 사람의 꼭 가기가 모두 들어갔어요.'));
    }
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});
