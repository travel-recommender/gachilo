"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTrip } from "@/components/store";
import { Body, Card, Notice, Screen, SectionTitle, TopBar } from "@/components/ui";

/**
 * 초대 링크로 들어오는 화면.
 * `?room=&m=&t=` 를 받아 세션에 앉히고 1차 선택으로 보낸다.
 * 로그인은 없다 — 링크를 가진 사람이 그 자리의 주인이다.
 */
function JoinInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { joinRoom, ready } = useTrip();
  const [error, setError] = useState<string | null>(null);

  const roomId = params.get("room");
  const memberId = params.get("m");
  const token = params.get("t");
  const name = params.get("name") ?? "나";

  useEffect(() => {
    if (!ready) return;
    if (!roomId || !memberId || !token) {
      setError("링크가 올바르지 않아요. 방을 만든 사람에게 링크를 다시 받아주세요.");
      return;
    }
    joinRoom(roomId, memberId, token, name);
    router.replace("/pick");
    // joinRoom은 매 렌더마다 새로 만들어지므로 의존성에 넣지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, roomId, memberId, token]);

  return (
    <Screen>
      <TopBar title="여행에 참여하기" />
      <Body className="justify-center">
        {error ? (
          <Notice tone="warn">{error}</Notice>
        ) : (
          <Card>
            <SectionTitle>들어가는 중…</SectionTitle>
            <p className="mt-1 text-[12px] text-ink-500">
              잠시만요. 가고 싶은 곳 고르는 화면으로 이동해요.
            </p>
          </Card>
        )}
      </Body>
    </Screen>
  );
}

export default function Join() {
  return (
    <Suspense fallback={null}>
      <JoinInner />
    </Suspense>
  );
}
