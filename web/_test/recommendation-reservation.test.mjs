import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';

test('추천 카드에 예약 조건을 표시하고 해당 장소를 담을 수 있다', () => {
  const source={id:'source',name:'출발지'};
  const tower={id:'tower',name:'쓰텐카쿠',area:'오사카',reservationNotice:'입장 시간 예약 필요'};
  const mocks={
    'react/jsx-runtime':jsx,
    '@/components/usePlaceRecommendations':{usePlaceRecommendations:()=>({data:{recommendations:[{placeId:'tower'}],eligibility:'at_least_one_trip_date'}})},
    '@/lib/places':{CATEGORIES:[],findPlace:id=>id==='source'?source:id==='tower'?tower:null},
    '@/lib/place-recommendations':{recommendationEvidence:()=> '같은 지역'},
    '@/lib/p3-limits':{P3_LIST_LIMIT:30},
  };
  const filename=fileURLToPath(new URL('../src/components/PlaceRecommendations.tsx',import.meta.url));
  const mod=new Module(filename); mod.require=name=>{assert.ok(name in mocks,name);return mocks[name];};
  mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,filename);
  let chosen;
  const root=mod.exports.PlaceRecommendations({room:{roomId:'r',memberId:'m',token:'t'},catalog:'real',sourceId:'source',added:['source'],disabled:false,onAdd:p=>{chosen=p;}});
  const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
  const all=nodes(root);
  assert.ok(all.some(n=>n.props?.children==='입장 시간 예약 필요'));
  all.find(n=>n.type==='button' && n.props['aria-label']==='쓰텐카쿠 담기').props.onClick();
  assert.equal(chosen,tower);
});
