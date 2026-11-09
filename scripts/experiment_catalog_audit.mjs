/** Read-only, offline eligibility for a specified Japan-local travel date range. */
import {loadRuntimeInputs, availability} from './validate_real_schedule.mjs';
const [start, end] = process.argv.slice(2);
const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
if (!valid(start) || !valid(end)) throw Error('start/end must be real YYYY-MM-DD dates');
const count = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
if (count < 1 || count > 30) throw Error('date range must contain 1–30 days');
const {dataset, profiles} = loadRuntimeInputs();
const places = dataset.places.filter(r => r.review.final_csv?.record_status !== '제외');
const dates = Array.from({length: count}, (_, i) => new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10));
const rows = places.map(row => ({place_id: row.place.place_id, name: row.place.name_ko,
  dates: dates.map(date => {
    const check = availability(row, date, profiles, {allowShopping: true});
    return {date, eligible: check.eligible_for_model, reasons: check.reasons};
  })}));
console.log(JSON.stringify({date_range: [start, end], searchable: places.length,
  per_day: dates.map(date => ({date, eligible: rows.filter(row => row.dates.find(d => d.date === date).eligible).length})),
  limits: ['저장한 운영 조건에 따른 날짜 적격 검사. 실시간 영업·예약·최종 일정 가능 여부를 보장하지 않습니다.',
    '검색 가능한 장소 수와 자동 일정에 넣을 수 있는 수는 다릅니다. 데이터 상태는 변경하지 않습니다.'],
  rows}, null, 2));
