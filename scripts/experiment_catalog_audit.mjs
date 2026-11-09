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
console.log(JSON.stringify({date_range: [start, end],
  catalog_total: dataset.places.length,
  excluded: dataset.places.length - places.length,
  selectable: places.length,
  reviewed_date_range: [profiles.valid_from, profiles.valid_through],
  outside_reviewed_dates: dates.filter(date => date < profiles.valid_from || date > profiles.valid_through),
  per_day: dates.map(date => ({date, eligible: rows.filter(row => row.dates.find(d => d.date === date).eligible).length})),
  limits: ['저장한 운영 조건에 따른 날짜 적격 검사. 실시간 영업·예약·최종 일정 가능 여부를 보장하지 않습니다.',
    'catalog_total은 제외 장소를 포함한 API 목록 수, selectable은 제외 표시가 없는 선택 가능 수입니다. 날짜별 일정 적격 수는 per_day입니다.',
    '검증 범위 밖 날짜를 쓰려면 공식 운영 조건과 날짜 프로필을 재검증·갱신해야 합니다. 데이터 상태는 변경하지 않습니다.'],
  rows}, null, 2));
