"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTrip } from "@/components/store";
import { NavButtons, Page, PlanHeader } from "@/components/gachiro";

/**
 * 다른 사람을 기다린다. 디자인에 없는 화면이다.
 * P2의 버건디 줄·체크는 "내가 누군지 고르는" 표시라서 여기서는 쓰지 않고, 진행 막대와 글자로만 보여준다.
 * - `?step=list` (P3 뒤): 모두의 목록이 모이면 P4로. 서버는 1차 목록을 따로 받지 않아 이 구간은 로컬 안내다
 * - 그 밖 (P6 제출 뒤): 서버 참여 현황을 3초마다 묻고, 전원이 내면 P7로
 */
function WaitingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { state, pool, fetchStatus } = useTrip();
  const members = state.members;
  // 어느 단계에서 왔는지는 주소로 받는다. "이미 제출했는가"로 고르면 제출 뒤 P3로 돌아왔을 때 멈춘다
  const afterList = params.get("step") === "list";
  const online = !afterList && !!state.room;
  const [doneCount, setDone] = useState(1);
  const [memberCount, setMemberCount] = useState(members.length);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!online) return;
    let live = true;
    const tick = async () => {
      try {
        const status = await fetchStatus();
        if (!live || !status) return;
        setDone(status.submittedCount);
        setMemberCount(status.memberCount);
        setError(null);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "현황을 불러오지 못했어요.");
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { live = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // 1차 뒤(또는 서버 없는 데모)에는 차례로 채워지는 안내를 보여주고 넘어간다
  useEffect(() => {
    if (online) return;
    if (doneCount >= members.length) {
      const t = setTimeout(() => router.push(afterList ? "/shortlist" : "/result"), 900);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setDone((c) => c + 1), 700);
    return () => clearTimeout(t);
  }, [online, afterList, doneCount, members.length, router]);

  const total = online ? memberCount : members.length;
  const allDone = doneCount >= total;

  /**
   * 이 화면에 왔다면 나는 이미 입력을 마쳤다. 나를 맨 위에 두고 완료로 표시한다.
   * 서버는 몇 명이 냈는지만 알려주므로(누가 냈는지는 모른다) 온라인에서는 다른 사람을 단정하지 않는다.
   */
  const me = members.find((m) => m.id === state.mine.memberId);
  const ordered = me ? [me, ...members.filter((m) => m !== me)] : members;

  const next = () => router.push(afterList ? "/shortlist" : "/result");

  return (
    <Page nav={<NavButtons prev={afterList ? "/pick" : "/condition"} next={next} nextDisabled={!allDone}
      nextLabel={afterList ? "다음" : "결과 보기"} />}>
      <PlanHeader title="기다리는 중" />
      <div className="px-5 pt-[50px]">
        <div className="rounded-[20px] border border-line-soft px-[18px] pb-5 pt-4">
          <div className="text-[17px] font-medium">{afterList ? "모두의 My list" : "모두의 조건 입력"}</div>
          <div className="mt-3 text-[29.704px] font-extrabold leading-9">
            {Math.min(doneCount, total)} <span className="text-[20px] text-line">/ {total}명</span>
          </div>
          <div className="mt-3 h-[10px] overflow-hidden rounded-[50px] bg-line">
            <div className="h-full rounded-[50px] bg-wine transition-all duration-500"
              style={{ width: `${total ? (Math.min(doneCount, total) / total) * 100 : 0}%` }} />
          </div>

          <ul className="mt-5 divide-y divide-line-faint">
            {ordered.map((m, i) => {
              const mine = m === me;
              const ok = mine || allDone || (!online && i < doneCount);
              // 온라인에서 아직 다 안 냈으면 다른 사람은 누가 냈는지 모른다
              const unknown = online && !mine && !allDone;
              return (
                <li key={m.id} className="flex h-[40px] items-center justify-between text-[14px] font-semibold">
                  <span>{m.name}{mine && <span className="ml-1 text-[12px] font-medium text-mute-soft">나</span>}</span>
                  <span className={`text-[12px] font-bold ${ok ? "text-wine" : "text-mute-soft"}`}>
                    {unknown ? "" : ok ? "완료" : "입력 중"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {online && !allDone && (
          <p className="mt-3 text-[12px] font-medium leading-relaxed text-mute">
            누가 냈는지는 보여주지 않고 몇 명이 냈는지만 보여줘요.
          </p>
        )}
        {error && <p className="mt-3 text-[12px] leading-relaxed text-wine">{error}</p>}
        <p className="mt-3 text-[12px] font-medium leading-relaxed text-mute">
          {allDone && afterList
            ? `${pool.length}곳이 모였어요. 이제 이 중에서 고를 차례예요.`
            : allDone ? "전원 입력이 끝났어요." : "누가 무엇을 골랐는지는 끝까지 공개되지 않아요."}
        </p>
        {online && !allDone && (
          // 혼자 시험하거나 누가 늦을 때 멈춰 있지 않도록. P7은 미리보기라고 표시한다
          <button onClick={() => router.push("/result")}
            className="mt-4 text-[12.5px] font-bold text-wine underline">
            지금까지 입력으로 미리 보기
          </button>
        )}
      </div>
    </Page>
  );
}

export default function Waiting() {
  return (
    <Suspense fallback={null}>
      <WaitingInner />
    </Suspense>
  );
}
