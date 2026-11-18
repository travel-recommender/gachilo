/** Offline provenance audit. Does not fetch sources or modify scheduling eligibility. */
import {loadRuntimeInputs} from './validate_real_schedule.mjs';
import {dateOnly, evidenceOf, evidenceForDate} from '../backend/engine/visit_evidence.mjs';
const [today,date=today]=process.argv.slice(2);
if (!dateOnly(today) || !dateOnly(date)) throw Error('Usage: node scripts/audit_visit_evidence.mjs YYYY-MM-DD [visit-date]');
const {dataset,profiles}=loadRuntimeInputs();
const places=dataset.places.map(r=>{
  const evidence=evidenceOf(r,profiles,{today}), check=evidenceForDate(evidence,date);
  return {placeId:r.place.place_id,name:r.place.name_ko,status:check.status,reasons:check.reasons,
    evidenceCount:evidence.entries.length, officialLinks:[...new Set(evidence.entries.flatMap(e=>e.sources.filter(s=>s.kind==='official').map(s=>s.url)))]};
});
const counts={};for(const p of places)for(const r of p.reasons)counts[r]=(counts[r]??0)+1;
console.log(JSON.stringify({schemaVersion:1,evaluatedOn:today,visitDate:date,totalPlaces:places.length,
  placesWithOfficialLinks:places.filter(p=>p.officialLinks.length).length,
  note:'Existing recorded provenance only; not a new verification of websites. No paid API calls.',reasonCounts:counts,places},null,2));
