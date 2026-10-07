import {buildConsensus} from './consensus.ts';
import {staysByDay, validateStays, validateSubmissions, groupTradeoffs, distanceWeightFor} from './inputs.ts';
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
  // 7주차 입력 확장: 꼭/제외 목록, 트레이드오프, 날짜별 숙소. 잘못된 입력은 계산 전에 돌려준다.
  const issues=[...validateSubmissions(request.submissions),...validateStays(request.stays)];
  if(issues.length){process.stdout.write(JSON.stringify({error:'invalid_input',issues}));process.exit(0);}
  const consensus=buildConsensus({submissions:request.submissions,nights:days-1,strategy:request.strategy,allowPartial:true});
  const stays=staysByDay(request.stays,request.startDate,days);
  const fallbackSummary=`기존 프로토타입 계산으로 ${days}일 후보 일정을 만들었습니다. 시연용 장소·비용과 추정 이동시간을 사용합니다. 날짜별 휴무 및 개인별 제약 충족은 아직 보장하지 않습니다.`;
  const enriched=await enrich(consensus,request.submissions,days,fallbackSummary,
    {staysByDay:stays.byDay,distanceWeight:distanceWeightFor(groupTradeoffs(request.submissions).distance)});
  const schedule=enriched.schedule;
  const dates=schedule.plans.map((plan,i)=>({date:new Date(Date.parse(request.startDate+'T00:00:00Z')+i*86400000).toISOString().slice(0,10),placeIds:plan.items.map(item=>item.place.id)}));
  // 디버그 출력은 한 줄짜리 JSON 하나로 유지한다 (테스트가 stderr 전체를 JSON으로 읽는다)
  if(process.env.AI_DEBUG==='1')process.stderr.write(JSON.stringify({...enriched.ai,
    stayConflicts:stays.conflicts,
    dayStays:schedule.plans.map(p=>({day:p.day,stay:p.stayName??null,out:p.stayOutKm??null,back:p.stayBackKm??null,walkKm:p.walkKm}))})+'\n');
  // Publish group itinerary only; never expose individual preferences or satisfaction.
  process.stdout.write(JSON.stringify({strategy:request.strategy,days:dates,summary:enriched.summary}));
}
