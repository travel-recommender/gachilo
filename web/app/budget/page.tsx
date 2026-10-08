"use client";
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { useTrip } from "@/components/store";
import { toDateRange } from "@/lib/room-api";
import { AIRPORTS, airportLabel } from "@/lib/airports";
import { FocusCard, NavButtons, Page, PlanHeader, Sheet, Wheel, WineSlider, asset } from "@/components/gachiro";
import { LodgingSearch } from "@/components/LodgingSearch";
import { fmtShort } from "@/components/RangeCalendar";

const ORDINAL = ["첫째", "둘째", "셋째", "넷째", "다섯째", "여섯째", "일곱째", "여덟째", "아홉째", "열째"];
const nightLabel = (i: number) => (i < ORDINAL.length ? `${ORDINAL[i]}날 숙소` : `${i + 1}일차 숙소`);
const won = (n: number) => `${n.toLocaleString("ko-KR")} 원`;

/** "1402" → "14:02". 키보드로 숫자만 쳐도 시각이 된다 (피그마 댓글 #6) */
function toTime(raw: string) {
  const d = raw.replace(/\D/g, "").slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
}

/**
 * P5 — 예산 · 숙소 · 공항.
 * 하루 예산만 알고리즘에 들어간다. 공항·비행 시간·숙소는 저장해 두고 #35에서 연결한다.
 */
export default function Budget() {
  const router = useRouter();
  const { state, setMine, setExtra } = useTrip();
  const { extra } = state;
  const [airportSheet, setAirportSheet] = useState<"arrivalAirport" | "departureAirport" | null>(null);
  const range = toDateRange(state.startDate || new Date().toISOString().slice(0, 10), state.nights);
  const lodgings = Array.from({ length: state.nights }, (_, i) => extra.lodgings[i]);

  const setLodging = (i: number, v: { address: string; lat?: number; lng?: number }) => {
    const next = Array.from({ length: state.nights }, (_, k) => extra.lodgings[k] ?? { address: "" });
    next[i] = v;
    setExtra({ lodgings: next });
  };

  const airportBox = (key: "arrivalAirport" | "departureAirport", label: string) => (
    <button onClick={() => setAirportSheet(key)}
      className="flex h-[51px] flex-1 items-center justify-between rounded-[10px] border border-line-soft pl-2 pr-4 text-left">
      <span>
        <span className="block text-[14px] font-black leading-[17px]">{label}</span>
        <span className="mt-1 block text-[14px] font-semibold leading-[17px]">{airportLabel(extra[key])}</span>
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset("/ui/plane.png")} alt="" width={32} height={16} />
    </button>
  );

  const timeField = (key: "arrivalTime" | "departureTime", date: string, word: string, align: string) => (
    <label className={`flex min-w-0 flex-1 items-center gap-[3px] text-[14px] font-semibold ${align}`}>
      <span className="shrink-0">{fmtShort(date)}</span>
      <input value={extra[key]} inputMode="numeric" placeholder="--:--" aria-label={`${word} 시각`}
        onChange={(e) => setExtra({ [key]: toTime(e.target.value) })}
        className="w-[42px] min-w-0 bg-transparent text-center outline-none placeholder:text-line" />
      <span className="shrink-0">{word}</span>
    </label>
  );

  return (
    <Page nav={<NavButtons prev="/shortlist" next={() => router.push("/condition")} />}>
      <PlanHeader title={<>예산 <span className="font-normal">·</span> 숙소 <span className="font-normal">·</span> 공항</>} />
      <div className="space-y-6 px-5 pt-[43px]">
        <FocusCard className="px-4 pb-3 pt-[14px]">
          <div className="flex items-baseline justify-between">
            <span className="text-[17px] font-medium">하루에 사용할 돈</span>
            <span className="text-[14px] font-medium text-line">숙박 항공 제외</span>
          </div>
          <div className="mt-3 text-[29.704px] font-extrabold leading-9">{won(state.mine.budgetPerDay)}</div>
          <div className="mt-2">
            <WineSlider label="하루에 사용할 돈" value={state.mine.budgetPerDay} min={10000} max={500000} step={10000}
              onChange={(v) => setMine({ budgetPerDay: v })} left="10,000원" right="500,000원" />
          </div>
        </FocusCard>

        <FocusCard className="space-y-[14px] px-[19px] py-4">
          <div className="flex gap-[23px]">
            {airportBox("arrivalAirport", "도착 공항")}
            {airportBox("departureAirport", "떠나는 공항")}
          </div>
          <div className="flex h-[33px] items-center rounded-[10px] border border-line-soft px-2">
            {timeField("arrivalTime", range.startDate, "도착", "justify-start")}
            <span aria-hidden className="mx-1.5 h-[15px] w-[2px] shrink-0 bg-line" />
            {timeField("departureTime", range.endDate, "출발", "justify-end")}
          </div>
        </FocusCard>

        <div>
          {lodgings.map((l, i) => (
            <Fragment key={i}>
              {i > 0 && <div aria-hidden className="mx-auto h-[15px] w-[2px] bg-line" />}
              <FocusCard className="px-[14px] pb-[15px] pt-[14px]">
                <div className="mb-[14px] pl-[5px] text-[14px] font-black leading-[17px]">{nightLabel(i)}</div>
                <LodgingSearch label={nightLabel(i)} value={l} onChange={(v) => setLodging(i, v)} />
              </FocusCard>
            </Fragment>
          ))}
        </div>
      </div>

      <Sheet title={airportSheet === "departureAirport" ? "떠나는 공항" : "도착 공항"}
        open={airportSheet !== null} onClose={() => setAirportSheet(null)}>
        {airportSheet && (
          <>
            <Wheel label="공항" items={AIRPORTS.map((a) => a.code)} value={extra[airportSheet]}
              onChange={(code) => setExtra({ [airportSheet]: code })}
              render={(code) => {
                const a = AIRPORTS.find((x) => x.code === code)!;
                return <>{a.name} {a.code}<span className="ml-2 text-[11px] font-medium text-mute-soft">{a.country === "KR" ? "한국" : "일본"}</span></>;
              }} />
            <button onClick={() => setAirportSheet(null)}
              className="mt-4 h-[50px] w-full rounded-[20px] bg-wine text-[18px] font-extrabold text-white">확인</button>
          </>
        )}
      </Sheet>
    </Page>
  );
}
