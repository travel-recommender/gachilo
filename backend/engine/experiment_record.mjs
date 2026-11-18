import fs from 'node:fs';
import {assignment} from '../../web/src/lib/experiment.ts';
import {satisfactionOf} from './consensus.ts';
import {withPlaceCatalog} from './places.ts';
import {loadRuntimeInputs} from '../../scripts/validate_real_schedule.mjs';
// 지점 자동 배치(#74): 고른 곳 대신 같은 교체 그룹의 다른 지점이 들어갔으면 엔진(real_candidates.mjs covered)과 같이 반영된 것으로 센다.
// 실제 카탈로그 ID로 채점한다. 기본(데모) 카탈로그로 채점하면 꼭 가기·제외가 '없는 장소'로 걸러져
// 1순위·제외 항목이 늘 만점이 된다(mustsOf·vetoesOf가 findPlace로 거름). sensitivity.mjs와 같은 방식.
let runtime=null;
const catalog=()=>runtime??=(()=>{const places=loadRuntimeInputs().dataset.places;
 return {ids:places.map(r=>({id:r.place.place_id})),groups:new Map(places.filter(r=>r.place.branch_group_id).map(r=>[r.place.place_id,r.place.branch_group_id]))};})();
const groupOf=id=>catalog().groups.get(id);
function record(p) {
const assigned=assignment(p.roomId,p.memberId,p.memberIds);
if(!assigned)throw Error('unknown member');
if(!p.candidate){return assigned;}
else {
 const c=p.candidate, ids=[...new Set(c.days.flatMap(d=>d.placeIds))];
 const fromIds=new Set(c.days.flatMap(d=>(d.items??[]).flatMap(i=>i.branch?[i.branch.fromPlaceId]:[])));
 const placedGroups=new Set(ids.map(groupOf).filter(Boolean));
 const covered=id=>fromIds.has(id)||(groupOf(id)!==undefined&&placedGroups.has(groupOf(id)));
 // 제외한 곳은 넣지 않는다: 그 사람이 고른 곳(찜·꼭 가기)만 반영으로 더하므로 제외 판정은 실제 배치 그대로다.
 const scores=p.submissions.map(s=>{
  const own=[...(s.picks??[]),...(s.musts??[]),...(s.must?[s.must]:[])].filter(id=>!ids.includes(id)&&covered(id));
  const selections=[...ids,...new Set(own)].map(id=>({place:{id},tier:'core',participants:[]}));
  return withPlaceCatalog(catalog().ids,()=>satisfactionOf({...s,budget:s.budgetPerDay,walkLimit:s.stepLimit},selections,c.metrics.costKrwPerDay,c.metrics.walkStepsPerDay));
 });
 const mine=scores.find(s=>s.memberId===p.memberId), values=scores.map(s=>s.score);
 const slot=assigned.slots.find(s=>s.strategy===c.strategy);
 return {seat:assigned.seat,...slot,automatic:mine,
  group:{mean:values.reduce((a,b)=>a+b,0)/values.length,min:Math.min(...values),gap:Math.max(...values)-Math.min(...values)},
  metrics:c.metrics,placeIds:ids,metricBasis:'satisfactionOf; scheduled union (picks placed as another branch of the same group count as placed); candidate per-day cost and walking; engine score is not a participant answer'};
}

}
const payload=JSON.parse(fs.readFileSync(0,'utf8'));
process.stdout.write(JSON.stringify(Array.isArray(payload)?payload.map(record):record(payload)));
