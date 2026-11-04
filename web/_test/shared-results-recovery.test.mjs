import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {createSharedResultClient,SharedResultError} from '../src/lib/shared-results-api.ts';
import {createCalculator,newer} from '../src/lib/shared-flow.ts';

// Run the actual hook and HTTP client with deterministic hook state; no polling timers or DOM needed.
function mount(fetcher) {
 const values=[];let cursor=0;
 const room={roomId:'r1',token:'member',ownerToken:'owner'};
 const react={useState(initial){const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v;}];},useRef:()=>({current:true}),useCallback:f=>f,useEffect:()=>{}};
 const filename=fileURLToPath(new URL('../src/components/useSharedResults.ts',import.meta.url));
 const mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
 const mocks={'react':react,'@/components/store':{useTrip:()=>({state:{room}})},'@/lib/room-api':{API_BASE:'http://test.invalid'},'@/lib/shared-results-api':{createSharedResultClient:base=>createSharedResultClient(base,fetcher),SharedResultError},'@/lib/shared-flow':{createCalculator,newer}};
 mod.require=request=>{assert.ok(request in mocks,request);return mocks[request];};
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);
 return ()=>{cursor=0;return mod.exports.useSharedResults();};
}
const snapshot=(patch={})=>({roomId:'r1',dataset:'prototype_demo_36',status:'awaiting_selection',revision:3,selectionVersion:0,candidates:[],selectedStrategy:null,result:null,submittedCount:2,memberCount:2,...patch});

