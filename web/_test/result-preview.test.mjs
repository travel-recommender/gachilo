import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

// Exercise P7's actual local-candidate builder with the real consensus and scheduler.
const originalResolve=Module._resolveFilename;
Module._resolveFilename=function(request,...args){
 for(const candidate of [request,request+'.ts']) {
  try{return originalResolve.call(this,candidate,...args);}catch{}
 }
 return originalResolve.call(this,request,...args);
};
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},fileName:filename,
}).outputText,filename);
const require=Module.createRequire(import.meta.url);
const consensus=require('../src/lib/consensus.ts');
const {buildSchedule}=require('../src/lib/schedule.ts');
const {setCatalog}=require('../src/lib/places.ts');
const place=(id,category)=>({id,name:id,area:'test',category,cost:1000,stayMin:60,openFrom:480,openTo:1320,lat:34.67,lng:135.5,bagLoad:0});
const catalog=[place('meal-a','food'),place('meal-b','food'),place('museum','culture')];

function preview(exclusions) {
 const schedules=[];
 const submissions=[{memberId:'one',activeMin:720,longlist:['museum'],picks:['museum'],must:null,veto:null,budgetPerDay:100000,stepLimit:20000,...exclusions}];
 const mocks={
  react:{useMemo:fn=>fn(),useEffect:()=>{},useState:value=>[value,()=>{}]},
  'next/navigation':{useRouter:()=>({push:()=>{}})},
  '@/components/store':{useTrip:()=>({state:{nights:0,allowPartial:false,strategy:'average'},submissions,set:()=>{},setExtra:()=>{}})},
  '@/lib/consensus':consensus,
  '@/lib/schedule':{buildSchedule:(...args)=>{const result=buildSchedule(...args);schedules.push(result.plans.flatMap(p=>p.items.map(i=>i.place.id)));return result;}},
  '@/lib/explain':{explainResult:()=>[]},
  '@/lib/room-api':{FALLBACK_RATE:{krwPerJpy:9.5}},
  '@/lib/shared-flow':{hasCandidates:()=>false},
  '@/lib/weather-route-notice':require('../src/lib/weather-route-notice.ts'),
  '@/components/WeatherRouteNotice':{WeatherRouteNotice:()=>null},
  '@/components/useSharedResults':{useSharedResults:()=>({online:false,snap:null})},
  '@/lib/experiment':require('../src/lib/experiment.ts'),'@/components/useExperiment':{useExperiment:()=>null},'@/lib/places':{findPlace:()=>null},
  '@/components/gachiro':{NavButtons:()=>null,Page:()=>null,PlanHeader:()=>null,asset:s=>s},
 };
 const filename=fileURLToPath(new URL('../app/result/page.tsx',import.meta.url));
 const mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
 mod.require=request=>request in mocks?mocks[request]:require(request);
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX},fileName:filename,
 }).outputText,filename);
 setCatalog(catalog);
 try{mod.exports.default();return schedules;}finally{setCatalog(null);}
}

test('all three P7 previews exclude the second veto from automatic meal filling',()=>{
 const control=preview({veto:'meal-a'});
 assert.equal(control.length,3);
 for(const ids of control)assert.ok(ids.includes('meal-b'),'fixture must actually add the second restaurant');
 const actual=preview({veto:'meal-a',vetoes:['meal-a','meal-b']});
 assert.equal(actual.length,3);
 for(const ids of actual){assert.ok(ids.includes('museum'));assert.ok(!ids.includes('meal-a'));assert.ok(!ids.includes('meal-b'));}
});
test('an explicit empty veto array clears a stale legacy veto in P7',()=>{
 for(const ids of preview({veto:'meal-a',vetoes:[]}))assert.ok(ids.includes('meal-a'));
});
test('a legacy single veto still applies when the array is absent',()=>{
 for(const ids of preview({veto:'meal-a'})){assert.ok(!ids.includes('meal-a'));assert.ok(ids.includes('meal-b'));}
});
