/** Offline snapshot: eligibility is about the listed dates, not perpetual readiness. */
import fs from 'node:fs';
import {loadRuntimeInputs,availability,validateDay} from './validate_real_schedule.mjs';
const {dataset,profiles}=loadRuntimeInputs();
const dates=Array.from({length:27},(_,i)=>`2026-11-${String(i+4).padStart(2,'0')}`);
const rows=dataset.places.map(r=>{
 const checks=dates.map(date=>({date,...availability(r,date,profiles,{allowShopping:true})}));
 const eligible=checks.filter(c=>c.eligible_for_model);
 const day=eligible.length?validateDay({date:eligible[0].date,place_ids:[r.place.place_id],budget_krw:1000000,step_limit:100000,active_min:1440,krw_per_jpy:'9'},dataset,profiles,{allowShopping:true}):null;
 return {place_id:r.place.place_id,name_ko:r.place.name_ko,eligible_dates:eligible.map(c=>c.date),
  single_place_schedule_passed:day?.passed_model_checks??false,
  date_failures:checks.filter(c=>!c.eligible_for_model).map(c=>({date:c.date,reasons:c.reasons})),
  schedule_violations:day?.violations??[],
  status:eligible.length&&day?.passed_model_checks?'dated_model_eligible':'held',
  cost_basis:r.field_sources.cost?.note??null,
  date_profile:profiles.places[r.place.place_id]??null};
});
const out={checked_at:'2026-11-04',date_range:[dates[0],dates.at(-1)],
 limits:['Eligibility + one-place schedule with generous synthetic limits; not live opening, full-group travel or booking confirmation.','9 KRW/JPY is a test conversion, not a current exchange quote.'],
 summary:{searchable:rows.length,dated_eligible:rows.filter(r=>r.status==='dated_model_eligible').length,held:rows.filter(r=>r.status==='held').length},rows};
fs.writeFileSync(new URL('../data/final/schedule_audit_20261104.json',import.meta.url),JSON.stringify(out,null,2)+'\n');
console.log(out.summary);
if(rows.some(r=>r.eligible_dates.length&&!r.single_place_schedule_passed)){
 console.error(rows.filter(r=>r.eligible_dates.length&&!r.single_place_schedule_passed));process.exitCode=1;
}
