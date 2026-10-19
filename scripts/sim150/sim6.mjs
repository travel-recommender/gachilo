/** aiPool 루프의 4개 관문 중 어디서 걸러지는지 실데이터로 센다. */
import fs from 'node:fs';
const ROOT = new URL('../../backend/engine', import.meta.url).href;
const {utilityOf}=await import(`${ROOT}/consensus.ts`);
const {setCustomPlaces,allPlaces}=await import(`${ROOT}/places.ts`);
const raw=JSON.parse(fs.readFileSync(new URL('./places150.json', import.meta.url),'utf8'));
const mul=(s)=>{let a=s>>>0;return()=>{a|=0;a=(a+0x6d2b79f5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;}};
setCustomPlaces(raw.map(o=>({id:o.id,name:o.name,area:o.area||'미상',category:o.category,lat:o.lat,lng:o.lng,
  cost:o.cost??15000,stayMin:o.stayMin,openFrom:540,openTo:1260,exposure:0.6,covered:o.covered??false,
  bagLoad:o.bagLoad,popularity:0.5,blurb:'',custom:true})));
const stdev=xs=>{const m=xs.reduce((a,b)=>a+b,0)/xs.length;return Math.sqrt(xs.reduce((a,b)=>a+(b-m)**2,0)/xs.length)};
const SC={average:u=>u.reduce((a,b)=>a+b,0)/u.length,
          least_misery:u=>Math.min(...u)*0.8+u.reduce((a,b)=>a+b,0)/u.length*0.2,
          fairness:u=>u.reduce((a,b)=>a+b,0)/u.length-0.7*stdev(u)};

const rnd=mul(20261014);
const tally=Object.fromEntries(Object.keys(SC).map(k=>[k,{n:0,minGate:0,scoreGate:0,pass:0,scores:[]}]));
for(let g=0;g<300;g++){
  const size=3+Math.floor(rnd()*3);
  const pool=[]; while(pool.length<30){const p=raw[Math.floor(rnd()*raw.length)];if(!pool.includes(p))pool.push(p);}
  const subs=Array.from({length:size},(_,k)=>{
    const picks=[];while(picks.length<2){const p=pool[Math.floor(rnd()*pool.length)].id;if(!picks.includes(p))picks.push(p);}
    let veto=null,g2=0;do{veto=pool[Math.floor(rnd()*pool.length)].id;}while(picks.includes(veto)&&++g2<30);
    return {memberId:'m'+k,picks,musts:[picks[0]],vetoes:[veto],
      budget:(40000+Math.floor(rnd()*60000))*6, walkLimit:9, activeMin:360+Math.floor(rnd()*180)};
  });
  for(const p of allPlaces()){
    const utils=subs.map(s=>utilityOf(p,s));
    const mn=Math.min(...utils);
    for(const [st,fn] of Object.entries(SC)){
      const sc=fn(utils); const T=tally[st];
      T.n++; T.scores.push(sc);
      if(mn<0.2){T.minGate++;continue;}
      if(sc<0.3){T.scoreGate++;continue;}
      T.pass++;
    }
  }
}
console.log('실데이터 139곳 × 300그룹 — aiPool 관문 통과율\n');
console.log('전략           점수평균  최저효용<0.2로 탈락  점수<0.3으로 탈락   통과');
console.log('─'.repeat(74));
for(const [st,T] of Object.entries(tally)){
  const pc=(x)=>`${(100*x/T.n).toFixed(1)}%`.padStart(6);
  console.log(` ${st.padEnd(13)} ${(T.scores.reduce((a,b)=>a+b,0)/T.n).toFixed(3)}      ${pc(T.minGate)}            ${pc(T.scoreGate)}       ${pc(T.pass)}`);
}
console.log('\n→ 최저효용 관문은 전략과 무관하게 같다(효용은 전략 이전에 계산되므로).');
console.log('  차이는 전부 "점수<0.3" 관문에서 난다.');
