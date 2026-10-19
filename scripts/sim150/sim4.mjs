/** 찜 개수 · 겹침 정도 · 여행 길이를 바꿔가며, 전략 차이가 언제 드러나는지 본다. */
import fs from 'node:fs';
const ROOT = new URL('../../backend/engine', import.meta.url).href;
const {buildConsensus}=await import(`${ROOT}/consensus.ts`);
const {setCustomPlaces}=await import(`${ROOT}/places.ts`);
const raw=JSON.parse(fs.readFileSync(new URL('./places150.json', import.meta.url),'utf8'));
const mul=(s)=>{let a=s>>>0;return()=>{a|=0;a=(a+0x6d2b79f5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;}};
setCustomPlaces(raw.map(o=>({id:o.id,name:o.name,area:o.area||'미상',category:o.category,lat:o.lat,lng:o.lng,
  cost:o.cost??15000,stayMin:o.stayMin,openFrom:540,openTo:1260,exposure:0.6,covered:o.covered??false,
  bagLoad:o.bagLoad,popularity:0.5,blurb:'',custom:true})));
const STRATS=['average','least_misery','fairness'];

/** shortlistN: 그룹이 공유하는 후보 풀 크기(작을수록 찜이 겹침) */
function scenario({picksEach, nights, shortlistN, label}){
  const rnd=mul(20261014);
  let differ=0, n=0; const pair={min:[],gini:[],mean:[]}; let coreN=0, fromPicks=0;
  for(let g=0;g<300;g++){
    const size=3+Math.floor(rnd()*3);
    // 그룹이 공유하는 후보 풀 — 실제 서비스의 '롱리스트'에 해당
    const pool=[]; while(pool.length<shortlistN){const p=raw[Math.floor(rnd()*raw.length)];if(!pool.includes(p))pool.push(p);}
    const subs=Array.from({length:size},(_,k)=>{
      const picks=[];while(picks.length<picksEach){const p=pool[Math.floor(rnd()*pool.length)].id;if(!picks.includes(p))picks.push(p);}
      let veto=null,guard=0; do{veto=pool[Math.floor(rnd()*pool.length)].id;}while(picks.includes(veto)&&++guard<30);
      return {memberId:'m'+k,longlist:pool.map(p=>p.id),picks,must:picks[0],veto,
        budgetPerDay:40000+Math.floor(rnd()*60000),stepLimit:7000+Math.floor(rnd()*6000),activeMin:360+Math.floor(rnd()*180)};
    });
    const allPicks=new Set(subs.flatMap(s=>s.picks));
    const res={}; for(const st of STRATS) res[st]=buildConsensus({submissions:subs,nights,strategy:st,allowPartial:true});
    const keys=STRATS.map(st=>res[st].core.map(c=>c.place.id).sort().join('|'));
    if(new Set(keys).size===1) continue;
    differ++; n++;
    const ids=res.average.core.map(c=>c.place.id);
    coreN+=ids.length; fromPicks+=ids.filter(id=>allPicks.has(id)).length;
    pair.min.push(res.least_misery.metrics.min-res.average.metrics.min);
    pair.gini.push(res.fairness.metrics.gini-res.average.metrics.gini);
    pair.mean.push(res.average.metrics.mean-res.least_misery.metrics.mean);
  }
  const avg=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
  const t=xs=>{if(xs.length<2)return 0;const m=avg(xs);const sd=Math.sqrt(xs.reduce((a,b)=>a+(b-m)**2,0)/xs.length);return sd?m/(sd/Math.sqrt(xs.length)):0;};
  console.log(` ${label.padEnd(30)} ${String(differ).padStart(3)}/300  ${(coreN/n).toFixed(1)}곳중 ${(fromPicks/n).toFixed(1)}곳찜  ` +
    `min${avg(pair.min)>=0?'+':''}${avg(pair.min).toFixed(4)}(t${t(pair.min).toFixed(1)})  gini${avg(pair.gini)>=0?'+':''}${avg(pair.gini).toFixed(4)}(t${t(pair.gini).toFixed(1)})`);
}

console.log('조건별 — 전략이 갈린 그룹 / 코어 구성 / least_misery가 최저멤버를 올리나 / fairness가 지니를 낮추나\n');
console.log('조건                              갈림      코어구성          least_misery      fairness');
console.log('─'.repeat(100));
scenario({picksEach:5, nights:2, shortlistN:139, label:'기본 (찜5 · 2박 · 후보139)'});
scenario({picksEach:5, nights:2, shortlistN:20,  label:'후보 좁힘 20곳 (찜 겹침↑)'});
scenario({picksEach:5, nights:2, shortlistN:12,  label:'후보 좁힘 12곳 (찜 많이겹침)'});
scenario({picksEach:3, nights:2, shortlistN:139, label:'찜 3곳만'});
scenario({picksEach:2, nights:2, shortlistN:139, label:'찜 2곳만 (자리 > 찜)'});
scenario({picksEach:5, nights:5, shortlistN:139, label:'5박 (자리 18 > 찜)'});
scenario({picksEach:2, nights:5, shortlistN:30,  label:'찜2 · 5박 · 후보30'});
