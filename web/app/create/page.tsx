"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTrip } from "@/components/store";
import { defaultStartDate, inviteUrl, nightsBetween, toDateRange } from "@/lib/room-api";
import { Hero, NavButtons, Page, Toast, asset } from "@/components/gachiro";
import { RangeCalendar, fmtDay } from "@/components/RangeCalendar";

const MAX_MEMBERS = 6;
/** 서버가 받는 여행 기간은 1~30일이다 */
const MAX_NIGHTS = 29;

/**
 * P1 — 표지 / 방 만들기.
 * 날짜와 이름을 정하고 "다음"을 누르면 방이 만들어지고 공용 초대 링크가 나온다.
 * 링크를 보낸 뒤 한 번 더 "다음"을 누르면 장소 찾기로 간다.
 */
export default function Create() {
  const router = useRouter();
  const { state, set, setMemberNames, createRoom, reset } = useTrip();
  // 초대받아 들어온 자리가 아니라 내가 만든 방일 때만 링크를 보여준다
  const owned = state.room?.ownerToken ? state.room : null;

  const initialStart = state.startDate || defaultStartDate();
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(toDateRange(initialStart, state.nights).endDate);
  const [calendar, setCalendar] = useState(false);
  const [names, setNames] = useState<string[]>(
    owned ? owned.members.map((m) => m.name) : ["", ""]
  );
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const filled = names.map((n) => n.trim()).filter(Boolean);
  const unique = new Set(filled).size === filled.length;
  const valid = !!start && !!end && filled.length >= 2 && unique;
  const link = owned?.inviteToken && typeof window !== "undefined"
    ? inviteUrl(window.location.origin, owned.roomId, owned.inviteToken) : null;

  const setName = (i: number, v: string) => setNames((ns) => ns.map((n, k) => (k === i ? v : n)));
  const addName = () => {
    if (names.length >= MAX_MEMBERS) return;
    setNames((ns) => [...ns, ""]);
    setEditing(names.length);
  };
  const removeName = (i: number) => { setNames((ns) => ns.filter((_, k) => k !== i)); setEditing(null); };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setToast("복사되었습니다");
    } catch {
      setToast("복사하지 못했어요. 링크를 길게 눌러 복사해 주세요");
    }
  };

  const next = async () => {
    if (owned) { router.push("/pick"); return; }
    setBusy(true);
    setError(null);
    setMemberNames(filled);
    try {
      await createRoom(start, nightsBetween(start, end), filled);
      setToast("초대 링크가 만들어졌어요. 복사해서 보내 주세요");
    } catch (e) {
      setError(e instanceof Error ? e.message : "방을 만들지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  // 서버가 꺼져 있어도 발표·수업 중에 화면이 막히면 안 된다
  const startLocal = () => {
    setMemberNames(filled);
    set({ room: null, startDate: start, nights: nightsBetween(start, end) });
    router.push("/pick");
  };

  const dateBox = (label: string, value: string) => (
    <button onClick={() => !owned && setCalendar((v) => !v)} disabled={!!owned}
      className="flex h-[51px] flex-1 items-center justify-between rounded-[10px] border border-line-soft pl-2 pr-1.5 text-left">
      <span>
        <span className="block text-[14px] font-black leading-[17px]">{label}</span>
        <span className="mt-1 block text-[14px] font-semibold leading-[17px]">{fmtDay(value)}</span>
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset("/ui/calendar.png")} alt="" width={32} height={32} />
    </button>
  );

  return (
    <Page nav={<NavButtons prev="/" next={next} busy={busy} nextDisabled={!owned && !valid} />}>
      <Hero />
      <div className="space-y-[15px] px-5 pt-[26px]">
        <section aria-label="여행 날짜" className="rounded-[20px] border border-line-soft px-[18px] py-4">
          <div className="flex gap-[23px]">
            {dateBox("체크인", start)}
            {dateBox("체크 아웃", end)}
          </div>
          {calendar && !owned && (
            <RangeCalendar start={start} end={end} min={defaultStartDate()} maxNights={MAX_NIGHTS}
              onChange={(s, e) => { setStart(s); setEnd(e); if (e) setCalendar(false); }} />
          )}
        </section>

        <section aria-label="같이 가는 사람" className="rounded-[20px] border border-line-soft px-[13px] py-[23px]">
          <div className="flex flex-wrap gap-[9px]">
            {names.map((n, i) =>
              editing === i && !owned ? (
                <span key={i} className="flex h-[30px] items-center rounded-[6.795px] border border-wine bg-white pl-2">
                  <input autoFocus value={n} maxLength={40} onChange={(e) => setName(i, e.target.value)}
                    onBlur={() => setEditing(null)} onKeyDown={(e) => e.key === "Enter" && setEditing(null)}
                    placeholder={i === 0 ? "내 이름" : "이름"} aria-label={i === 0 ? "내 이름" : `${i + 1}번째 이름`}
                    className="w-[64px] bg-transparent text-[14px] font-semibold outline-none" />
                  {i > 0 && (
                    <button onMouseDown={(e) => e.preventDefault()} onClick={() => removeName(i)}
                      aria-label={`${n || "이름"} 빼기`} className="px-1.5 text-[14px] text-mute">×</button>
                  )}
                </span>
              ) : (
                <button key={i} onClick={() => !owned && setEditing(i)}
                  className={`h-[30px] min-w-[80px] rounded-[6.795px] border px-3 text-[14px] font-semibold ${
                    n.trim() ? "border-line-soft text-black" : "border-dashed border-line-soft text-mute-soft"}`}>
                  {n.trim() || (i === 0 ? "내 이름" : "이름")}
                </button>
              )
            )}
            {!owned && names.length < MAX_MEMBERS && (
              <button onClick={addName} aria-label="같이 갈 사람 추가"
                className="h-[30px] w-[80px] rounded-[6.795px] border border-dashed border-line-soft bg-white/30 text-[13.333px] font-semibold text-line-soft">
                +
              </button>
            )}
          </div>
          {!owned && (
            <p className="mt-3 text-[11.5px] font-medium text-mute">
              {filled.length < 2 ? "나를 포함해 2명 이상 적어 주세요." : !unique ? "이름이 겹쳐요." : "이름을 누르면 고칠 수 있어요."}
            </p>
          )}
        </section>

        <div className="text-center">
          {link ? (
            <button onClick={copy} className="mx-auto flex max-w-full items-center gap-2 px-2">
              <span className="truncate text-[17px] font-semibold text-wine">{link.replace(/^https?:\/\//, "")}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset("/ui/copy.jpg")} alt="링크 복사" width={22} height={22} className="shrink-0" />
            </button>
          ) : (
            <p className="text-[13px] font-medium text-mute-soft">다음을 누르면 초대 링크가 만들어져요</p>
          )}
          {toast && <Toast text={toast} onDone={() => setToast(null)} />}
          {owned && (
            <button onClick={() => { reset(); setNames(["", "", ""]); }}
              className="mt-2 text-[11.5px] font-medium text-mute underline">
              새 방 만들기
            </button>
          )}
          {error && (
            <div className="mt-2 rounded-[10px] bg-wine-50 px-3 py-2 text-[12px] leading-relaxed text-wine">
              {error}
              <button onClick={startLocal} className="mt-1 block w-full font-bold underline">서버 없이 데모로 계속하기</button>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}
