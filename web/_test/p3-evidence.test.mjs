import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const require=Module.createRequire(import.meta.url);
function load(relative,mocks={}) {
 const filename=fileURLToPath(new URL(relative,import.meta.url));
 const mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
 mod.require=request=>request in mocks?mocks[request]:require(request);
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX},fileName:filename,
 }).outputText,filename);
 return mod.exports;
}
const evidence=load('../src/lib/place-recommendations.ts');
function hooks() {
 let index=0;const values=[],effects=[],pending=[];
 return {
  react:{
   useState(initial){const i=index++;if(!(i in values))values[i]=initial;return [values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v;}];},
   useEffect(fn,deps){const i=index++,prior=effects[i];if(!prior||deps.some((v,n)=>v!==prior.deps[n]))pending.push(()=>{prior?.cleanup?.();effects[i]={deps,cleanup:fn()};});},
  },
  render(fn){index=0;return fn();},
  flush(){while(pending.length)pending.shift()();},
  close(){for(const effect of effects)effect?.cleanup?.();},
 };
}
const tick=()=>new Promise(r=>setImmediate(r));
function harness() {
 const h=hooks(),calls=[];
 const {usePlaceRecommendations:use}=load('../src/components/usePlaceRecommendations.ts',{
  react:h.react,'@/lib/room-api':{API_BASE:''},
  '@/lib/place-recommendations':{createRecommendationClient:()=> (request,signal)=>new Promise((resolve,reject)=>calls.push({request,signal,resolve,reject}))},
 });
 return {...h,calls,view:request=>h.render(()=>use(request))};
}
const request={roomId:'r',memberId:'m',token:'one',dataset:'osaka_review_150',placeId:'a',excludePlaceIds:['a']};
const payload={recommendations:[],countUnit:'room_member_list',eligibility:'at_least_one_trip_date'};

test('source/list/session changes hide old evidence before effects and reject late responses',async()=>{
 for(const change of [{placeId:'b'}, {excludePlaceIds:['a','b']}, {token:'two'}, {roomId:'other'}, {memberId:'other'}]){
  const h=harness();assert.equal(h.view(request).loading,true);h.flush();
  h.calls[0].resolve(payload);await tick();assert.equal(h.view(request).data,payload);
  const next={...request,...change};assert.equal(h.view(next).data,null);h.flush();
  assert.equal(h.calls[0].signal.aborted,true);
  h.calls[1].resolve({...payload,marker:'new'});await tick();assert.equal(h.view(next).data.marker,'new');h.close();
 }
 const h=harness();h.view(request);h.flush();h.view({...request,placeId:'b'});h.flush();
 h.calls[1].resolve({...payload,marker:'new'});await tick();h.calls[0].resolve({...payload,marker:'old'});await tick();
 assert.equal(h.view({...request,placeId:'b'}).data.marker,'new');h.close();
});

test('failure requires an explicit retry and disabled/unmounted hooks discard late results',async()=>{
 const h=harness();h.view(request);h.flush();h.calls[0].reject(new Error('offline'));await tick();
 const failed=h.view(request);assert.equal(failed.error,'offline');h.flush();assert.equal(h.calls.length,1);
 failed.retry();assert.equal(h.view(request).loading,true);h.flush();assert.equal(h.calls.length,2);
 assert.equal(h.view(null).data,null);h.flush();assert.equal(h.calls[1].signal.aborted,true);
 h.calls[1].resolve(payload);await tick();assert.equal(h.view(null).data,null);h.close();
});

