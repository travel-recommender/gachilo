// 여행 날짜 회귀검사 — 시간대마다 같은 달력 날짜가 나와야 한다.
// 실행: cd web && node --test _test/dates.test.ts  (Node 24 이상, 타입 제거 내장)
// 수정 전 구현(로컬 자정 → toISOString)은 Asia/Seoul·Asia/Tokyo에서 여기서 실패한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultStartDate, nightsBetween, toDateRange } from "../src/lib/dates.ts";

const ZONES = ["Asia/Seoul", "Asia/Tokyo", "UTC", "America/Los_Angeles"];

for (const tz of ZONES) {
  test(`toDateRange는 ${tz}에서도 출발일을 바꾸지 않는다`, () => {
    process.env.TZ = tz;
    assert.deepEqual(toDateRange("2026-10-01", 3), { startDate: "2026-10-01", endDate: "2026-10-04" });
    assert.deepEqual(toDateRange("2026-10-01", 0), { startDate: "2026-10-01", endDate: "2026-10-01" });
    // 월말·연말 넘김
    assert.deepEqual(toDateRange("2026-12-30", 3), { startDate: "2026-12-30", endDate: "2027-01-02" });
    assert.equal(nightsBetween("2026-10-01", "2026-10-04"), 3);
  });

  test(`defaultStartDate는 ${tz} 로컬 달력으로 7일 뒤다`, () => {
    process.env.TZ = tz;
    // 로컬 이른 아침 — UTC로 직렬화하면 전날이 되는 시각
    const now = new Date(2026, 9, 1, 1, 30);
    assert.equal(defaultStartDate(now), "2026-10-08");
  });
}
