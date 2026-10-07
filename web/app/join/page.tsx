"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTrip } from "@/components/store";
import { roomApi, type ApiInviteInfo } from "@/lib/room-api";
import { Hero, NavButtons, Page, asset } from "@/components/gachiro";
import { Splash } from "@/components/Splash";
import { fmtShort } from "@/components/RangeCalendar";

/** 로딩 화면을 보여주는 최소 시간 */
const SPLASH_MS = 1600;

/**
 * 초대 링크로 들어오는 화면.
 * - 공용 링크 `?room=&k=` : 로딩(P0) 뒤 이름을 고른다(P2). 고른 이름은 다른 사람이 다시 고를 수 없다.
 * - 예전 사람별 링크 `?room=&m=&t=` : 바로 그 자리로 들어간다.
 */
function JoinInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { state, joinRoom, ready } = useTrip();
  const [info, setInfo] = useState<ApiInviteInfo | null>(null);
  const [splash, setSplash] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const roomId = params.get("room");
  const invite = params.get("k");
  const memberId = params.get("m");
  const token = params.get("t");
  // 이 기기가 이미 이 방에 앉아 있으면 다시 고르지 않는다 (고른 이름은 다시 고를 수 없다)
  const seated = state.room?.roomId === roomId ? state.room : null;

  useEffect(() => {
    const t = setTimeout(() => setSplash(false), SPLASH_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (roomId && memberId && token) {
      joinRoom(roomId, memberId, token)
        .then(() => router.replace("/pick"))
        .catch((e) => setError(e instanceof Error ? e.message : "방 정보를 불러오지 못했어요."));
      return;
    }
    if (!roomId || !invite) {
      setError("링크가 올바르지 않아요. 방을 만든 사람에게 링크를 다시 받아주세요.");
      return;
    }
    roomApi.inviteInfo(roomId, invite)
      .then(setInfo)
      .catch((e) => setError(e instanceof Error ? e.message : "방 정보를 불러오지 못했어요."));
    // joinRoom은 매 렌더마다 새로 만들어지므로 의존성에 넣지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, roomId, invite, memberId, token]);

  useEffect(() => {
    if (seated && !picked) setPicked(seated.memberId);
  }, [seated, picked]);

  if ((splash || (!info && !error)) && !error) return <Splash />;

  const next = async () => {
    if (!roomId || !invite) return;
    if (seated && picked === seated.memberId) { router.push("/pick"); return; }
    setBusy(true);
    setError(null);
    try {
      const seat = await roomApi.claim(roomId, invite,
        adding ? { name: newName.trim() } : { memberId: picked! });
      await joinRoom(roomId, seat.memberId, seat.submissionToken);
      router.push("/pick");
    } catch (e) {
      setError(e instanceof Error ? e.message : "자리를 잡지 못했어요.");
      // 그 사이 다른 사람이 고른 이름이 있을 수 있으니 목록을 다시 받는다
      roomApi.inviteInfo(roomId, invite).then(setInfo).catch(() => {});
      setBusy(false);
    }
  };

  const canNext = adding ? newName.trim().length > 0 : !!picked;

  return (
    <Page nav={<NavButtons next={next} busy={busy} nextDisabled={!info || !canNext} />}>
      <Hero sub={info ? `${fmtShort(info.startDate)} - ${fmtShort(info.endDate)}` : undefined} />
      <div className="px-5 pt-[60px]">
        {info && (
          <>
            <h2 className="mb-[9px] text-[17px] font-extrabold">인원 선택</h2>
            <div role="radiogroup" aria-label="내 이름" className="space-y-[9px]">
              {info.members.map((m) => {
                const mine = seated?.memberId === m.id;
                const taken = m.claimed && !mine;
                const on = !adding && picked === m.id;
                return (
                  <button key={m.id} role="radio" aria-checked={on} disabled={taken}
                    onClick={() => { setPicked(m.id); setAdding(false); }}
                    className={`flex h-[35px] w-full items-center justify-between rounded-[6.795px] pl-5 pr-[11px] text-[14px] font-semibold ${
                      on ? "bg-wine text-white" : taken ? "border border-line bg-line/30 text-mute-soft" : "border border-line bg-white text-black"}`}>
                    <span>{m.name}{taken && <span className="ml-2 text-[11.5px] font-medium">참여 중</span>}</span>
                    {on ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={asset("/ui/check.png")} alt="" width={31} height={31} className="-mr-[3px]" />
                    ) : !taken && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={asset("/ui/radio.svg")} alt="" width={21} height={21} className="mr-[4px]" />
                    )}
                  </button>
                );
              })}
              {adding ? (
                <div className="flex h-[35px] items-center rounded-[6.795px] border border-wine pl-5 pr-3">
                  <input autoFocus value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)}
                    placeholder="내 이름" aria-label="직접 추가할 이름"
                    className="w-full bg-transparent text-[14px] font-semibold outline-none" />
                </div>
              ) : info.members.length < 6 && (
                <button onClick={() => { setAdding(true); setPicked(null); }}
                  className="flex h-[35px] w-full items-center rounded-[6.795px] border border-dashed border-line bg-white/20 pl-5 text-[14px] font-semibold">
                  직접 추가
                </button>
              )}
            </div>
          </>
        )}
        {error && <p className="mt-3 text-[12px] leading-relaxed text-wine">{error}</p>}
      </div>
    </Page>
  );
}

export default function Join() {
  return (
    <Suspense fallback={null}>
      <JoinInner />
    </Suspense>
  );
}
