"use client";
import { usePathname } from "next/navigation";

const STEPS = [
  { m: ["/"], label: "기간·동행자" },
  { m: ["/pick"], label: "장소 찾기" },
  { m: ["/waiting"], label: "모으는 중" },
  { m: ["/shortlist"], label: "모두의 후보" },
  { m: ["/condition"], label: "조건 입력" },
  { m: ["/result"], label: "합의 결과" },
  { m: ["/plan"], label: "일정·동선" },
  { m: ["/compare"], label: "전략 비교" },
];

export default function PhoneFrame({ children }: { children: React.ReactNode }) {
  const path = usePathname().replace(/\/$/, "") || "/";
  const idx = STEPS.findIndex((s) => s.m.includes(path));

  return (
    <div className="flex min-h-screen w-full justify-center gap-10 px-4 py-6 lg:py-12">
      <aside className="hidden w-64 shrink-0 lg:block">
        <div className="sticky top-12">
          <div className="mb-1 text-[22px] font-bold tracking-tight">같이가</div>
          <p className="mb-6 text-[13px] leading-relaxed text-ink-500">
            각자 조용히 입력하면
            <br />
            아무도 무리하지 않는 일정이 나와요.
          </p>
          <div className="label mb-3">화면 흐름</div>
          <ol className="space-y-1.5">
            {STEPS.map((s, i) => (
              <li key={s.label}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] transition ${
                  i === idx ? "bg-white font-semibold text-brand-700 shadow-card" : "text-ink-500"}`}>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                  i === idx ? "bg-brand-600 text-white" : "bg-white text-ink-300"}`}>{i + 1}</span>
                {s.label}
              </li>
            ))}
          </ol>
          <p className="mt-6 rounded-xl bg-white/60 p-3 text-[11px] leading-relaxed text-ink-500">
            캡스톤 프로토타입 · 오사카
            <br />
            장소 36곳 · 좌표는 대략값입니다.
          </p>
        </div>
      </aside>

      <main className="w-full max-w-[420px]">
        <div className="relative min-h-[780px] overflow-hidden rounded-[36px] border-[10px] border-ink-900 bg-white shadow-2xl">
          <div className="pointer-events-none absolute left-1/2 top-0 z-30 h-6 w-32 -translate-x-1/2 rounded-b-2xl bg-ink-900" />
          <div className="h-full min-h-[760px] overflow-y-auto no-scrollbar">{children}</div>
        </div>
      </main>
    </div>
  );
}
