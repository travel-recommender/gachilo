/** 수정안 검증: 관문을 전략과 무관한 양(평균 효용)으로 바꾸면 방향이 맞게 나오나? */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = new URL('../../backend/engine', import.meta.url).href;
const src=fs.readFileSync(new URL(`${ROOT}/consensus.ts`),'utf8');
// 관문만 바꾼 사본을 만든다 (원본은 안 건드림)
const patched=src.replace(
  'if (score < 0.3) continue;',
  'if (subs.map((s) => utilityOf(place, s)).reduce((a, b) => a + b, 0) / subs.length < 0.3) continue;'
);
if(patched===src) throw new Error('패치 지점 못 찾음');
// 원본은 건드리지 않고, 임시 폴더에 사본을 만들어 패치한다
const PATCHED = pathToFileURL(path.join(os.tmpdir(), 'consensus_patched.ts'));
fs.writeFileSync(PATCHED, patched.replace(/from "\.\//g, `from "${ROOT}/`));

const {setCustomPlaces}=await import(`${ROOT}/places.ts`);
const raw=JSON.parse(fs.readFileSync(new URL('./places150.json', import.meta.url),'utf8'));
setCustomPlaces(raw.map(o=>({id:o.id,name:o.name,area:o.area||'미상',category:o.category,lat:o.lat,lng:o.lng,
  cost:o.cost??15000,stayMin:o.stayMin,openFrom:540,openTo:1260,exposure:0.6,covered:o.covered??false,
  bagLoad:o.bagLoad,popularity:0.5,blurb:'',custom:true})));

const mul=(s)=>{let a=s>>>0;return()=>{a|=0;a=(a+0x6d2b79f5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;}};
const STRATS=['average','least_misery','fairness'];

async function evaluate(label, mod){
  const {buildConsensus}=mod;
  const rnd=mul(20261014);
  let n=0; const d={min:[],gini:[]}; const size_={};
  for(const st of STRATS) size_[st]=0;
  for(let g=0;g<300;g++){
    const sz=3+Math.floor(rnd()*3);
    const pool=[];while(pool.length<30){const p=raw[Math.floor(rnd()*raw.length)];if(!pool.includes(p))pool.push(p);}
    const subs=Array.from({length:sz},(_,k)=>{
      const picks=[];while(picks.length<2){const p=pool[Math.floor(rnd()*pool.length)].id;if(!picks.includes(p))picks.push(p);}
      let veto=null,g2=0;do{veto=pool[Math.floor(rnd()*pool.length)].id;}while(picks.includes(veto)&&++g2<30);
      return {memberId:'m'+k,longlist:pool.map(p=>p.id),picks,must:picks[0],veto,
        budgetPerDay:40000+Math.floor(rnd()*60000),stepLimit:7000+Math.floor(rnd()*6000),activeMin:360+Math.floor(rnd()*180)};
    });
    const res={};for(const st of STRATS) res[st]=buildConsensus({submissions:subs,nights:5,strategy:st,allowPartial:true});
    if(new Set(STRATS.map(st=>res[st].core.map(c=>c.place.id).sort().join('|'))).size===1) continue;
    n++;
    for(const st of STRATS) size_[st]+=res[st].core.length;
    d.min.push(res.least_misery.metrics.min-res.average.metrics.min);
    d.gini.push(res.fairness.metrics.gini-res.average.metrics.gini);
  }
  const avg=x=>x.reduce((a,b)=>a+b,0)/x.length;
  const t=x=>{const m=avg(x);const sd=Math.sqrt(x.reduce((a,b)=>a+(b-m)**2,0)/x.length);return sd?m/(sd/Math.sqrt(x.length)):0;};
  console.log(`\n■ ${label}  (갈린 그룹 ${n}개)`);
  console.log(`  코어 크기   average ${(size_.average/n).toFixed(1)}곳 · least_misery ${(size_.least_misery/n).toFixed(1)}곳 · fairness ${(size_.fairness/n).toFixed(1)}곳`);
  console.log(`  least_misery가 최저멤버를 올리나   ${avg(d.min)>=0?'+':''}${avg(d.min).toFixed(4)}  (t ${t(d.min).toFixed(1)})  ${avg(d.min)>0?'✓ 맞는 방향':'✗ 반대'}`);
  console.log(`  fairness가 지니를 낮추나           ${avg(d.gini)>=0?'+':''}${avg(d.gini).toFixed(4)}  (t ${t(d.gini).toFixed(1)})  ${avg(d.gini)<0?'✓ 맞는 방향':'✗ 반대'}`);
}

await evaluate('현재 — 관문이 score < 0.3 (전략마다 축이 다름)', await import(`${ROOT}/consensus.ts`));
await evaluate('수정안 — 관문을 평균 효용 < 0.3 으로 (전략 무관)', await import(PATCHED.href));
