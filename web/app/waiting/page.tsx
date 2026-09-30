"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTrip } from "@/components/store";
import { Avatar, Body, Card, Notice, Screen, SectionTitle, TopBar } from "@/components/ui";

/** 1차 입력이 모두 끝나기를 기다린다. 끝나면 모두의 후보가 모인 화면으로 간다 */
export default function Waiting() {
  const router = useRouter();
  const { state, pool } = useTrip();
  const members = state.members;
  const [doneCount, setDone] = useState(1);

  useEffect(() => {
    if (doneCount >= members.length) {
      const t = setTimeout(() => router.push("/shortlist"), 900);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setDone((c) => c + 1), 700);
    return () => clearTimeout(t);
  }, [doneCount, members.length, router]);

  const allDone = doneCount >= members.length;

  return (
    <Screen>
      <TopBar title="다른 사람을 기다리는 중" />
      <Body className="justify-center">
        <Card>
          <SectionTitle hint={`${doneCount}/${members.length}명`}>참여 현황</SectionTitle>
          <div className="mt-4 space-y-3">
            {members.map((m, i) => {
              const ok = i < doneCount;
              return (
                <div key={m.id} className="flex items-center gap-3">
                  <Avatar name={m.name} color={ok ? m.color : "#d6dae4"} size={34} />
                  <span className={`flex-1 text-[13.5px] font-semibold ${ok ? "" : "text-ink-300"}`}>
                    {m.name}{m.id === "me" && " (나)"}
                  </span>
                  <span className={`chip ${ok ? "bg-emerald-50 text-emerald-700" : "bg-surface text-ink-300"}`}>
                    {ok ? "완료" : "찾는 중"}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface">
            <div className="h-full rounded-full bg-brand-600 transition-all duration-500"
              style={{ width: `${(doneCount / members.length) * 100}%` }} />
          </div>
          {allDone && (
            <p className="mt-3 text-[12.5px] font-semibold text-brand-600">
              {pool.length}곳이 모였어요. 이제 이 중에서 고를 차례예요.
            </p>
          )}
        </Card>

        <Notice tone="info">
          누가 무엇을 찾아왔는지는 <b>끝까지 공개되지 않아요.</b> 몇 명이 겹쳤는지만 보여드려요.
        </Notice>
      </Body>
    </Screen>
  );
}
