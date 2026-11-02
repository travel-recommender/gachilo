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