function nodes(tree){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(nodes);return [tree,...nodes(tree.props?.children)];}
function words(tree){if(typeof tree==='string'||typeof tree==='number')return String(tree);if(!tree)return '';if(Array.isArray(tree))return tree.map(words).join(' ');return words(tree.props?.children);}
const places=new Map(['a','b','c','disabled'].map(id=>[id,{id,name:id,area:'난바',category:'cafe',selectionDisabledReason:id==='disabled'?'closed':null}]));
function cards(data,added=['a'],rest={}){
 let sent,clicked=[];
 const {PlaceRecommendations}=load('../src/components/PlaceRecommendations.tsx',{
  '@/components/usePlaceRecommendations':{usePlaceRecommendations:r=>{sent=r;return {data,error:null,loading:false,retry(){},...rest};}},
  '@/lib/places':{findPlace:id=>places.get(id),CATEGORIES:[{id:'cafe',label:'카페'}]},
  '@/lib/place-recommendations':evidence,
 });
 const tree=PlaceRecommendations({room:request,catalog:'real',sourceId:'a',added,disabled:false,onAdd:p=>clicked.push(p.id)});
 return {tree,sent,clicked};
}
test('cards show the real list count and a separate fallback explanation; unknown/disabled/selected cards are absent',()=>{
 const make=(placeId,coPickCount,reason)=>({placeId,coPickCount,reason});
 const data={...payload,recommendations:[make('b',7,'co_pick'),make('c',0,'same_area')]};
 const {tree,clicked}=cards(data);
 assert.match(words(tree),/7개 참여 목록에서 함께 담김/);assert.match(words(tree),/같은 지역/);
 assert.doesNotMatch(words(tree),/7명|0명|0개 참여/);
 const add=nodes(tree).find(n=>n.type==='button'&&n.props['aria-label']==='b 담기');add.props.onClick();assert.deepEqual(clicked,['b']);
 const hidden=cards({...data,recommendations:[make('missing',3,'co_pick'),make('disabled',2,'co_pick'),make('b',1,'co_pick')]},['a','b']);
 assert.match(words(hidden.tree),/추천할 수 있는 다른 장소가 없어요/);
 assert.equal(nodes(hidden.tree).filter(n=>n.type==='button').length,0);
});
test('capacity disables adding, removed sources request nothing, and errors retain a retry',()=>{
 const data={...payload,recommendations:[{placeId:'b',coPickCount:1,reason:'co_pick'}]};
 const full=cards(data,['a',...Array.from({length:29},(_,i)=>`extra${i}`)]);
 assert.equal(nodes(full.tree).find(n=>n.type==='button').props.disabled,true);
 const removed=cards(data,[]);assert.equal(removed.tree,null);assert.equal(removed.sent,null);
 const failed=cards(null,['a'],{error:'offline'});assert.match(words(failed.tree),/추천 다시 조회/);assert.doesNotMatch(words(failed.tree),/함께 담김/);
});

test('actual P3 add updates longlist only and never persists a recommendation or sets must/picks automatically',async()=>{
 const h=hooks();let saved=0;const patches=[];const router=[];
 const state={room:{roomId:'r',memberId:'m',token:'one'},mine:{longlist:['a'],picks:['a'],must:'a'}};
 const PlaceFinder=()=>null,PlaceRecommendations=()=>null,NavButtons=()=>null;
 const {default:Pick}=load('../app/pick/page.tsx',{
  react:h.react,'next/navigation':{useRouter:()=>({push:p=>router.push(p)})},
  '@/components/store':{useTrip:()=>({state,catalog:'real',setMine:p=>{patches.push(p);state.mine={...state.mine,...p};},saveLonglist:async()=>{saved++;}})},
  '@/components/PlaceFinder':{PlaceFinder,placeLine:()=>''},'@/components/PlaceRecommendations':{PlaceRecommendations},
  '@/lib/places':{CATEGORIES:[{id:'cafe',label:'카페'}],findPlace:id=>places.get(id)},
  '@/components/gachiro':{Box:()=>null,MinusButton:()=>null,NavButtons,Page:()=>null,PlanHeader:()=>null},
 });
 let tree=h.render(Pick);nodes(tree).find(n=>n.type===PlaceFinder).props.onPick(places.get('b'));
 tree=h.render(Pick);const props=nodes(tree).find(n=>n.type===PlaceRecommendations).props;
 assert.equal(props.sourceId,'b');assert.deepEqual(props.added,['a','b']);
 props.onAdd(places.get('c'));tree=h.render(Pick);
 assert.deepEqual(patches,[{longlist:['a','b']},{longlist:['a','b','c']}]);
 assert.equal(state.mine.must,'a');assert.deepEqual(state.mine.picks,['a']);assert.equal(saved,0);
 await tree.props.nav.props.next();assert.equal(saved,1);assert.deepEqual(router,['/waiting?step=list']);
 state.room={...state.room,token:'new-session'};tree=h.render(Pick);
 assert.equal(nodes(tree).some(n=>n.type===PlaceRecommendations),false);
});
