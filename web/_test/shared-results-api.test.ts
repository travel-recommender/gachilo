import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedResultClient, selectedCandidate, SharedResultError} from '../src/lib/shared-results-api.ts';
import type {SharedResults} from '../src/lib/shared-results-api.ts';

test('selection sends only version and strategy even when passed a full server response', async () => {
  let sent: {url: string; init: RequestInit} | undefined;
  const api=createSharedResultClient('http://test.invalid/',async (url,init) => {
    sent={url:String(url),init:init!};return Response.json({status:'ready'});
  });
  const full={revision:3,selectionVersion:0,candidates:[],roomId:'room',status:'awaiting_selection'} as unknown as SharedResults;
  await api.select('room/encoded','owner-token',full,'fairness');
  assert.equal(sent!.url,'http://test.invalid/rooms/room%2Fencoded/selection');
  assert.deepEqual(JSON.parse(sent!.init.body as string),{revision:3,selectionVersion:0,strategy:'fairness'});
  assert.equal((sent!.init.headers as Record<string,string>).Authorization,'Bearer owner-token');
});

test('202 remains a polling state; 409 is a typed conflict and does not select a local default', async () => {
  const api=createSharedResultClient('',async()=>Response.json({status:'calculating',candidates:[],selectedStrategy:null},{status:202}));
  const busy=await api.calculateAll('room','owner',3);
  assert.equal(busy.status,'calculating');assert.equal(selectedCandidate(busy),null);
  const conflict=createSharedResultClient('',async()=>Response.json({error:'입력이 변경되었습니다.'},{status:409}));
  await assert.rejects(conflict.calculateAll('room','owner',2),e=>e instanceof SharedResultError && e.status===409);
});
