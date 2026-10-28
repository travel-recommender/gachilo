import {test} from 'node:test';
import assert from 'node:assert/strict';
import {availability,loadRuntimeInputs} from './validate_real_schedule.mjs';
import {schedulableIds} from '../backend/engine/schedulable.mjs';
const {dataset,profiles}=loadRuntimeInputs();
test('split windows cannot silently override weekday/extended rules',()=>{
 const record=dataset.places.find(r=>r.place.place_id==='branch_fukutaro_umeda');
 for(const rule of ['weekday_window','extended_window']) {
  const copy=structuredClone(profiles);copy.places[record.place.place_id][rule]=[600,1200,1150];
  assert.ok(availability(record,'2026-11-02',copy,{allowShopping:true}).reasons.includes('split_window_rule_conflict'));
  copy.places[record.place.place_id].exceptions={'2026-11-02':{windows:[[600,720,690]]}};
  assert.ok(!availability(record,'2026-11-02',copy,{allowShopping:true}).reasons.includes('split_window_rule_conflict'));
 }
});
test('schedulable uses the shared 205 runtime and respects held branches',()=>{
 const ids=schedulableIds(['2026-11-02','2026-11-03'],dataset,profiles);
 assert.ok(ids.includes('branch_ichiran_abeno'));
 assert.ok(ids.includes('branch_ichiran_shinsaibashi'));
 assert.ok(!ids.includes('branch_wanaka_dotonbori'));
});
