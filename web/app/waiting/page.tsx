"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTrip } from "@/components/store";
import { NavButtons, Page, PlanHeader } from "@/components/gachiro";
import { useSharedResults } from "@/components/useSharedResults";
import { hasCandidates, statusLine } from "@/lib/shared-flow";

/**
 * 다른 사람을 기다린다. 디자인에 없는 화면이다.
 * P2의 버건디 줄·체크는 "내가 누군지 고르는" 표시라서 여기서는 쓰지 않고, 진행 막대와 글자로만 보여준다.
 * - `?step=list` (P3 뒤): 모두의 목록이 모이면 P4로. 서버 방이면 서버에 모인 목록 수를 3초마다 묻는다 (누가 냈는지는 모른다)
 * - 그 밖 (P6 제출 뒤): 서버 공용 결과를 3초마다 묻는다. 전원이 내면 방장 화면이 후보 3개를 계산하고,
 *   후보가 나오면 P7로 간다 (docs/week6_shared_results_api.md)
 */
function WaitingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { state, pool, fetchPool } = useTrip();
  const members = state.members;
  // 어느 단계에서 왔는지는 주소로 받는다. "이미 제출했는가"로 고르면 제출 뒤 P3로 돌아왔을 때 멈춘다
  const afterList = params.get("step") === "list";
  const online = !afterList && !!state.room;
  /** 1차 목록 단계를 서버 방에서 기다린다 */
  const listOnline = afterList && !!state.room;
  const [doneCount, setDone] = useState(1);
  const shared = useSharedResults(online);
  const snap = shared.snap;
  const [listed, setListed] = useState<{ count: number; total: number } | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    if (!listOnline) return;
    let live = true;
    const tick = () => fetchPool()
      .then((p) => { if (live && p) { setListed({ count: p.listedCount, total: p.memberCount }); setListError(null); } })
      .catch((e) => { if (live) setListError(e instanceof Error ? e.message : "모인 목록을 확인하지 못했어요."); });
    tick();
    const t = setInterval(tick, 3000);
    return () => { live = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listOnline]);

  // 1차 뒤(또는 서버 없는 데모)에는 차례로 채워지는 안내를 보여주고 넘어간다
  useEffect(() => {
    if (online || listOnline) return;
    if (doneCount >= members.length) {
      const t = setTimeout(() => router.push(afterList ? "/shortlist" : "/result"), 900);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setDone((c) => c + 1), 700);
    return () => clearTimeout(t);
  }, [online, listOnline, afterList, doneCount, members.length, router]);

  const submitted = online ? snap?.submittedCount ?? 0 : listOnline ? listed?.count ?? 1 : doneCount;
  const total = online ? snap?.memberCount ?? members.length : listOnline ? listed?.total ?? members.length : members.length;
  const allDone = submitted >= total;
  const ready = hasCandidates(snap);

  /**
   * 이 화면에 왔다면 나는 이미 입력을 마쳤다. 나를 맨 위에 두고 완료로 표시한다.
   * 서버는 몇 명이 냈는지만 알려주므로(누가 냈는지는 모른다) 온라인에서는 다른 사람을 단정하지 않는다.
   */
  const me = members.find((m) => m.id === state.mine.memberId);
  const ordered = me ? [me, ...members.filter((m) => m !== me)] : members;

  const next = () => router.push(afterList ? "/shortlist" : "/result");

  return (
    <Page nav={<NavButtons prev={afterList ? "/pick" : "/condition"} next={next} nextDisabled={online ? !ready : !allDone}
      nextLabel={afterList ? "다음" : "결과 보기"} />}>
      <PlanHeader title="기다리는 중" />
      <div className="px-5 pt-[50px]">
        <div className="rounded-[20px] border border-line-soft px-[18px] pb-5 pt-4">
          <div className="text-[17px] font-medium">{afterList ? "모두의 My list" : "모두의 조건 입력"}</div>
          <div className="mt-3 text-[29.704px] font-extrabold leading-9">
            {Math.min(submitted, total)} <span className="text-[20px] text-line">/ {total}명</span>
          </div>
          <div className="mt-3 h-[10px] overflow-hidden rounded-[50px] bg-line">
            <div className="h-full rounded-[50px] bg-wine transition-all duration-500"
              style={{ width: `${total ? (Math.min(submitted, total) / total) * 100 : 0}%` }} />
          </div>

          <ul className="mt-5 divide-y divide-line-faint">
            {ordered.map((m, i) => {
              const mine = m === me;
              const ok = mine || allDone || (!online && !listOnline && i < doneCount);
              // 온라인에서 아직 다 안 냈으면 다른 사람은 누가 냈는지 모른다
              const unknown = (online || listOnline) && !mine && !allDone;
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

        {(online || listOnline) && !allDone && (
          <p className="mt-3 text-[12px] font-medium leading-relaxed text-mute">
            누가 냈는지는 보여주지 않고 몇 명이 냈는지만 보여줘요.
          </p>
        )}
        {listError && <p className="mt-3 text-[12px] leading-relaxed text-wine">{listError}</p>}
        {shared.error && <p className="mt-3 text-[12px] leading-relaxed text-wine">{shared.error}</p>}
        <p className="mt-3 text-[12px] font-medium leading-relaxed text-mute">
          {online ? statusLine(snap, shared.isOwner)
            : listOnline && !allDone ? "모두 목록을 내면 모인 곳을 한꺼번에 보여줘요."
            : allDone && afterList ? `${pool.length}곳이 모였어요. 이제 이 중에서 고를 차례예요.`
            : allDone ? "전원 입력이 끝났어요." : "누가 무엇을 골랐는지는 끝까지 공개되지 않아요."}
        </p>
        {shared.calcError && (
          <div className="mt-3 rounded-[10px] bg-wine-50 px-3 py-2 text-[12px] leading-relaxed text-wine">
            후보를 계산하지 못했어요. {shared.calcError}
            <button onClick={shared.retryCalculate} className="mt-1 block font-bold underline">다시 계산하기</button>
          </div>
        )}
        {listOnline && !allDone && (
          <button onClick={() => router.push("/shortlist")}
            className="mt-4 text-[12.5px] font-bold text-wine underline">
            지금까지 모인 곳으로 고르기
          </button>
        )}
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
