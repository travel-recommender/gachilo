/** Live-check smoke test for a few real places. No key or Google details are printed or saved.
 *
 * Run in the terminal holding GOOGLE_PLACES_API_KEY:
 *   node scripts/check_live_places.mjs                 # 준비만, 호출 없음
 *   node scripts/check_live_places.mjs --run           # 기본 3곳, 최대 6회 유료 요청
 *   node scripts/check_live_places.mjs --run osaka_009 osaka_015 --date 2026-11-06
 *   node scripts/check_live_places.mjs --why osaka_009  # 검색 후보와 거리만 보기, 장소당 2회 요청
 * Uses a throwaway cache so backend/.local is untouched. Node 24+.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {googleLiveCheck, searchCandidates, searchQueries} from '../backend/engine/live_check.mjs';
import {loadRuntimeInputs, availability} from './validate_real_schedule.mjs';

const args = process.argv.slice(2);
const why = args.includes('--why');
const run = args.includes('--run') || why;
const dateAt = args.indexOf('--date');
const date = dateAt >= 0 ? args[dateAt + 1] : new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Tokyo'}).format(new Date());
const ids = args.filter((a, i) => !a.startsWith('--') && !(dateAt >= 0 && i === dateAt + 1));
const {dataset, profiles} = loadRuntimeInputs(); // 서버와 같은 카탈로그
const picked = (ids.length ? ids : ['osaka_009', 'osaka_015', 'osaka_017']).slice(0, 5);
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const requests = [];
for (const id of picked) {
  const record = dataset.places.find(r => r.place.place_id === id);
  if (!record) { console.log(`${id}: 데이터에 없음`); continue; }
  const check = availability(record, date, profiles, {allowShopping: true});
  const name = record.place.name_ko || record.place.name;
  if (!check.eligible_for_model) { console.log(`${id} ${name}: 엑셀 단계에서 제외 (${check.reasons.join(', ')}) — 조회 안 함`); continue; }
  const windows = check.windows ?? [check.window];
  console.log(`${id} ${name}: 엑셀 운영 시간 ${windows.map(w => `${hhmm(w[0])}~${hhmm(w[1])}`).join(', ')}`);
  requests.push({record, date, windows});
}
if (!run) {
  console.log(`\n준비 완료 (${date}, ${requests.length}곳). --run을 붙이면 장소당 최대 2회 Google 요청을 보냅니다.`);
  process.exit(0);
}
if (!process.env.GOOGLE_PLACES_API_KEY?.trim()) {
  console.log('GOOGLE_PLACES_API_KEY가 없습니다. 키를 설정한 같은 터미널에서 실행하세요.');
  process.exit(1);
}
if (why) {
  // 같은 장소로 인정하는 거리는 150m. 검색 후보 이름과 거리를 그대로 보여 준다
  for (const {record} of requests) {
    for (const query of searchQueries(record.place)) {
      const found = await searchCandidates(fetch, process.env.GOOGLE_PLACES_API_KEY.trim(), record.place, query);
      console.log(`\n${record.place.place_id} 검색어: ${query}`);
      if (!found) { console.log('  요청 실패 (키 제한·API 사용 설정·네트워크 확인)'); continue; }
      if (!found.length) console.log('  검색 결과 없음');
      found.forEach((p, i) => console.log(`  후보 ${i + 1}: ${p.name ?? '이름 없음'} — ${Number.isFinite(p.d) ? Math.round(p.d) + 'm' : '좌표 없음'}`
        + (p.address ? ' (주소 결과, 제외)' : '') + (p.exact ? ' (이름 일치)' : '')));
    }
  }
  process.exit(0);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-check-'));
const result = await googleLiveCheck({cacheUrl: pathToFileURL(path.join(dir, 'cache.json'))})(requests);
fs.rmSync(dir, {recursive: true, force: true});
console.log(`\nGoogle 조회 (${result.checked_on} 일본 기준, 방문일 ${date})`);
for (const {record} of requests) {
  const v = result.verdicts.get(`${record.place.place_id}|${date}`);
  console.log(`${record.place.place_id} ${record.place.name_ko || record.place.name}: ${v.length ? '넣지 않음 — ' + v.join(', ') : '통과'}`);
}
