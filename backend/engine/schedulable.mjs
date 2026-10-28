/** 실제 장소 중 방 날짜 가운데 하루라도 일정 검사(운영·검토 상태)를 통과하는 곳. P3·P4가 고를 수 있는 목록이다. */
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {loadInputs, availability} from '../../scripts/validate_real_schedule.mjs';

export function schedulableIds(dates, dataset, profiles) {
  return dataset.places
    .filter(r => dates.some(date => availability(r, date, profiles, {allowShopping: true}).eligible_for_model))
    .map(r => r.place.place_id);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const {dates} = JSON.parse(fs.readFileSync(0, 'utf8'));
    const {dataset, profiles} = loadInputs();
    process.stdout.write(JSON.stringify({placeIds: schedulableIds(dates, dataset, profiles)}) + '\n');
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
