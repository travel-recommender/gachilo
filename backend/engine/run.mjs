import {buildConsensus} from './consensus.ts';
import {buildSchedule} from './schedule.ts';
import {allPlaces, setMembers} from './places.ts';
import {enrich} from './ai.ts';
if (process.argv.includes('--catalog')) {
  process.stdout.write(JSON.stringify(allPlaces().map(p=>({id:p.id,name:p.name,category:p.category}))));
} else {
  let input='';
  for await (const chunk of process.stdin) input+=chunk;
  const request=JSON.parse(input);
  setMembers(request.members);
  const days=Math.round((Date.parse(request.endDate+'T00:00:00Z')-Date.parse(request.startDate+'T00:00:00Z'))/86400000)+1;
  const consensus=buildConsensus({submissions:request.submissions,nights:days-1,strategy:request.strategy,allowPartial:true});
  const vetoed=new Set(request.submissions.map(s=>s.veto).filter(Boolean));
  const fallbackSummary=`기존 프로토타입 계산으로 ${days}일 후보 일정을 만들었습니다. 시연용 장소·비용과 추정 이동시간을 사용합니다. 날짜별 휴무 및 개인별 제약 충족은 아직 보장하지 않습니다.`;
  const enriched=await enrich(consensus,request.submissions,days,fallbackSummary);
  if(process.env.AI_DEBUG==='1')process.stderr.write(JSON.stringify(enriched.ai)+'\n');
  const schedule=buildSchedule(enriched.selections,days,{considerBags:true,fillMeals:true,vetoed});
  const dates=schedule.plans.map((plan,i)=>({date:new Date(Date.parse(request.startDate+'T00:00:00Z')+i*86400000).toISOString().slice(0,10),placeIds:plan.items.map(item=>item.place.id)}));
  // Publish group itinerary only; never expose individual preferences or satisfaction.
  process.stdout.write(JSON.stringify({strategy:request.strategy,days:dates,summary:enriched.summary}));
}
