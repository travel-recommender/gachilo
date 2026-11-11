import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';

// Execute the real P4 component with deterministic hooks and deferred requests.
// No network, real participants, DOM or timers are required for these state checks.
const session=(patch={})=>({roomId:'room-a',memberId:'member-a',token:'token-a',ownerToken:null,...patch});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function mount(fetcher,room=session()) {
 const values=[],effects=[];let cursor=0;const pending=[];let calls=0;
 const state={room,extra:{mustList:['glico'],vetoList:[]},mine:{picks:['glico'],veto:null}};
 const trip={state,catalog:'demo',pool:['glico'],fetchPool:()=>{calls++;return fetcher();},setMine(){throw new Error('must preserve inputs');},setExtra(){throw new Error('must preserve inputs');}};
 const react={
  useState(initial){const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return [values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v;}];},
  useMemo:f=>f(),
  useEffect(f,deps){const i=cursor++;const old=effects[i];if(!old||deps.some((d,j)=>!Object.is(d,old.deps[j])))pending.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:f()};});},
 };
 const filename=fileURLToPath(new URL('../app/shortlist/page.tsx',import.meta.url));
 const mod=new Module(filename);
 const mocks={react,'react/jsx-runtime':jsx,'next/navigation':{useRouter:()=>({push(){}})},
  '@/lib/experiment':{EXPERIMENT_MODE:false},
  '@/lib/room-state':{vetoFields:()=>({})},'@/components/store':{useTrip:()=>trip},
  '@/components/PlaceFinder':{placeLine:()=>''},
  '@/lib/places':{CATEGORIES:[{id:'landmark',label:'명소'}],findPlace:id=>({id,name:'글리코 장소 카드',category:'landmark'})},
  '@/components/gachiro':{Box:'Box',NavButtons:'NavButtons',Page:'Page',PlanHeader:'PlanHeader',TextTabs:'TextTabs',asset:x=>x}};
 mod.require=name=>{assert.ok(name in mocks,name);return mocks[name];};
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,filename);
 return {trip,get calls(){return calls;},render(){cursor=0;const tree=mod.exports.default();while(pending.length)pending.shift()();return tree;},unmount(){for(const e of effects)e?.cleanup?.();}};
}
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);return tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];}
function text(tree){if(Array.isArray(tree))return tree.map(text).join(' ');if(tree&&typeof tree==='object')return text(tree.props?.children);return typeof tree==='string'||typeof tree==='number'?String(tree):'';}
const nav=tree=>tree.props.nav.props;
const retry=tree=>nodes(tree).find(n=>n.type==='button'&&text(n).includes('목록 다시 불러오기'));

test('P4 hides own/stale pool on initial load and 503, then retry restores unchanged selections',async()=>{
 const requests=[deferred(),deferred()];let i=0;
 const m=mount(()=>requests[i++].promise);
 let tree=m.render();assert.equal(nav(tree).nextDisabled,true);assert.doesNotMatch(text(tree),/글리코 장소 카드/);
 const message='참여자 중 한 명의 저장된 장소 목록을 읽을 수 없습니다. 각자 P3에서 목록을 다시 저장한 뒤 시도하세요.';
 requests[0].reject(new Error(message));await flush();tree=m.render();
 assert.ok(nodes(tree).some(n=>n.props?.role==='alert'));assert.ok(text(tree).includes(message));
 assert.doesNotMatch(text(tree),/글리코 장소 카드|아직 모인 곳이 없어요/);assert.equal(nav(tree).nextDisabled,true);
 retry(tree).props.onClick();tree=m.render();assert.equal(nav(tree).nextDisabled,true);assert.equal(retry(tree),undefined);
 requests[1].resolve({roomId:'room-a',placeIds:['glico']});await flush();tree=m.render();
 assert.match(text(tree),/글리코 장소 카드/);assert.equal(nav(tree).nextDisabled,false);assert.equal(retry(tree),undefined);
 assert.deepEqual(m.trip.state.extra,{mustList:['glico'],vetoList:[]});assert.equal(m.calls,2);
});

test('failed manual retry stays blocked without automatic requests or erasing the pool',async()=>{
 const m=mount(()=>Promise.reject(new Error('서버에 연결하지 못했어요.')));
 m.render();await flush();let tree=m.render();retry(tree).props.onClick();m.render();await flush();tree=m.render();
 assert.equal(m.calls,2);assert.equal(nav(tree).nextDisabled,true);assert.match(text(tree),/연결하지 못/);
 assert.doesNotMatch(text(tree),/글리코 장소 카드/);assert.deepEqual(m.trip.pool,['glico']);assert.ok(retry(tree));
});

test('changing room or token blocks immediately and ignores late success or error from the old request',async()=>{
 for(const change of [{roomId:'room-b'},{token:'replacement-token'}])for(const lateError of [false,true]){
  const first=deferred(),second=deferred();let i=0;const m=mount(()=>[first,second][i++].promise);
  m.render();m.trip.state.room=session(change);let tree=m.render();assert.equal(nav(tree).nextDisabled,true);
  if(lateError)first.reject(new Error('old session error'));else first.resolve({roomId:'room-a'});
  await flush();tree=m.render();assert.equal(nav(tree).nextDisabled,true);assert.doesNotMatch(text(tree),/old session error/);
  second.resolve({roomId:m.trip.state.room.roomId});await flush();tree=m.render();assert.equal(nav(tree).nextDisabled,false);
 }
});

test('missing or different-room responses do not unlock P4',async()=>{
 for(const result of [null,{roomId:'different-room'}]){
  const m=mount(()=>Promise.resolve(result));m.render();await flush();const tree=m.render();
  assert.equal(nav(tree).nextDisabled,true);assert.match(text(tree),/확인하지 못/);assert.ok(retry(tree));
 }
});

test('local demo stays usable without a pool request; valid empty server pool is distinct from an error',async()=>{
 const demo=mount(()=>{throw new Error('demo must not fetch');},null);let tree=demo.render();
 assert.equal(demo.calls,0);assert.equal(nav(tree).nextDisabled,false);assert.match(text(tree),/글리코 장소 카드/);
 const online=mount(()=>Promise.resolve({roomId:'room-a',placeIds:[]}));online.trip.pool=[];online.trip.state.extra.mustList=[];online.trip.state.mine.picks=[];
 online.render();await flush();tree=online.render();assert.match(text(tree),/아직 모인 곳이 없어요/);assert.equal(retry(tree),undefined);assert.equal(nav(tree).nextDisabled,true);
});
