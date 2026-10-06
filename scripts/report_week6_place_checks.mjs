/** Date-specific meeting handoff. Offline model results, never production promotion. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {loadInputs} from './validate_real_schedule.mjs';
import {auditIndividualPlaces} from './audit_real_catalog.mjs';

const {dataset, profiles} = loadInputs();
const dates = Array.from({length:7}, (_,i) => `2026-10-${String(i+7).padStart(2,'0')}`);
const week = auditIndividualPlaces(dataset, profiles, dates);
const day = new Map(auditIndividualPlaces(dataset, profiles, [dates[0]]).map(p=>[p.place_id,p]));
const byId = new Map(dataset.places.map(p=>[p.place.place_id,p]));
const rows = week.map(result => {
  const {place:p,review:r} = byId.get(result.place_id);
  const first = day.get(result.place_id);
  const reasons = [...new Set(first.excluded_date_groups.flatMap(g=>g.reasons))];
  return {place_id:p.place_id, name_ko:p.name_ko, category:p.category,
    passed_individual_model_on_20261007:first.passed_individual_model,
    passed_at_least_one_day:result.passed_individual_model,
    eligible_dates:result.eligible_dates, reasons_on_20261007:reasons,
    failed_schedule_checks:first.failures, address:p.address, opening_hours:p.opening_hours,
    cost_jpy:p.cost, cost_basis:byId.get(result.place_id).field_sources.cost?.note ?? null,
    covered:p.covered, remaining_null_fields:r.missing_fields,
    recommendation_blockers:r.recommendation_blockers, schedule_ready:r.schedule_ready};
});
const reasons = {};
for(const r of rows.filter(r=>!r.passed_at_least_one_day)) {
  const result=week.find(p=>p.place_id===r.place_id);
  for(const reason of new Set(result.excluded_date_groups.flatMap(g=>g.reasons))) reasons[reason]=(reasons[reason]??0)+1;
}
const report={checked_at:profiles.checked_at, dates,
  source_sha256:createHash('sha256').update(JSON.stringify(dataset)).digest('hex'),
  profiles_sha256:createHash('sha256').update(JSON.stringify(profiles)).digest('hex'),
  summary:{total:rows.length, pass_on_20261007:rows.filter(r=>r.passed_individual_model_on_20261007).length,
    pass_at_least_one_day:rows.filter(r=>r.passed_at_least_one_day).length,
    held_all_dates:rows.filter(r=>!r.passed_at_least_one_day).length,
    promotion_complete:rows.filter(r=>r.schedule_ready).length},
  overlapping_hold_reasons:reasons,
  limitations:['각 장소를 따로 계산한 합성 검사. 모든 통과 장소가 하나의 여행 일정에 함께 들어간다는 뜻은 아님.',
    '환율 9.5는 테스트용 가정값. 실제 하나은행 고시 환율이 아님.',
    '입장료·대표 메뉴만 계산. 쇼핑 구매비 null은 비산정이며 모르는 가격을 0으로 채우지 않음.',
    '운영 중임·가격 변동·외부 동선·실제 입구·임시휴업의 현장 확인이나 실서비스 승격은 별도.'],places:rows};
fs.writeFileSync(new URL('../data/week6/place_checks_20261006.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
const columns=['place_id','name_ko','category','passed_individual_model_on_20261007','passed_at_least_one_day',
  'eligible_dates','reasons_on_20261007','address','opening_hours','cost_jpy','cost_basis','covered',
  'remaining_null_fields','recommendation_blockers','schedule_ready'];
const cell = v => '"'+String(Array.isArray(v)?v.join(' | '):v??'').replaceAll('"','""')+'"';
fs.writeFileSync(new URL('../data/week6/osaka_places_meeting_review_20261007.csv',import.meta.url),
  '\uFEFF'+[columns,...rows.map(r=>columns.map(k=>r[k]))].map(row=>row.map(cell).join(',')).join('\n')+'\n');
console.log(JSON.stringify(report.summary));
