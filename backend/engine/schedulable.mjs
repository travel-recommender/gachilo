/** P3/P4 availability uses the same dated checks as the schedule engine. */
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {loadRuntimeInputs, availability} from '../../scripts/validate_real_schedule.mjs';

function unavailableReason(checks, profile) {
  const every = code => checks.length > 0 && checks.every(c => c.reasons.includes(code));
  if (every('closed_on_visit_date')) return '여행 기간 내내 정기 휴무 또는 공지된 휴무일이에요.';
  if (every('outside_reviewed_date_range')) return '여행 날짜가 데이터 검토 기간 밖이에요. 해당 기간의 운영 정보 확인이 필요해요.';
  if (every('outside_place_reviewed_date_range')) return `이 장소는 ${profile.valid_from}~${profile.valid_through}의 운영 조건만 확인했어요. 여행 날짜의 정보를 추가로 확인해야 해요.`;
  const reasons = new Set(checks.flatMap(c => c.reasons));
  const messages = [];
  const add = (codes, text) => { if (codes.some(c => reasons.has(c))) messages.push(text); };
  add(['coordinates_invalid', 'entrance_coordinates_unconfirmed', 'public_viewpoint_unconfirmed'], '방문 지점·좌표 확인 필요');
  add(['cost_unknown_or_not_applicable', 'price_not_applicable_on_visit_date', 'dated_ticket_and_reservation_required'], '방문일 입장료·가격 조건 확인 필요');
  add(['entry_time_reservation_required'], '입장 시간 예약 조건 확인 필요');
  add(['visit_confirmation_required', 'closure_notice_year_unconfirmed', 'holiday_hours_unconfirmed'], '방문일 영업·예외 휴무 확인 필요');
  add(['structured_date_profile_missing', 'invalid_time_window', 'final_calendar_review_required', 'opening_hours_missing'], '날짜별 운영 자료 확인 필요');
  add(['stay_policy_unconfirmed', 'stay_min_invalid'], '체류시간 기준 확인 필요');
  add(['address_missing'], '주소 확인 필요');
  add(['category_unknown', 'category_contract_review_required', 'area_scheme_unconfirmed'], '장소 분류 확인 필요');
  return messages.length ? messages.slice(0, 2).join(' · ') + '. 확인 후 담을 수 있어요.'
    : '이 여행 기간에 사용할 장소 정보가 아직 검증되지 않았어요.';
}

export function schedulableDetails(dates, dataset, profiles) {
  if (!Array.isArray(dates) || dates.length === 0) throw Error('nonempty dates required');
  const placeIds = [], recommendationPlaceIds = [], unavailableReasons = {};
  for (const record of dataset.places) {
    const id = record.place.place_id;
    const checks = dates.map(date => availability(record, date, profiles, {allowShopping: true}));
    if (checks.some(c => c.eligible_for_model)) {
      placeIds.push(id);
      if (checks.some(c => c.eligible_for_model && !c.date_needs_confirmation)) recommendationPlaceIds.push(id);
    }
    else unavailableReasons[id] = unavailableReason(checks, profiles.places[id]);
  }
  return {placeIds, recommendationPlaceIds, unavailableReasons};
}
export const schedulableIds = (dates, dataset, profiles) => schedulableDetails(dates, dataset, profiles).placeIds;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const {dates} = JSON.parse(fs.readFileSync(0, 'utf8'));
    const {dataset, profiles} = loadRuntimeInputs();
    process.stdout.write(JSON.stringify(schedulableDetails(dates, dataset, profiles)) + '\n');
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
