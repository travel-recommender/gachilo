"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTrip, type TripExtras } from "@/components/store";
import { stepsToKm } from "@/lib/consensus";
import { FocusCard, NavButtons, Page, PlanHeader, Sheet, Wheel, WineSlider } from "@/components/gachiro";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const toHHMM = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

type Side = "dayStart" | "dayEnd";
type Trade = keyof TripExtras["tradeoff"];

const TRADES: { key: Trade; left: string; right: string }[] = [
  { key: "pace", left: "바쁘게", right: "여유롭게" },
  { key: "distance", left: "이동 짧게", right: "멀어도 괜찮다" },
  { key: "spend", left: "절약", right: "소비 괜찮" },
];

/**
 * P6 — 체력 · trade off. 마지막 입력 화면이라 "다음"에서 서버에 제출한다.
 * 활동 시간은 시작~종료 차이로 activeMin을 정한다. 트레이드오프는 저장만 하고 #35에서 알고리즘에 넣는다.
 */
export default function Condition() {
  const router = useRouter();
  const { state, set, setMine, setExtra, submitMine } = useTrip();
  const { extra } = state;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dial, setDial] = useState<Side | null>(null);

  // 서버에서 복원한 activeMin과 화면 시각이 다르면 시작은 두고 종료를 맞춘다
  useEffect(() => {
    if (toMin(extra.dayEnd) - toMin(extra.dayStart) !== state.mine.activeMin) {
      setExtra({ dayEnd: toHHMM(toMin(extra.dayStart) + state.mine.activeMin) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const span = toMin(extra.dayEnd) - toMin(extra.dayStart);
  const setTime = (side: Side, value: string) => {
    const next = { dayStart: extra.dayStart, dayEnd: extra.dayEnd, [side]: value };
    setExtra({ [side]: value } as Partial<TripExtras>);
    const d = toMin(next.dayEnd) - toMin(next.dayStart);
    if (d > 0) setMine({ activeMin: d });
  };

  /** 서버에 내 입력을 저장하고 기다리기(방) 또는 결과(데모)로 간다 */
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await submitMine();
      set({ submitted: true });
      router.push(state.room ? "/waiting" : "/result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "입력을 저장하지 못했어요.");
      setBusy(false);
    }
  };

  const timeBox = (side: Side, label: string) => (
    <button onClick={() => setDial(side)}
      className="h-[51px] flex-1 rounded-[10px] border border-line-soft px-2 text-left">
      <span className="block text-[14px] font-black leading-[17px]">{label}</span>
      <span className="mt-1 block text-center text-[14px] font-semibold leading-[17px]">{extra[side]}</span>
    </button>
  );

  const [hh, mm] = dial ? extra[dial].split(":") : ["09", "00"];

  return (
    <Page nav={<NavButtons prev="/budget" next={submit} busy={busy} nextDisabled={span <= 0} />}>
      <PlanHeader title="체력 · trade off" />
      <div className="space-y-[26px] px-5 pt-[30px]">
        {state.inputMissing && (
          <p className="rounded-[10px] bg-wine-50 px-3 py-2 text-[12px] leading-relaxed text-wine">
            이 기기에 입력이 남아 있지 않고 저장된 입력도 아직 불러오지 못했어요. 여기서 저장하면 기본값이 저장된 입력을 덮어써서
            저장하지 않아요. <b>가고 싶은 곳 고르기부터 다시</b> 입력해 주세요.
          </p>
        )}

        <FocusCard className="px-[14px] pb-6 pt-[10px]">
          <div className="mb-3 pl-[3px] text-[17px] font-medium">하루 활동 시간</div>
          <div className="flex gap-[23px]">
            {timeBox("dayStart", "시작")}
            {timeBox("dayEnd", "종료")}
          </div>
          {span <= 0 && <p className="mt-2 text-[11.5px] text-wine">종료는 시작보다 늦어야 해요.</p>}
        </FocusCard>

        <FocusCard className="px-4 pb-3 pt-[14px]">
          <div className="flex items-baseline justify-between">
            <span className="text-[17px] font-medium">하루에 걸을 수 있는 양</span>
            <span className="text-[14px] font-medium text-line">약 {stepsToKm(state.mine.stepLimit).toFixed(1)}KM</span>
          </div>
          <div className="mt-3 text-[29.704px] font-extrabold leading-9">
            {state.mine.stepLimit.toLocaleString("ko-KR")} 보
          </div>
          <div className="mt-2">
            <WineSlider label="하루에 걸을 수 있는 양" value={state.mine.stepLimit} min={1000} max={40000} step={500}
              onChange={(v) => setMine({ stepLimit: v })} left="1,000보" right="40,000보" />
          </div>
        </FocusCard>

        <FocusCard className="px-[17px] pb-5 pt-[10px]">
          <div className="text-[17px] font-medium">trade off</div>
          <div className="mt-[18px] space-y-[18px]">
            {TRADES.map((t) => (
              <div key={t.key}>
                <div className="flex justify-between text-[14px] font-medium">
                  <span>{t.left}</span><span>{t.right}</span>
                </div>
                <WineSlider label={`${t.left} 또는 ${t.right}`} value={Math.round(extra.tradeoff[t.key] * 100)}
                  min={0} max={100} step={1}
                  onChange={(v) => setExtra({ tradeoff: { ...extra.tradeoff, [t.key]: v / 100 } })} />
              </div>
            ))}
          </div>
        </FocusCard>

        {error && <p className="text-[12px] leading-relaxed text-wine">{error}</p>}
      </div>

      <Sheet title={dial === "dayEnd" ? "종료 시각" : "시작 시각"} open={dial !== null} onClose={() => setDial(null)}>
        {dial && (
          <>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Wheel label="시" items={HOURS} value={hh} onChange={(h) => setTime(dial, `${h}:${mm}`)} />
              </div>
              <span className="text-[22px] font-extrabold">:</span>
              <div className="flex-1">
                <Wheel label="분" items={MINUTES} value={MINUTES.includes(mm) ? mm : "00"}
                  onChange={(m) => setTime(dial, `${hh}:${m}`)} />
              </div>
            </div>
            <button onClick={() => setDial(null)}
              className="mt-4 h-[50px] w-full rounded-[20px] bg-wine text-[18px] font-extrabold text-white">확인</button>
          </>
        )}
      </Sheet>
    </Page>
  );
}
