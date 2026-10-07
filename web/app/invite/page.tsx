"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTrip } from "@/components/store";
import { joinUrl } from "@/lib/room-api";
import { Avatar, Body, Card, Footer, Notice, Screen, SectionTitle, TopBar } from "@/components/ui";

/**
 * 초대 링크 화면 (방장만 본다).
 * 토큰이 링크에 실리므로 **사람마다 링크가 다르다.** 단체방에 하나만 뿌리면 안 된다.
 */
export default function Invite() {
  const router = useRouter();
  const { state } = useTrip();
  const room = state.room;
  const [copied, setCopied] = useState<string | null>(null);

  if (!room) {
    return (
      <Screen>
        <TopBar title="초대 링크" back="/" />
        <Body>
          <Notice tone="warn">
            아직 방이 없어요. 첫 화면에서 방을 먼저 만들어 주세요.
          </Notice>
        </Body>
      </Screen>
    );
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const copy = async (text: string, memberId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(memberId);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };

  return (
    <Screen>
      <TopBar title="초대 링크 보내기" subtitle={`${room.startDate} ~ ${room.endDate}`} back="/" />
      <Body>
        <Notice tone="info">
          <b>사람마다 링크가 달라요.</b> 각자에게 따로 보내주세요.
          링크에 그 사람의 출입증이 들어 있어서, 단체방에 하나만 올리면 서로의 자리에 들어갈 수 있어요.
        </Notice>

        <Card>
          <SectionTitle hint={`${room.members.length}명`}>참여자별 링크</SectionTitle>
          <div className="mt-3 space-y-3">
            {room.members.map((m, i) => {
              const url = joinUrl(origin, room.roomId, m);
              const isMe = m.id === room.memberId;
              return (
                <div key={m.id} className="flex items-center gap-2.5">
                  <Avatar name={m.name} color={state.members[i]?.color ?? "#2f45e0"} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold">
                      {m.name}{isMe && " (나)"}
                    </div>
                    <div className="truncate text-[10.5px] text-ink-300">{url}</div>
                  </div>
                  <button onClick={() => copy(url, m.id)}
                    className="shrink-0 rounded-xl bg-surface px-3 py-2 text-[12px] font-semibold text-ink-700">
                    {copied === m.id ? "복사됨" : "복사"}
                  </button>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <SectionTitle>방 번호</SectionTitle>
          <p className="mt-1 font-mono text-[13px]">{room.roomId}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-300">
            링크를 잃어버리면 이 번호로 다시 만들어 보낼 수 있어요.
          </p>
        </Card>
      </Body>
      <Footer>
        <button onClick={() => router.push("/pick")} className="btn-primary w-full">
          나도 고르러 가기
        </button>
      </Footer>
    </Screen>
  );
}
