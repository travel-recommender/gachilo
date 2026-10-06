/** Human-readable follow-up queue from the same data used by the schedule audit. No network. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {loadInputs} from './validate_real_schedule.mjs';
const {dataset,profiles}=loadInputs();
const audit=JSON.parse(fs.readFileSync(new URL('../data/week5/real_catalog_integration_20260930.json',import.meta.url),'utf8'));
if(audit.source_sha256!==createHash('sha256').update(JSON.stringify(dataset)).digest('hex')
 ||audit.profiles_sha256!==createHash('sha256').update(JSON.stringify(profiles)).digest('hex')) throw Error('Regenerate the catalogue audit first');
const nullNotes={
 '쓰쓰미 교자 포토존':'OSM은 식당이 아닌 사진용 오브젝트. 동일 실물과 주소를 확인하기 전 빈칸 유지.',
 '미하 숍':'나라현 공식 자료의 나카쓰 주소와 원본 도사보리 좌표가 다름. 이전 관계·원본 지점 확인 전 주소를 대입하지 않음.',
 '오에이피 항구':'지도 임시휴업 표시 및 운영 항로·승선일 확인 필요. 운항표를 항구의 상시 영업시간으로 바꾸지 않음.',
 '다이코 하수도 견학시설':'예약 견학 시설. 전화 접수 시간을 방문 시간으로 쓰지 않음. 실제 예약 회차 확인 필요.',
 '게마 갑문':'현행 갑문의 일반인 출입 허용 범위 미확인. 역사 유적/현재 시설을 구분해야 함.',
 '디자인 뮤지엄':'폐업 표시 및 웹사이트 대상 불일치. 기존 ID를 다른 박물관으로 바꾸지 않음.',
 '갤러리 사사키 상점':'공식 스케줄에는 행사별 시간이 있으며 10/1~7 일반 전시 운영을 확인하지 못함. 9/19 워크숍 시간을 상시 영업시간으로 쓰지 않음.',
 '블룸 갤러리':'2026년 4월 매장 일부 재개. 일반 전시는 중단 상태이며 월별 영업일을 확인해야 함.',
 '일본성공회 성속주교회 예배당':'예배당의 일반 관광객 방문 허용·시간 미확인. 예배 시간을 자유 관광 시간으로 쓰지 않음.',
 '신 우메다시티 하나노':'공식 자료는 야외 녹지 소개만 확인. 유료 공중정원 전망대 운영시간을 복사하지 않음.',
 '호타루마치 광장':'부모 시설 주소만 확보. 주차장·주변 식당 시간을 광장에 적용하지 않음.',
 '산와 공원':'도요나카시 시설로 수집 범위 밖. 오사카시 동명 공원으로 대체하지 않음.',
 '헬로 라이프':'공식 소개는 취업 지원 시설. 쇼핑 관광지 분류의 적합성부터 재검토.',
 '뷰르 한큐 미쿠니':'입점 서점의 10~21시만 확인. 복합시설 전체의 공통 시간 또는 방문할 점포를 확정해야 함.',
 '찻집 아오이':'동일 공식 페이지에서 월요일/화요일 휴무·종료시간이 충돌. 날짜 있는 운영자 공지/지도 재확인 필요.',
 '이치란 도톤보리 본점':'구 지점 폐업 표시. 남쪽 별관의 시간·주소로 덮어쓰지 않음.',
};
const checklist=[
 [r=>r.some(x=>x==='google_maps_permanently_closed'),'폐업 표시 장소를 실제 일정에서 제외하고 검증 가능한 다른 후보를 별도 ID로 수집'],
 [r=>r.some(x=>/temporary_closure|temporarily_closed|exhibitions_suspended/.test(x)),'공식 재개관·재운항일/전시 일정을 확인'],
 [r=>r.some(x=>/identity|branch|location_history|address_|website_mismatch|category_mismatch|tenant_scope|outside_osaka|city_boundary|public_viewpoint|parent_facility/.test(x)),'동일 지점·시설 용도·주소·공공 출입 위치를 먼저 확정'],
 [r=>r.some(x=>/reservation|confirmation|access_|attendance|exhibition|event_|ticket_|meal_scenario/.test(x)),'방문 날짜에 맞는 예약·입장/전시·메뉴 조건과 일반 이용 가능 여부를 확인'],
 [r=>r.includes('cost_unknown_or_not_applicable'),'공식 성인 입장권/대표 메뉴의 세금·필수 추가비·적용 시간대를 확인; 미확인 금액을 0으로 넣지 않음'],
 [r=>r.some(x=>/opening_hours_missing|structured_date_profile_missing|hours_conflict|holiday_hours/.test(x)),'공식 또는 명시한 OSM 영업시간을 요일·휴일·마감입장 규칙으로 정규화'],
 [r=>r.some(x=>/closed_on_visit_date|outside_place_reviewed_date_range|price_not_applicable/.test(x)),'휴관/가격 적용 범위를 벗어나지 않는 방문일을 선택'],
];
const byId=new Map(audit.individual_validation.places.map(x=>[x.place_id,x]));
const places=dataset.places.map(r=>{
 const a=byId.get(r.place.place_id);const reasons=[...new Set(a.excluded_date_groups.flatMap(g=>g.reasons))];
 const sources=Object.values(r.field_sources).flatMap(s=>s.urls||(s.url?[s.url]:[]));
 const latest=(r.review.operating_checks||[]).flatMap(s=>s.urls||[]);
 if(r.place.name_ko==='갤러리 사사키 상점')latest.push('https://www.gallerysasaki.com/info/');
 return {place_id:r.place.place_id,name_ko:r.place.name_ko,category:r.place.category,
   passed_individual_model:a.passed_individual_model,eligible_dates:a.eligible_dates,
   remaining_null_fields:r.review.missing_fields,reasons,
   next_actions:a.passed_individual_model?['방문일 임시휴업·예약 및 실제 출입구/이동경로 확인은 별도 필요']:reasons.includes('google_maps_permanently_closed')?[checklist[0][1]]:checklist.filter(([match])=>match(reasons)).map(([,action])=>action),
   missing_address_hours_note:(!r.place.address||!r.place.opening_hours)?nullNotes[r.place.name_ko]||r.review.notes.at(-1):null,
   evidence_urls:[...new Set([...latest,r.place.opening_hours_source,r.place.website,...sources].filter(Boolean))],
   evidence_scope:'기존 필드 출처와 이번 추가 확인을 함께 표시. 이 파일 생성은 모든 출처의 당일 재조회가 아님.',schedule_ready:false};
});
const blocked=places.filter(p=>!p.passed_individual_model);
const report={checked_at:profiles.checked_at,dates:audit.individual_validation.dates,source_sha256:audit.source_sha256,profiles_sha256:audit.profiles_sha256,
 summary:{records:places.length,individual_passed:places.length-blocked.length,needs_followup:blocked.length,address_missing:audit.summary.address_missing,hours_missing:audit.summary.opening_hours_missing},places};
const write=(path,body)=>fs.writeFileSync(new URL(path,import.meta.url),body);
write('../data/week5/remaining_place_checks_20260930.json',JSON.stringify(report,null,2)+'\n');
const esc=s=>String(s??'미확인').replaceAll('|',' / ').replaceAll('\n',' ');
let md=`# 5주차 남은 장소 검증 — ${report.checked_at}\n\n`;
md+=`${report.summary.records}곳을 ${report.dates[0]}~${report.dates.at(-1)}에 각각 계산했다. **${report.summary.individual_passed}곳 모델 통과, ${blocked.length}곳 자료·조건 보류**다. 통과는 현장 방문 가능 보증이 아니며 모든 장소의 schedule_ready는 false다.\n\n주소 ${report.summary.address_missing}곳·영업시간 ${report.summary.hours_missing}곳의 빈칸은 확인되지 않은 사실을 임의로 채우지 않았다. 아래 출처는 기존 검토 기록과 이번 추가 확인을 합친 것이며 전체 장소의 당일 공식 재검증이라는 뜻은 아니다.\n\n## 주소·영업시간 빈칸\n\n|장소|빈칸|확인 결과·다음 조치|\n|---|---|---|\n`;
for(const p of places.filter(x=>x.missing_address_hours_note))md+=`|${esc(p.name_ko)}|${p.remaining_null_fields.filter(k=>['address','opening_hours'].includes(k)).join(', ')}|${esc(p.missing_address_hours_note)}|\n`;
md+='\n## 보류 장소 전체\n\n쇼핑 구매비의 null은 비산정이며 가격 누락과 구분한다. 여러 조건이 겹치는 장소는 각 조건을 모두 해결해야 한다.\n\n|장소·원본 ID|다음 조치|확인할 출처|\n|---|---|---|\n';
for(const p of blocked)md+=`|${esc(p.name_ko)} (${p.place_id})|${esc(p.next_actions.join('; '))}|${p.evidence_urls.slice(0,3).map((u,i)=>`[근거 ${i+1}](${u})`).join(' · ')}|\n`;
md+='\n전체 사유 코드·가능 날짜·출처는 [검증 JSON](../data/week5/remaining_place_checks_20260930.json)에 있다. 완료되지 않은 150곳 일정 투입 항목은 이슈에서 체크하지 않는다.\n';
write('../docs/week5_remaining_places.md',md);
let q=`# 오사카 장소 검토 큐 — ${report.checked_at}\n\n현재 데이터에서 재생성했다. 빈칸은 미확인, 쇼핑 비용 null은 비산정이다. 모델 통과는 실제 방문 가능 보증이 아니다.\n\n|장소|주소|단독 모델|남은 빈칸|검토 차단 사유|\n|---|---|---|---|---|\n`;
for(const r of dataset.places){const p=byId.get(r.place.place_id);q+=`|${esc(r.place.name_ko)}|${esc(r.place.address)}|${p.passed_individual_model?'통과':'보류'}|${r.review.missing_fields.join(', ')}|${r.review.recommendation_blockers.join(', ')}|\n`;}
write('../data/week5/live_20260923/processed/place_review_queue.md',q);
console.log(JSON.stringify(report.summary));
