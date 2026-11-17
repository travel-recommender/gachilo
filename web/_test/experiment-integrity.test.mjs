import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {assignment, strategyOf} from '../src/lib/experiment.ts';
import {badgeOf, branchNoteOf} from '../src/lib/shared-flow.ts';
const require=Module.createRequire(import.meta.url);
function load(relative,mocks) {
 const filename=fileURLToPath(new URL(relative,import.meta.url));
 const mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
 mod.require=request=>request in mocks?mocks[request]:require(request);
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX},fileName:filename}).outputText,filename);
 return mod.exports;
}
const NavButtons=()=>null,Survey=()=>null;
const strategies=['average','least_misery','fairness'];
function render(count,online=true,assigned=true,member="m1",selected=null) {
 const snap={status:count===3?'awaiting_selection':'collecting',candidates:strategies.slice(0,count).map(strategy=>({strategy,metrics:{walkStepsPerDay:1,costKrwPerDay:1,totalKmPerDay:1}}))};
 const mocks={
  react:{useMemo:fn=>fn(),useEffect:()=>{},useState:value=>[value === null ? selected : value,()=>{}]},
  'next/navigation':{useRouter:()=>({push:()=>{}})},
  '@/components/store':{useTrip:()=>({state:{nights:3,allowPartial:false,strategy:'average',mine:{}},submissions:[],set:()=>{},setExtra:()=>{}})},
  '@/lib/consensus':{buildConsensus:()=>({selections:[]}),kmToSteps:()=>0},
  '@/lib/schedule':{buildSchedule:()=>({plans:[]}),kmToSteps:()=>0},
  '@/lib/explain':{explainResult:()=>[]},
  '@/lib/room-api':{FALLBACK_RATE:{krwPerJpy:9.5}},
  '@/lib/shared-flow':{hasCandidates:s=>s?.candidates.length===3},
  '@/lib/weather-route-notice':{withoutWeatherRouteNotice:x=>x},
  '@/components/ExperimentSurveyLink':{ExperimentSurveyLink:Survey},
  '@/components/WeatherRouteNotice':{WeatherRouteNotice:()=>null},
  '@/components/useSharedResults':{useSharedResults:()=>({online,snap})},
  '@/lib/experiment':{EXPERIMENT_MODE:true,experimentStatusLine:()=>'',scheduleName:l=>'일정 '+l,experimentExplanation:()=>["일정 설명 테스트"]},
  '@/components/useExperiment':{useExperiment:()=>assigned?assignment("room",member,["m1","m2","m3"]):null},
  '@/lib/places':{findPlace:()=>null},
  '@/components/gachiro':{NavButtons,Page:()=>null,PlanHeader:()=>null,asset:s=>s},
 };
 return load('../app/result/page.tsx',mocks).default();
}
function elements(tree,predicate) {
 if(Array.isArray(tree))return tree.flatMap(x=>elements(x,predicate));
 if(!tree||typeof tree!=='object')return [];
 return [...(predicate(tree)?[tree]:[]),...elements(tree.props?.children,predicate)];
}
test('survey appears only after all three shared candidates and assignment are available',()=>{
 for(const n of [0,1,2])assert.equal(elements(render(n),x=>x.type===Survey).length,0);
 assert.equal(elements(render(3,false),x=>x.type===Survey).length,0);
 assert.equal(elements(render(3,true,false),x=>x.type===Survey).length,0);
 assert.equal(elements(render(3),x=>x.type===Survey).length,1);
});
test('experiment result disables navigation back to editable input',()=>{
 assert.equal(render(3).props.nav.type,NavButtons);
 assert.equal(render(3).props.nav.props.prev,false);
});
test('false prev actually removes back button; omitted prev retains normal navigation',()=>{
 let backs=0;
 const {NavButtons:Buttons}=load('../src/components/gachiro.tsx',{'next/navigation':{useRouter:()=>({back:()=>backs++,push:()=>{}})}});
 const fixed=elements(Buttons({prev:false,next:()=>{}}),x=>x.type==='button');
 assert.equal(fixed.length,1);
 const normal=elements(Buttons({next:()=>{}}),x=>x.type==='button');
 assert.equal(normal.length,2);normal[0].props.onClick();assert.equal(backs,1);
});