test('lost selection response reloads the saved result once, without repeating the write',async()=>{
 let saved=snapshot();const calls=[];
 const render=mount(async(url,init)=>{calls.push(init.method);if(init.method==='PUT'){saved=snapshot({status:'ready',selectionVersion:1,selectedStrategy:'fairness'});throw new TypeError('response lost');}return Response.json(saved);});
 await render().refresh();calls.length=0;
 await render().select('fairness');
 assert.deepEqual(calls,['PUT','GET']);
 assert.equal(render().snap.selectedStrategy,'fairness');
 assert.equal(render().snap.status,'ready');assert.equal(render().error,null);
});
test('selection stays busy until reconciliation finishes; an uncommitted write is not reported as confirmed',async()=>{
 let reads=0,release;const calls=[];
 const render=mount(async(url,init)=>{calls.push(init.method);if(init.method==='PUT')throw new TypeError('offline');if(++reads===1)return Response.json(snapshot());return new Promise(resolve=>{release=resolve;});});
 await render().refresh();calls.length=0;
 const selection=render().select('average');
 for(let i=0;i<10&&!release;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(typeof release,'function');assert.equal(render().selecting,true);
 release(Response.json(snapshot()));await selection;
 assert.deepEqual(calls,['PUT','GET']);assert.equal(render().snap.selectedStrategy,null);
 assert.match(render().error,/확정되지 않았/);assert.equal(render().selecting,false);
});
test('failed reconciliation keeps the last snapshot and connection error, without replaying selection',async()=>{
 let started=false;const calls=[];
 const render=mount(async(url,init)=>{if(!started)return Response.json(snapshot());calls.push(init.method);throw new TypeError('offline');});
 await render().refresh();started=true;
 await render().select('average');
 assert.deepEqual(calls,['PUT','GET']);assert.equal(render().snap.status,'awaiting_selection');
 assert.match(render().error,/연결/);assert.equal(render().selecting,false);
});
test('a real 409 conflict reloads the authoritative selection; a 403 does not trigger a retry',async()=>{
 for(const status of [409,403]) {
  let reads=0;const calls=[];
  const render=mount(async(url,init)=>{calls.push(init.method);if(init.method==='PUT')return Response.json({error:'확정 권한 또는 버전 확인'},{status});return Response.json(++reads===1?snapshot():snapshot({status:'ready',selectionVersion:2,selectedStrategy:'least_misery'}));});
  await render().refresh();calls.length=0;
  await render().select('fairness');
  assert.deepEqual(calls,status===409?['PUT','GET']:['PUT']);
  assert.equal(render().snap.selectedStrategy,status===409?'least_misery':null);
 }
});

test('polling preserves unconfirmed-selection guidance until the result state changes',async()=>{
 let current=snapshot();let offline=false;const calls=[];
 const render=mount(async(url,init)=>{calls.push(init.method);if(offline||init.method==='PUT')throw new TypeError('offline');return Response.json(current);});
 await render().refresh();await render().select('average');
 const notice=render().error;assert.match(notice,/확정되지 않았/);
 // refresh is also the callback used by the three-second polling interval.
 for(let i=0;i<3;i++){await render().refresh();assert.equal(render().error,notice);}
 offline=true;await render().refresh();assert.match(render().error,/연결/);
 offline=false;await render().refresh();assert.equal(render().error,notice);
 current=snapshot({revision:4,status:'collecting'});await render().refresh();
 assert.equal(render().error,null);assert.equal(calls.filter(m=>m==='PUT').length,1);
});

test('409 guidance survives polling and clears when the owner explicitly retries successfully',async()=>{
 let writes=0,current=snapshot();
 const render=mount(async(url,init)=>{
  if(init.method==='PUT'){
   if(++writes===1)return Response.json({error:'conflict'},{status:409});
   current=snapshot({status:'ready',selectionVersion:1,selectedStrategy:'average'});
  }
  return Response.json(current);
 });
 await render().refresh();await render().select('average');
 assert.match(render().error,/그 사이/);
 await render().refresh();assert.match(render().error,/그 사이/);
 const retry=render().select('average');assert.equal(render().error,null);
 await retry;assert.equal(render().error,null);assert.equal(render().snap.status,'ready');assert.equal(writes,2);
});

test('a different confirmed candidate is explained after a 409 or lost response and remains visible on polls',async()=>{
 for(const status of [409,0]){
  let current=snapshot();const calls=[];
  const render=mount(async(url,init)=>{
   calls.push(init.method);
   if(init.method==='PUT'){
    current=snapshot({status:'ready',selectionVersion:1,selectedStrategy:'average'});
    if(status===0)throw new TypeError('response lost');
    return Response.json({error:'conflict'},{status});
   }
   return Response.json(current);
  });
  await render().refresh();await render().select('fairness');
  assert.equal(render().snap.selectedStrategy,'average');assert.match(render().error,/이미 다른 후보로 확정/);
  const notice=render().error;await render().refresh();assert.equal(render().error,notice);
  current=snapshot({status:'ready',selectionVersion:2,selectedStrategy:'fairness'});await render().refresh();
  assert.equal(render().error,null);assert.equal(calls.filter(m=>m==='PUT').length,1);
 }
});


test('failed reconciliation preserves uncertain-write context until a successful read, without rewriting',async()=>{
 for(const restored of [snapshot(),snapshot({status:'ready',selectionVersion:1,selectedStrategy:'average'}),snapshot({status:'ready',selectionVersion:1,selectedStrategy:'fairness'})]) {
  let offline=false,current=snapshot();const calls=[];
  const render=mount(async(url,init)=>{calls.push(init.method);if(init.method==='PUT'||offline)throw new TypeError('offline');return Response.json(current);});
  await render().refresh();offline=true;await render().select('average');
  assert.match(render().error,/확정 결과를 확인하지 못/);
  assert.match(render().error,/저장됐을 수/);
  for(let i=0;i<2;i++){await render().refresh();assert.match(render().error,/최신 상태를 먼저 확인/);}
  offline=false;current=restored;await render().refresh();
  if(restored.status!=='ready')assert.match(render().error,/확정되지 않았/);
  else if(restored.selectedStrategy==='average')assert.equal(render().error,null);
  else assert.match(render().error,/이미 다른 후보/);
  assert.equal(calls.filter(m=>m==='PUT').length,1);
 }
});
