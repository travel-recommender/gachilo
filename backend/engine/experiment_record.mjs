import fs from 'node:fs';
import {assignment} from '../../web/src/lib/experiment.ts';
import {satisfactionOf} from './consensus.ts';
function record(p) {
const assigned=assignment(p.roomId,p.memberId,p.memberIds);
if(!assigned)throw Error('unknown member');
if(!p.candidate){return assigned;}
else {
 const c=p.candidate, ids=[...new Set(c.days.flatMap(d=>d.placeIds))];
 const selections=ids.map(id=>({place:{id},tier:'core',participants:[]}));
 const scores=p.submissions.map(s=>satisfactionOf({...s,budget:s.budgetPerDay,walkLimit:s.stepLimit},selections,c.metrics.costKrwPerDay,c.metrics.walkStepsPerDay));
 const mine=scores.find(s=>s.memberId===p.memberId), values=scores.map(s=>s.score);
 const slot=assigned.slots.find(s=>s.strategy===c.strategy);
 return {seat:assigned.seat,...slot,automatic:mine,
  group:{mean:values.reduce((a,b)=>a+b,0)/values.length,min:Math.min(...values),gap:Math.max(...values)-Math.min(...values)},
  metrics:c.metrics,placeIds:ids,metricBasis:'satisfactionOf; scheduled union; candidate per-day cost and walking; engine score is not a participant answer'};
}

}
const payload=JSON.parse(fs.readFileSync(0,'utf8'));
process.stdout.write(JSON.stringify(Array.isArray(payload)?payload.map(record):record(payload)));
