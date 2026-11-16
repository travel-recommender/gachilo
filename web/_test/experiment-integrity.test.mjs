import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
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
function render(count,online=true,assigned=true) {
 const snap={status:count===3?'awaiting_selection':'collecting',candidates:strategies.slice(0,count).map(strategy=>({strategy,metrics:{walkStepsPerDay:1,costKrwPerDay:1,totalKmPerDay:1}}))};
 const mocks={
  react:{useMemo:fn=>fn(),useEffect:()=>{},useState:value=>[value,()=>{}]},
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
  '@/lib/experiment':{EXPERIMENT_MODE:true,experimentStatusLine:()=>'',scheduleName:l=>'일정 '+l,experimentExplanation:()=>[]},
  '@/components/useExperiment':{useExperiment:()=>assigned?{slots:strategies.map((strategy,i)=>({strategy,letter:'ABC'[i],explained:false}))}:null},
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
