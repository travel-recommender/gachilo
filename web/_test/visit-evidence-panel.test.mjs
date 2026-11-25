import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import * as evidence from '../src/lib/visit-evidence.ts';
import * as conditions from '../src/lib/visit-conditions.ts';
const require=Module.createRequire(import.meta.url);
const row={id:'e1',placeId:'a',field:'operating_exception',value:{closed:true},state:'current',sourceKind:'official_web_review',
  sources:[{url:'https://example.org/closure',kind:'official'}],checkedAt:'2026-11-18',checkedPrecision:'day',freshness:'current',
  validFrom:'2026-11-19',validThrough:'2026-11-19',periodInvalid:false,note:'입점사 공지로 연도 교차 확인'};
function render(invalid=false) {
  const key=JSON.stringify(['r','2026-11-19',['a']]);
  const data={roomId:'r',checkedOn:'2026-11-18',liveSource:'test',profilesCheckedAt:null,places:[{placeId:'a',name:'장소',reviewedThrough:'2026-11-30',
    sources:[{url:'https://example.org/closure',label:'운영 정보',checkedAt:'2026-11-18'}],
    evidence:{schemaVersion:1,placeId:'a',evaluatedOn:'2026-11-18',maxAgeDays:30,entries:invalid?[]:[row]},
    dates:[{date:'2026-11-19',status:'closed',live:'not_checked',openingHours:null,scheduleHours:[],costBasis:null,notices:[],
      evidenceCheck:{date:'2026-11-19',status:'check',reasons:invalid?['evidence_invalid']:['evidence_stale','evidence_date_unknown'],conflicts:[],applicableEvidenceIds:[],usableEvidenceIds:[]}}]}]};
  const filename=fileURLToPath(new URL('../src/components/VisitConditionsPanel.tsx',import.meta.url));
  const mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
  const mocks={react:{useState:()=>[key,()=>{}]},'@/lib/visit-evidence':evidence,'@/lib/visit-conditions':conditions,
    '@/components/useVisitConditions':{useVisitConditions:()=>({data,error:null,loading:false,retry:()=>{}})}};
  mod.require=name=>name in mocks?mocks[name]:require(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX},fileName:filename}).outputText,filename);
  return mod.exports.VisitConditionsPanel({roomId:'r',token:'t',placeIds:['a'],date:'2026-11-19'});
}
function nodes(t,predicate,skipDetails=false){
  if(Array.isArray(t))return t.flatMap(x=>nodes(x,predicate,skipDetails));
  if(!t||typeof t!=='object')return [];
  return [...(predicate(t)?[t]:[]),...(skipDetails&&t.type==='details'?[]:nodes(t.props?.children,predicate,skipDetails))];
}
function text(t){if(Array.isArray(t))return t.map(text).join('');if(t&&typeof t==='object')return text(t.props?.children);return typeof t==='string'||typeof t==='number'?String(t):'';}
test('출처는 details 밖에도 보이고 여러 관리 경고는 상세 안에 모인다',()=>{
  const tree=render();
  assert.equal(nodes(tree,n=>n.type==='a',true).length,1);
  assert.equal(nodes(tree,n=>n.type==='a',true)[0].props.href,'https://example.org/closure');
  const details=nodes(tree,n=>n.type==='details')[0];
  assert.match(text(details),/자료 재확인 2건/);
  assert.match(text(details),/확인한 지 오래된 자료 · 확인일 기록 없음/);
  assert.equal(nodes(tree,n=>n.type==='p'&&text(n).includes('확인한 지 오래된 자료'),true).length,0);
  assert.match(text(details),/공지된 휴무/);
  assert.match(text(details),/입점사 공지로 연도 교차 확인/);
  assert.equal(nodes(tree,n=>n.type==='p'&&!text(n)).length,0);
});
test('오류로 비운 근거도 안내와 기존 링크를 유지한다',()=>{
  const tree=render(true);
  assert.match(text(tree),/운영 근거 형식 오류/);
  assert.equal(nodes(tree,n=>n.type==='a',true).length,1);
});
