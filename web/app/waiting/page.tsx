"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTrip } from "@/components/store";
import { Avatar, Body, Card, Notice, Screen, SectionTitle, TopBar } from "@/components/ui";

/** 1차 입력이 모두 끝나기를 기다린다. 끝나면 모두의 후보가 모인 화면으로 간다 */
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

  /** 서버가 있으면 3초마다 참여 현황을 묻는다. 없으면 기존 데모 애니메이션 */
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

  /** 제출 뒤 대기인지, 1차 뒤 대기인지에 따라 안내와 다음 화면이 다르다 */
  const afterSubmit = !!state.room && state.submitted;

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

  return (
    <Screen>
      <TopBar title="다른 사람을 기다리는 중"
        subtitle={afterSubmit ? "전원 입력이 끝나면 결과가 나와요" : undefined} />
      <Body className="justify-center">
        <Card>
          <SectionTitle hint={`${doneCount}/${total}명`}>참여 현황</SectionTitle>
          <div className="mt-4 space-y-3">
            {ordered.map((m, i) => {
              const mine = m === me;
              const known = mine || !online || allDone;
              const ok = mine || allDone || (!online && i < doneCount);
              return (
                <div key={m.id} className="flex items-center gap-3">
                  <Avatar name={m.name} color={ok ? m.color : "#d6dae4"} size={34} />
                  <span className={`flex-1 text-[13.5px] font-semibold ${ok ? "" : "text-ink-300"}`}>
                    {m.name}{m.id === state.mine.memberId && " (나)"}
                  </span>
                  {known && (
                    <span className={`chip ${ok ? "bg-emerald-50 text-emerald-700" : "bg-surface text-ink-300"}`}>
                      {ok ? "완료" : "찾는 중"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {online && !allDone && othersTotal > 0 && (
            <p className="mt-3 text-[11.5px] leading-relaxed text-ink-500">
              다른 {othersTotal}명 중 {othersDone}명이 입력을 마쳤어요. 누가 냈는지는 보여주지 않아요.
            </p>
          )}
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface">
            <div className="h-full rounded-full bg-brand-600 transition-all duration-500"
              style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }} />
          </div>
          {error && (
            <p className="mt-3 text-[11.5px] leading-relaxed text-coral-500">{error}</p>
          )}
          {allDone && (
            <>
              <p className="mt-3 text-[12.5px] font-semibold text-brand-600">
                {online ? "전원 입력이 끝났어요." : `${pool.length}곳이 모였어요. 이제 이 중에서 고를 차례예요.`}
              </p>
              {online && (
                <button onClick={() => router.push("/result")}
                  className="btn-primary mt-3 w-full">결과 보기</button>
              )}
            </>
          )}
        </Card>

        <Notice tone="info">
          누가 무엇을 찾아왔는지는 <b>끝까지 공개되지 않아요.</b> 몇 명이 겹쳤는지만 보여드려요.
        </Notice>
      </Body>
    </Screen>
  );
}
