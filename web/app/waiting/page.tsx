"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTrip } from "@/components/store";
import { NavButtons, Page, PlanHeader, asset } from "@/components/gachiro";

/**
 * 다른 사람을 기다린다. 디자인에 없는 화면이라 P2(인원 선택) 모양을 따랐다.
 * - 1차(My list) 뒤: 모두의 목록이 모이면 P4로
 * - 조건 제출 뒤: 전원이 내면 P7로
 */
export default function Waiting() {
  const router = useRouter();
  const { state, pool, fetchStatus } = useTrip();
  const members = state.members;
  /**
   * 서버 폴링은 **조건까지 제출한 뒤에만** 의미가 있다.
   * 서버는 1·2차 선택과 조건을 한 번에 받으므로(backend/README.md),
   * 1차 직후의 대기는 서버에서 셀 수 없다 — 그 구간은 로컬 안내로 넘어간다.
   */
  const online = !!state.room && state.submitted;
  const [doneCount, setDone] = useState(1);
  const [memberCount, setMemberCount] = useState(members.length);
  const [error, setError] = useState<string | null>(null);

  /** 서버가 있으면 3초마다 참여 현황을 묻는다. 없으면 데모 애니메이션 */
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

  useEffect(() => {
    if (online) return;
    if (doneCount >= members.length) {
      const t = setTimeout(() => router.push("/shortlist"), 900);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setDone((c) => c + 1), 700);
    return () => clearTimeout(t);
  }, [online, doneCount, members.length, router]);

  const total = online ? memberCount : members.length;
  const allDone = doneCount >= total;

  /**
   * 이 화면에 왔다면 나는 이미 입력을 마쳤다. 명단 순서로 완료를 칠하면
   * 초대받은 사람이 내도 방장이 완료로 보이므로, 나를 맨 위에 두고 완료로 표시한다.
   * 서버는 몇 명이 냈는지만 알려주므로(누가 냈는지는 모른다) 온라인에서는 다른 사람을 단정하지 않는다.
   */
  const me = members.find((m) => m.id === state.mine.memberId);
  const ordered = me ? [me, ...members.filter((m) => m !== me)] : members;
  const othersDone = Math.max(0, doneCount - (me ? 1 : 0));
  const othersTotal = Math.max(0, total - (me ? 1 : 0));

  const next = () => router.push(online ? "/result" : "/shortlist");

  return (
    <Page nav={<NavButtons prev={online ? "/condition" : "/pick"} next={next} nextDisabled={!allDone}
      nextLabel={online ? "결과 보기" : "다음"} />}>
      <PlanHeader title="기다리는 중" />
      <div className="px-5 pt-[50px]">
        <div className="mb-[9px] flex items-baseline justify-between">
          <h2 className="text-[17px] font-extrabold">{online ? "조건 입력" : "My list"}</h2>
          <span className="text-[14px] font-extrabold text-wine">{doneCount}/{total}명</span>
        </div>
        <div className="space-y-[9px]">
          {ordered.map((m, i) => {
            const mine = m === me;
            const known = mine || !online || allDone;
            const ok = mine || allDone || (!online && i < doneCount);
            return (
              <div key={m.id}
                className={`flex h-[35px] items-center justify-between rounded-[6.795px] pl-5 pr-[11px] text-[14px] font-semibold ${
                  ok ? "bg-wine text-white" : "border border-line text-black"}`}>
                <span>{m.name}{mine && " (나)"}</span>
                {ok ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={asset("/ui/check.png")} alt="완료" width={31} height={31} className="-mr-[3px]" />
                ) : known ? (
                  <span className="text-[12px] font-medium text-mute-soft">찾는 중</span>
                ) : null}
              </div>
            );
          })}
        </div>
        {online && !allDone && othersTotal > 0 && (
          <p className="mt-3 text-[12px] font-medium leading-relaxed text-mute">
            다른 {othersTotal}명 중 {othersDone}명이 입력을 마쳤어요. 누가 냈는지는 보여주지 않아요.
          </p>
        )}
        {error && <p className="mt-3 text-[12px] leading-relaxed text-wine">{error}</p>}
        <p className="mt-6 text-[12px] font-medium leading-relaxed text-mute">
          {allDone && !online
            ? `${pool.length}곳이 모였어요. 이제 이 중에서 고를 차례예요.`
            : allDone ? "전원 입력이 끝났어요." : "누가 무엇을 골랐는지는 끝까지 공개되지 않아요."}
        </p>
      </div>
    </Page>
  );
}
