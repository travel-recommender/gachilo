// Run from web/: node --test _test/*.test.ts _test/search.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import ts from "typescript";

// Use the TypeScript compiler already required by the web project.
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  for (const candidate of [request, request + ".ts"]) {
    try { return originalResolve.call(this, candidate, ...args); } catch {}
  }
  return originalResolve.call(this, request, ...args);
};
Module._extensions[".ts"] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText,
  filename,
);
const require = Module.createRequire(import.meta.url);

const {roomApi,ApiError}=require('../src/lib/room-api.ts');
const {CREATE_TIMEOUT_MS,CALCULATE_TIMEOUT_MS,CREATE_UNCERTAIN,JOIN_UNCERTAIN}=await import('../src/lib/network-request.mjs');
test('all room helpers reject malformed successful bodies as ApiError',async()=>{
 const before=globalThis.fetch;
 try {
  for(const body of ['<html>proxy</html>','','null','[]','42']) {
   globalThis.fetch=async()=>new Response(body);
   await assert.rejects(roomApi.info('room','test-token'),e=>e instanceof ApiError && e.status===200);
  }
 } finally {globalThis.fetch=before;}
});
test('create and join get an explicit longer deadline; calculate deadline is selected by its caller',async()=>{
 const before=globalThis.fetch,oldTimer=globalThis.setTimeout;const timeouts=[];
 globalThis.setTimeout=(callback,ms,...args)=>{timeouts.push(ms);return oldTimer(callback,ms,...args);};
 globalThis.fetch=async()=>Response.json({});
 try {
  await roomApi.create('2026-11-01','2026-11-02',['A','B']);
  await roomApi.claim('room','invite',{memberId:'member'});
  await roomApi.rejoin('room','invite','member','0000');
  await roomApi.calculate({roomId:'room',ownerToken:'owner'},'average');
  assert.deepEqual(timeouts,[CREATE_TIMEOUT_MS,CREATE_TIMEOUT_MS,CREATE_TIMEOUT_MS,CALCULATE_TIMEOUT_MS]);
 } finally {globalThis.fetch=before;globalThis.setTimeout=oldTimer;}
});
test('failed create and claim explain ambiguous outcome without automatically replaying',async()=>{
 const before=globalThis.fetch;let sent=0;
 globalThis.fetch=async()=>{sent++;throw new TypeError('lost response');};
 try {
  await assert.rejects(roomApi.create('2026-11-01','2026-11-02',['A','B']),e=>e instanceof ApiError&&e.message===CREATE_UNCERTAIN);
  await assert.rejects(roomApi.claim('room','invite',{memberId:'member'}),e=>e instanceof ApiError&&e.message===JOIN_UNCERTAIN);
  assert.equal(sent,2);
 } finally {globalThis.fetch=before;}
});