test('P7 shows explanations for every candidate only for participants 02/03',()=>{
 for(const [i,member] of ['m1','m2','m3'].entries())for(const strategy of strategies){
  const tree=render(3,true,true,member,strategy);
  assert.equal(JSON.stringify(tree).includes('일정 설명 테스트'),i>0,member+strategy);
  assert.equal(elements(tree,x=>x.props?.role==='radio').length,3);
 }
});
function plan(member,letter){
 const noop=()=>null,candidates=strategies.map(strategy=>({strategy,days:[{date:'2026-11-17',items:[
  {placeId:'new',source:'selected',startMin:600,branch:{fromPlaceId:'old',reasonCode:'shorter_route',savedMin:10}},
  {placeId:'ai',source:'ai_added',startMin:660,reason:'추천 이유 테스트'},
 ]}]}));
 const mocks={
  react:{Suspense:noop,useMemo:f=>f(),useEffect:()=>{},useState:v=>[v,()=>{}],useRef:()=>({current:null})},
  'next/navigation':{useRouter:()=>({push:()=>{}}),useSearchParams:()=>new URLSearchParams({c:letter})},
  '@/components/store':{useTrip:()=>({state:{room:{roomId:'room'},extra:{planEdits:{}},nights:3},catalog:'real',setExtra:noop})},
  '@/components/ExperimentSurveyLink':{ExperimentSurveyLink:Survey},
  '@/components/PlaceFinder':{PlaceFinder:noop,placeLine:()=>''},
  '@/components/WeatherRouteNotice':{WeatherRouteNotice:noop},
  '@/components/PlanMap':{PlanMap:noop},
  '@/components/VisitConditionsPanel':{VisitConditionsPanel:noop},
  '@/lib/places':{findPlace:id=>({id,name:id}),CATEGORY_MAP:{}},
  '@/lib/explain':{explainPlace:noop},
  '@/lib/shared-flow':{badgeOf,branchNoteOf,hasCandidates:()=>true},
  '@/lib/shared-results-api':{selectedCandidate:()=>null},
  '@/components/useSharedResults':{useSharedResults:()=>({online:true,snap:{candidates}})},
  '@/components/gachiro':{Box:noop,MinusButton:noop,NavButtons:noop,Page:noop,PlanHeader:noop,Sheet:noop,TextTabs:noop,asset:x=>x},
  '@/lib/schedule':{fmtTime:()=>"10:00"},
  '@/lib/experiment':{EXPERIMENT_MODE:true,scheduleName:x=>'일정 '+x,strategyOf},
  '@/components/useExperiment':{useExperiment:()=>assignment('room',member,['m1','m2','m3'])},
 };
 const outer=load('../app/plan/page.tsx',mocks).default();return outer.props.children.type();
}
test('P8 retains factual labels and times but hides all recommendation/branch reasons from 01',()=>{
 for(const [i,member] of ['m1','m2','m3'].entries())for(const letter of ['A','B','C']){
  const tree=plan(member,letter),row=elements(tree,x=>x.props?.badges&&x.props?.branches)[0].props;
  assert.equal(row.badges.ai.label,'AI 추천');assert.equal(row.times.new,'10:00');
  assert.equal(typeof row.badges.ai.reason==='string',i>0,member+letter);
  assert.equal(typeof row.branches.new.reason==='string',i>0,member+letter);
  assert.equal(JSON.stringify(tree).includes('추천 이유 테스트'),i>0);
  assert.ok(row.branches.new.from.includes('old'));
 }
});
