"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTrip } from "@/components/store";
import { Avatar, Body, Screen } from "@/components/ui";

const MAX_MEMBERS = 6;

export default function Home() {
  const router = useRouter();
  const { state, set, setMemberNames, reset } = useTrip();
  const [names, setNames] = useState<string[]>(state.members.map((m) => m.name));

  const setName = (i: number, v: string) =>
    setNames((ns) => ns.map((n, idx) => (idx === i ? v : n)));
  const addName = () => setNames((ns) => (ns.length < MAX_MEMBERS ? [...ns, ""] : ns));
  const removeName = (i: number) => setNames((ns) => ns.filter((_, idx) => idx !== i));

  const valid = names.length >= 2 && names.every((n) => n.trim().length > 0);

  const start = () => {
    setMemberNames(names);
    router.push("/pick");
  };

  return (
    <Screen className="bg-gradient-to-b from-brand-600 via-brand-500 to-brand-400 text-white">
      <Body className="pt-14">
        <div className="mb-5 inline-flex rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-semibold">
          캡스톤 프로토타입
        </div>
        <h1 className="text-[27px] font-bold leading-[1.3]">
          언제, 누구랑
          <br />
          가시나요?
        </h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-white/80">
          여기까지만 같이 정하고, 나머지는 각자 조용히 고르면 돼요.
        </p>

        {/* 기간 */}
        <div className="mt-6 rounded-2xl bg-white/12 p-4">
          <div className="text-[12px] text-white/70">며칠 가시나요</div>
          <div className="mt-2 flex items-center justify-between">
            <button onClick={() => set({ nights: Math.max(1, state.nights - 1) })}
              aria-label="하루 줄이기"
              className="h-10 w-10 rounded-full bg-white/15 text-[20px] font-bold leading-none">−</button>
            <div className="text-[22px] font-bold">
              {state.nights}박 {state.nights + 1}일
            </div>
            <button onClick={() => set({ nights: Math.min(6, state.nights + 1) })}
              aria-label="하루 늘리기"
              className="h-10 w-10 rounded-full bg-white/15 text-[20px] font-bold leading-none">+</button>
          </div>
          <div className="mt-2 text-[11.5px] text-white/70">여행지는 오사카로 고정된 프로토타입이에요.</div>
        </div>

        {/* 동행자 */}
        <div className="mt-3 rounded-2xl bg-white/12 p-4">
          <div className="flex items-end justify-between">
            <div className="text-[12px] text-white/70">누구랑 가시나요</div>
            <div className="text-[11.5px] text-white/70">{names.length}명</div>
          </div>

          <div className="mt-3 space-y-2">
            {names.map((n, i) => (
              <div key={i} className="flex items-center gap-2">
                <Avatar name={n || "?"} color="rgba(255,255,255,0.25)" size={30} />
                <input value={n} onChange={(e) => setName(i, e.target.value)}
                  placeholder={i === 0 ? "내 이름" : `친구 ${i} 이름`}
                  className="w-full rounded-xl bg-white/15 px-3 py-2.5 text-[13.5px] text-white outline-none placeholder:text-white/50" />
                {i === 0 ? (
                  <span className="shrink-0 text-[11.5px] text-white/70">나</span>
                ) : (
                  <button onClick={() => removeName(i)} aria-label={`${n || "친구"} 빼기`}
                    className="shrink-0 px-1 text-[18px] leading-none text-white/60">×</button>
                )}
              </div>
            ))}
          </div>

          {names.length < MAX_MEMBERS && (
            <button onClick={addName}
              className="mt-2.5 w-full rounded-xl border border-dashed border-white/40 py-2.5 text-[12.5px] font-semibold text-white/85">
              + 같이 갈 사람 추가
            </button>
          )}
          <p className="mt-2.5 text-[11px] leading-relaxed text-white/60">
            데모라서 나를 뺀 나머지는 미리 준비된 취향으로 자동 입력돼요.
          </p>
        </div>
      </Body>

      <div className="sticky bottom-0 z-20 px-5 pb-6 pt-3">
        <div className="space-y-2">
          <button onClick={start} disabled={!valid}
            className="btn w-full bg-white text-brand-700 hover:bg-white/90 disabled:opacity-50">
            {valid ? "시작하기" : "이름을 모두 채워주세요"}
          </button>
          <button onClick={() => { reset(); setNames(["나", "윤진", "조은", "민서", "도윤"]); }}
            className="btn w-full bg-white/10 text-white hover:bg-white/20">
            처음부터 다시하기
          </button>
        </div>
      </div>
    </Screen>
  );
}
