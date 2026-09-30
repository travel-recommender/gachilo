/**
 * 여행 날짜 계산. 서버는 날짜를 `YYYY-MM-DD` 달력 날짜로만 주고받는다.
 * 시간대 없는 날짜라서 **UTC로만 더하고 뺀다** — 로컬 자정을 toISOString()으로
 * 바꾸면 KST·JST에서 하루 앞당겨진다. (검사: web/_test/dates.test.ts)
 */

/** `nights`(박)를 서버가 받는 startDate/endDate로 바꾼다. 양 끝을 포함한다 */
export function toDateRange(startDate: string, nights: number) {
  const [y, m, d] = startDate.split("-").map(Number);
  const iso = (offset: number) => new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
  return { startDate: iso(0), endDate: iso(nights) };
}

/** 서버의 startDate/endDate에서 박 수를 구한다 (toDateRange의 역) */
export function nightsBetween(startDate: string, endDate: string) {
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000);
}

/** 오늘 기준 기본 출발일 (일주일 뒤). 사용자의 **로컬 달력** 날짜로 만든다 */
export function defaultStartDate(now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() + 7);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
