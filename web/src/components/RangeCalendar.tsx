"use client";
import { useState } from "react";

/** "YYYY-MM-DD"를 UTC 달력으로만 다룬다 (시간대 때문에 하루 밀리지 않게) */
const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

/** "9월 20일 (일)" */
export function fmtDay(s: string) {
  if (!s) return "날짜 선택";
  const d = parse(s);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEK[d.getUTCDay()]})`;
}

/** "9월 20일" */
export function fmtShort(s: string) {
  const d = parse(s);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
}

/**
 * 아고다처럼 펼쳐지는 달력. 첫 탭은 체크인, 두 번째 탭은 체크아웃으로 저장된다 (피그마 댓글 #13).
 * 체크아웃을 체크인보다 앞으로 누르면 그 날을 새 체크인으로 본다.
 */
export function RangeCalendar({ start, end, min, maxNights, onChange }: {
  start: string;
  end: string;
  /** 고를 수 있는 첫 날 */
  min: string;
  maxNights: number;
  onChange: (start: string, end: string) => void;
}) {
  const [month, setMonth] = useState(() => {
    const d = parse(start || min);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  });
  // 체크인만 고른 상태인가
  const [picking, setPicking] = useState(false);

  const first = month.getUTCDay();
  const daysIn = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array(first).fill(null),
    ...Array.from({ length: daysIn }, (_, i) =>
      iso(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), i + 1)))),
  ];

  const tap = (day: string) => {
    if (!picking || day <= start) {
      onChange(day, "");
      setPicking(true);
      return;
    }
    const nights = Math.round((parse(day).getTime() - parse(start).getTime()) / 86400000);
    if (nights > maxNights) return;
    onChange(start, day);
    setPicking(false);
  };

  const shift = (n: number) =>
    setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + n, 1)));

  return (
    <div className="animate-slideup mt-3 rounded-[10px] border border-line-soft p-3">
      <div className="mb-2 flex items-center justify-between">
        <button onClick={() => shift(-1)} aria-label="이전 달" className="h-8 w-8 rounded-full text-[18px] text-mute">‹</button>
        <span className="text-[15px] font-extrabold">
          {month.getUTCFullYear()}년 {month.getUTCMonth() + 1}월
        </span>
        <button onClick={() => shift(1)} aria-label="다음 달" className="h-8 w-8 rounded-full text-[18px] text-mute">›</button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-mute-soft">
        {WEEK.map((w) => <span key={w} className="py-1">{w}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {cells.map((day, i) => {
          if (!day) return <span key={`b${i}`} />;
          const disabled = day < min;
          const edge = day === start || day === end;
          const inside = start && end && day > start && day < end;
          return (
            <button key={day} disabled={disabled} onClick={() => tap(day)}
              aria-label={fmtDay(day)} aria-pressed={edge}
              className={`h-9 text-[14px] font-semibold disabled:text-line ${
                edge ? "rounded-full bg-wine text-white" : inside ? "bg-wine-50 text-wine" : "text-black"}`}>
              {parse(day).getUTCDate()}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[11.5px] font-medium text-mute">
        {picking ? "체크아웃 날짜를 눌러 주세요" : "체크인 날짜부터 눌러 주세요"}
      </p>
    </div>
  );
}
