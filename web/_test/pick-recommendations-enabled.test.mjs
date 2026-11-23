import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';

test('experiment P3 mounts recommendations after adding a place and preserves must-go input',()=>{
 const values=[];let cursor=0;
 const state={room:{roomId:'r',memberId:'m',token:'t'},mine:{longlist:[],picks:[],must:null}};
 const mocks={react:{useState:initial=>{const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],v=>values[i]=v];}},
  'react/jsx-runtime':jsx,'next/navigation':{useRouter:()=>({push(){}})},
  '@/components/store':{useTrip:()=>({state,catalog:'real',setMine:delta=>Object.assign(state.mine,delta),saveLonglist:async()=>{}})},
  '@/components/PlaceFinder':{PlaceFinder:'Finder',placeLine:()=>''},
  '@/components/PlaceRecommendations':{PlaceRecommendations:'Recommendations'},
  '@/lib/experiment':{EXPERIMENT_MODE:true},'@/lib/p3-limits':{P3_LIST_LIMIT:30},
  '@/lib/places':{CATEGORIES:[],findPlace:id=>({id,name:'Place'})},
  '@/components/gachiro':{Box:'Box',MinusButton:'Minus',NavButtons:'Nav',Page:'Page',PlanHeader:'Header'}};
 const filename=fileURLToPath(new URL('../app/pick/page.tsx',import.meta.url));const mod=new Module(filename);
 mod.require=name=>{assert.ok(name in mocks,name);return mocks[name];};
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,filename);
 const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
 const render=()=>{cursor=0;return nodes(mod.exports.default());};
 let tree=render();assert.equal(tree.filter(n=>n.type==='Recommendations').length,0);
 tree.find(n=>n.type==='Finder').props.onPick({id:'source',name:'Source'});
 tree=render();let rec=tree.find(n=>n.type==='Recommendations');assert.ok(rec);assert.equal(rec.props.sourceId,'source');
 rec.props.onAdd({id:'suggested',name:'Suggested'});tree=render();
 assert.deepEqual(state.mine.longlist,['source','suggested']);assert.deepEqual(state.mine.picks,[]);assert.equal(state.mine.must,null);
 assert.equal(tree.find(n=>n.type==='Recommendations').props.sourceId,'source');
 state.room={roomId:'other',memberId:'m',token:'new'};
 assert.equal(render().filter(n=>n.type==='Recommendations').length,0);
});
