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

test('non-JSON gateway errors retain their HTTP status as SharedResultError', async () => {
  for (const status of [502, 503, 504]) {
    const api=createSharedResultClient('',async()=>new Response('<html>Gateway error</html>', {status}));
    await assert.rejects(api.calculateAll('room','owner',3),e=>
      e instanceof SharedResultError && e.status===status && !e.message.includes('<html>'));
  }
});

test('empty, null and malformed successful bodies become typed errors', async () => {
  for (const body of ['', 'null', '<html>upstream</html>', '[]', '42']) {
    const api=createSharedResultClient('',async()=>new Response(body,{status:200}));
    await assert.rejects(api.get('room','member'),e=>e instanceof SharedResultError && e.status===200);
  }
});

test('JSON error text survives and abort remains recognizable as cancellation', async () => {
  const api=createSharedResultClient('',async()=>Response.json({error:'다시 시도하세요.'},{status:503}));
  await assert.rejects(api.get('room','member'),e=>e instanceof SharedResultError && e.status===503 && e.message==='다시 시도하세요.');
  const abort=new DOMException('cancelled','AbortError');
  const cancelled=createSharedResultClient('',async()=>{throw abort;});
  await assert.rejects(cancelled.get('room','member'),e=>e===abort);
});

test('cancelling an in-progress response body preserves the cancellation reason', async () => {
  for (const [status, reason] of [
    [200, new DOMException('cancelled body', 'AbortError')],
    [503, new DOMException('cancelled error body', 'AbortError')],
    [200, new Error('view unmounted')],
  ] as const) {
    const controller=new AbortController();
    let reading!: () => void;
    const bodyReading=new Promise<void>(resolve=>{reading=resolve;});
    const api=createSharedResultClient('',async (_url,init)=>new Response(new ReadableStream({
      start(stream) {
        init!.signal!.addEventListener('abort',()=>stream.error(init!.signal!.reason),{once:true});
      },
      pull() { reading(); },
    },{highWaterMark:0}),{status}));
    const rejected=assert.rejects(api.calculateAll('room','owner',3,controller.signal),error=>error===reason);
    await bodyReading;
    controller.abort(reason);
    await rejected;
  }
});

test('AbortError from body reading is preserved even without a supplied signal', async () => {
  const reason=new DOMException('body cancelled','AbortError');
  const api=createSharedResultClient('',async()=>new Response(new ReadableStream({
    pull(stream) { stream.error(reason); },
  },{highWaterMark:0})));
  await assert.rejects(api.get('room','member'),error=>error===reason);
});
