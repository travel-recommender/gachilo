/** Public aggregate counts only; one place may have several simultaneous blockers. */
const labels = {
  address_missing: '주소 미확인',
  opening_hours_missing: '영업시간 미확인',
  structured_date_profile_missing: '날짜별 운영 규칙 미확인',
  cost_unknown_or_not_applicable: '입장료·메뉴 가격 미확인',
  closed_on_visit_date: '모든 여행일 휴무',
  outside_reviewed_date_range: '모든 여행일이 검증된 날짜 범위 밖',
  outside_place_reviewed_date_range: '모든 여행일이 해당 장소의 검증 범위 밖',
  budget_exceeded: '입장권·메뉴 예산 초과',
  step_limit_exceeded: '예상 걸음 수 초과',
  active_minutes_exceeded: '활동 시간 초과',
  requested_place_not_scheduled: '이동·체류시간을 포함해 일정에 배치할 시간 부족',
  opening_or_last_entry_violation: '방문 순서와 영업·입장 마감시간이 맞지 않음',
  daily_place_limit: '하루 최대 방문 장소 수 초과',
  date_conditions_vary: '날짜별 미배치 사유가 다름 (휴무·검증 범위·일정 한도 등)',
};

export function planningReasonLines(counts) {
  const lines = [];
  let otherReasonCount = 0;
  for (const [reason, count] of Object.entries(counts)) {
    if (Object.hasOwn(labels, reason)) lines.push(`${labels[reason]}: ${count}곳`);
    else otherReasonCount += count;
  }
  // Aggregated unknown codes cannot tell us the number of distinct places.
  if (otherReasonCount) lines.push(`지점·운영 조건 추가 확인 필요: 미확인 사유 ${otherReasonCount}건 (장소 중복 포함)`);
  return lines;
}
