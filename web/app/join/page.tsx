"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTrip } from "@/components/store";
import { ApiError, roomApi, type ApiInviteInfo } from "@/lib/room-api";
import { seatRow } from "@/lib/room-state";
import { Hero, NavButtons, Page, asset } from "@/components/gachiro";
import { SPLASH_DONE_MS, Splash } from "@/components/Splash";
import { fmtShort } from "@/components/RangeCalendar";
import { PinSheet } from "@/components/PinSheet";

/** 로딩 화면을 보여주는 최소 시간 */
const SPLASH_MS = SPLASH_DONE_MS;

/**
 * 초대 링크로 들어오는 화면.
 * - 공용 링크 `?room=&k=` : 로딩(P0) 뒤 이름을 고른다(P2). 고를 때 PIN 4자리를 정한다.
 *   이미 고른 이름은 다른 사람이 고를 수 없고, 본인은 이름 + PIN으로 다시 들어온다 (화면을 닫으면 자리가 사라진다).
 * - 예전 사람별 링크 `?room=&m=&t=` : 바로 그 자리로 들어간다.
 */
function JoinInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { state, seatRoom, joinRoom, ready } = useTrip();
  const [info, setInfo] = useState<ApiInviteInfo | null>(null);
  const [splash, setSplash] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  // PIN 시트: set = 처음 고를 때 정하기, enter = 이미 고른 내 이름으로 다시 들어가기
  const [pin, setPin] = useState<{ mode: "set" | "enter"; memberId?: string; name: string } | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  // 이 기기의 자리 토큰이 서버에서 거절됐다 — 다른 기기가 이 이름으로 PIN 재접속해 폐기됐다
  const [revoked, setRevoked] = useState(false);

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
    if (seated && !revoked && !picked) setPicked(seated.memberId);
  }, [seated, revoked, picked]);

  if ((splash || (!info && !error)) && !error) return <Splash />;

  const next = async () => {
    if (!roomId || !invite) return;
    setBusy(true);
    setError(null);
    // 이미 앉은 자리(이전 시도에서 토큰을 받았거나 재접속)는 다시 고르지 않고 같은 토큰으로 이어간다
    if (seated && !revoked && !adding && picked === seated.memberId) {
      try {
        await joinRoom(roomId, seated.memberId, seated.token);
        router.push("/pick");
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) {
          // 같은 토큰으로 다시 시도해도 계속 403이다. 이 자리는 PIN으로만 되찾는다
          const me = info!.members.find((m) => m.id === seated.memberId);
          setRevoked(true);
          setPicked(null);
          setBusy(false);
          if (me?.hasPin) {
            setError(`다른 기기에서 ${me.name} 이름으로 다시 들어와 이 기기 연결이 끊겼어요. PIN을 입력하면 다시 들어와요.`);
            setPinError(null);
            setPin({ mode: "enter", memberId: me.id, name: me.name });
          } else {
            setError("이 기기 연결이 끊겼어요. 방을 만든 사람에게 링크를 다시 받아주세요.");
          }
          return;
        }
        setError(e instanceof Error ? e.message : "방 정보를 불러오지 못했어요. 다음을 눌러 다시 시도해 주세요.");
        setBusy(false);
      }
      return;
    }
    setBusy(false);
    const name = adding ? newName.trim() : info!.members.find((m) => m.id === picked)?.name ?? "";
    setPinError(null);
    setPin({ mode: "set", name });
  };

  /** 처음 고르기: 정한 PIN과 함께 자리를 받는다 */
  const claimWith = async (code: string) => {
    if (!roomId || !invite) return;
    setPin(null);
    setBusy(true);
    let seat;
    try {
      seat = await roomApi.claim(roomId, invite, adding ? { name: newName.trim(), pin: code } : { memberId: picked!, pin: code });
    } catch (e) {
      setError(e instanceof Error ? e.message : "자리를 잡지 못했어요.");
      // 그 사이 다른 사람이 고른 이름이 있을 수 있으니 목록을 다시 받는다
      roomApi.inviteInfo(roomId, invite).then(setInfo).catch(() => {});
      setBusy(false);
      return;
    }
    // 서버는 이미 이 자리를 점유하고 예전 토큰을 폐기했다. 조회보다 먼저 받은 토큰을 저장한다
    const members = adding && !info!.members.some((m) => m.id === seat.memberId)
      ? [...info!.members, { id: seat.memberId, name: seat.name, claimed: true }] : info!.members;
    seatRoom({ ...info!, members }, seat.memberId, seat.submissionToken);
    setInfo({ ...info!, members: members.map((m) => (m.id === seat.memberId ? { ...m, claimed: true } : m)) });
    setAdding(false);
    setPicked(seat.memberId);
    try {
      await joinRoom(roomId, seat.memberId, seat.submissionToken);
      router.push("/pick");
    } catch (e) {
      setError(`${seat.name} 자리는 잡았어요. 방 정보를 불러오지 못했으니 다음을 눌러 다시 시도해 주세요.`);
      setBusy(false);
    }
  };

  /** 다시 들어가기: 이미 고른 내 이름 + PIN. 새 토큰을 받고 이전 기기는 끊긴다 */
  const rejoinWith = async (code: string) => {
    if (!roomId || !invite || !pin?.memberId) return;
    setBusy(true);
    setPinError(null);
    let sat = false;
    try {
      const seat = await roomApi.rejoin(roomId, invite, pin.memberId, code);
      // 조회보다 먼저 받은 토큰을 저장한다 (서버는 이미 이전 토큰을 폐기했다)
      seatRoom(info!, seat.memberId, seat.submissionToken, { ownerToken: seat.ownerToken ?? null, inviteToken: invite });
      sat = true;
      setRevoked(false);
      setError(null);
      setPin(null);
      setPicked(seat.memberId);
      const hasInput = await joinRoom(roomId, seat.memberId, seat.submissionToken);
      // 이미 낸 입력이 있으면 결과 쪽으로, 아니면 장소 찾기부터
      router.push(hasInput ? "/waiting" : "/pick");
    } catch (e) {
      // PIN 확인 전 실패(틀린 PIN·잠김)는 시트에, 자리를 받은 뒤 조회 실패는 화면에 알린다 — 자리는 이미 저장됐다
      if (!sat) setPinError(e instanceof Error ? e.message : "다시 들어가지 못했어요.");
      else setError("자리는 되찾았어요. 방 정보를 불러오지 못했으니 다음을 눌러 다시 시도해 주세요.");
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
                const row = seatRow(m, seated?.memberId ?? null, revoked);
                const taken = row === "rejoin" || row === "taken";
                const canRejoin = row === "rejoin";
                const on = !adding && picked === m.id;
                return (
                  <button key={m.id} role="radio" aria-checked={on} disabled={taken && !canRejoin}
                    onClick={() => {
                      if (canRejoin) { setPinError(null); setPin({ mode: "enter", memberId: m.id, name: m.name }); return; }
                      setPicked(m.id); setAdding(false);
                    }}
                    className={`flex h-[35px] w-full items-center justify-between rounded-[6.795px] pl-5 pr-[11px] text-[14px] font-semibold ${
                      on ? "bg-wine text-white" : taken ? "border border-line bg-line/30 text-mute-soft" : "border border-line bg-white text-black"}`}>
                    <span>{m.name}{taken && (
                      <span className="ml-2 text-[11.5px] font-medium">{canRejoin ? "참여 중 · 내 이름이면 눌러서 다시 들어가기" : "참여 중"}</span>
                    )}</span>
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
      <PinSheet open={!!pin} mode={pin?.mode ?? "set"} name={pin?.name ?? ""} busy={busy && !!pin} error={pinError}
        onClose={() => { setPin(null); setBusy(false); }}
        onDone={(code) => (pin?.mode === "enter" ? rejoinWith(code) : claimWith(code))} />
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
