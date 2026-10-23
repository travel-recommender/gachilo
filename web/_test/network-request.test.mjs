import test from 'node:test';
import assert from 'node:assert/strict';
import {requestJson, NetworkRequestError, CALCULATE_TIMEOUT_MS, REQUEST_TIMEOUT_MS} from '../src/lib/network-request.mjs';

test('unreachable API is a Korean connection error, with no automatic replay', async () => {
 let count=0;
 await assert.rejects(requestJson('http://test.invalid',{method:'PUT'},{fetcher:async()=>{count++;throw new TypeError('Failed to fetch')}}),e=>e instanceof NetworkRequestError && e.message.includes('연결'));
 assert.equal(count,1);
});
test('blackholed connection and stalled response body both expire', async () => {
 for (const body of [false,true]) {
  let signal;
  const fetcher=async (_url,init)=>{signal=init.signal;return body ? new Response(new ReadableStream({start(s){signal.addEventListener('abort',()=>s.error(signal.reason),{once:true})}})) : new Promise(()=>{});};
  await assert.rejects(requestJson('http://test.invalid',{}, {fetcher,timeoutMs:25}),e=>e instanceof NetworkRequestError && e.message.includes('응답이 늦어'));
  assert.equal(signal.aborted,true);
 }
});
test('caller cancellation keeps its identity; an already aborted request is never sent', async()=>{
 const c=new AbortController(),reason=new Error('leave page');let count=0;
 const work=requestJson('http://test.invalid',{signal:c.signal},{fetcher:async()=>{count++;return new Promise(()=>{})},timeoutMs:100});
 c.abort(reason);await assert.rejects(work,e=>e===reason);
 await assert.rejects(requestJson('http://test.invalid',{signal:c.signal},{fetcher:async()=>{count++;return Response.json({})}}),e=>e===reason);
 assert.equal(count,1);
});
test('a new explicit request succeeds after failure',async()=>{
 await assert.rejects(requestJson('http://test.invalid',{}, {fetcher:async()=>{throw new TypeError('offline')}}));
 const {value}=await requestJson('http://test.invalid',{}, {fetcher:async()=>Response.json({saved:true})});assert.equal(value.saved,true);
 assert.ok(CALCULATE_TIMEOUT_MS>135000);assert.ok(REQUEST_TIMEOUT_MS<15000);
});

test('real TCP connection with no HTTP response expires, then the server recovers', async()=>{
 const {createServer}=await import('node:http');let stalled=true;
 const server=createServer((_req,res)=>{if (!stalled){res.setHeader('Content-Type','application/json');res.end('{"recovered":true}')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const url=`http://127.0.0.1:${server.address().port}/`;
  await assert.rejects(requestJson(url,{}, {timeoutMs:60}),e=>e instanceof NetworkRequestError);
  stalled=false;
  const {value}=await requestJson(url,{}, {timeoutMs:2000});assert.equal(value.recovered,true);
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
