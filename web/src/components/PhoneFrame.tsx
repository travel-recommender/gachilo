"use client";
import { usePathname } from "next/navigation";

const STEPS = [
  { m: ["/"], label: "시작" },
  { m: ["/create", "/invite"], label: "방 만들기" },
  { m: ["/join"], label: "인원 선택" },
  { m: ["/pick"], label: "장소 찾기" },
  { m: ["/waiting"], label: "모으는 중" },
  { m: ["/shortlist"], label: "모두가 찾아온 곳" },
  { m: ["/budget"], label: "예산 · 숙소 · 공항" },
  { m: ["/condition"], label: "체력 · trade off" },
  { m: ["/result"], label: "후보 비교" },
  { m: ["/plan"], label: "일정과 동선" },
];

/**
 * 넓은 화면(발표·수업)에서는 휴대폰 틀과 화면 흐름을 함께 보여준다.
 * 휴대폰에서는 틀 없이 화면을 꽉 채운다.
 */
export default function PhoneFrame({ children }: { children: React.ReactNode }) {
  const path = usePathname().replace(/\/$/, "") || "/";
  const idx = STEPS.findIndex((s) => s.m.includes(path));

  return (
    <div className="flex min-h-screen w-full justify-center gap-10 sm:px-4 sm:py-6 lg:py-10">
      <aside className="hidden w-64 shrink-0 lg:block">
        <div className="sticky top-10">
          <div className="mb-1 text-[22px] font-extrabold tracking-tight text-wine">Gachiro</div>
          <p className="mb-6 text-[13px] leading-relaxed text-mute">
            각자 조용히 입력하면
            <br />
            아무도 무리하지 않는 일정이 나와요.
          </p>
          <div className="label mb-3">화면 흐름</div>
          <ol className="space-y-1.5">
            {STEPS.map((s, i) => (
              <li key={s.label}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] transition ${
                  i === idx ? "bg-white font-semibold text-wine shadow-card" : "text-mute"}`}>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                  i === idx ? "bg-wine text-white" : "bg-white text-mute-soft"}`}>{i}</span>
                {s.label}
              </li>
            ))}
          </ol>
        </div>
      </aside>

      <main className="w-full sm:max-w-[422px]">
        <div className="relative bg-white sm:min-h-[852px] sm:overflow-hidden sm:rounded-[36px] sm:border-[10px] sm:border-ink-900 sm:shadow-2xl">
          <div className="no-scrollbar sm:h-[852px] sm:overflow-y-auto">{children}</div>
        </div>
      </main>
    </div>
  );
}
