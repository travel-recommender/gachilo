"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTrip } from "@/components/store";
import { buildConsensus, kmToSteps } from "@/lib/consensus";
import { buildSchedule } from "@/lib/schedule";
import { explainResult } from "@/lib/explain";
import { FALLBACK_RATE, roomApi } from "@/lib/room-api";
import { NavButtons, Page, PlanHeader, asset } from "@/components/gachiro";
import type { Strategy } from "@/lib/types";

const STRATEGIES: { id: Strategy; label: string; desc: string }[] = [
  { id: "average", label: "평균", desc: "팀원 모두의 점수를 평균내서 높은 곳부터 담았어요. 무난하게 다 같이 가는 곳이 가장 많아요." },
  { id: "least_misery", label: "최소 불만", desc: "가장 싫어하는 사람 기준으로 담았어요. 아무도 크게 불만이 없는 대신 후보가 조금 줄어요." },
  { id: "fairness", label: "공정성", desc: "사람 사이 만족 차이가 작은 곳부터 담았어요. 누구 하나 소외되지 않게 맞췄어요." },
];

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * P7 — 후보 3개 비교. 카드를 누르면 그 후보가 선택되고 하루 걷는 양·소비·이동이 펼쳐진다 (피그마 댓글 #3).
 * 하루 소비 밑에는 엔화를 작게 함께 쓴다. 사람별 만족도는 회의 결정으로 뺐다.
 */
export default function Result() {
  const router = useRouter();
  const { state, set, setExtra, submissions } = useTrip();
  const days = state.nights + 1;
  const [rate, setRate] = useState(FALLBACK_RATE.krwPerJpy);

  useEffect(() => {
    roomApi.exchangeRate()
      .then((r) => { if (r?.krw_per_jpy) setRate(Number(r.krw_per_jpy)); })
      .catch(() => { /* 서버가 없으면 기준 환율을 쓴다 */ });
  }, []);

  /** 전략마다 합의 → 일정을 만들어 하루 평균을 낸다 (store의 일정과 같은 규칙) */
  const cards = useMemo(() => {
    const vetoed = new Set(submissions.map((s) => s.veto).filter(Boolean) as string[]);
    return STRATEGIES.map((st) => {
      const consensus = buildConsensus({
        submissions, nights: state.nights, strategy: st.id, allowPartial: state.allowPartial,
      });
      const { plans } = buildSchedule(consensus.selections, days, { considerBags: true, fillMeals: true, vetoed });
      return {
        ...st,
        lines: explainResult(consensus, submissions, days),
        steps: kmToSteps(avg(plans.map((p) => p.walkKm))),
        spend: Math.round(avg(plans.map((p) => p.cost))),
        move: avg(plans.map((p) => p.totalKm)),
      };
    });
  }, [submissions, state.nights, state.allowPartial, days]);

  return (
    <Page nav={<NavButtons prev="/condition" next={() => router.push("/plan")} />}>
      <PlanHeader />
      <div className="px-5 pt-[34px]">
        <p className="mb-[60px] text-[12px] font-medium leading-relaxed text-mute">
          {state.room
            // 서버는 방장이 계산하기 전까지 result가 비어 있다. 서버 결과를 붙이기 전까지는 로컬 계산임을 밝힌다
            ? "아직 서버 결과와 연결되지 않았어요. 내 입력과 예시 동행자 입력으로 이 기기에서 계산한 미리보기예요."
            : "세 가지 방법으로 일정을 만들어 봤어요. 마음에 드는 후보를 눌러 고르세요."}
        </p>

        <div role="radiogroup" aria-label="일정 후보" className="space-y-[14px]">
          {cards.map((c) => {
            const on = state.strategy === c.id;
            return (
              <button key={c.id} role="radio" aria-checked={on} onClick={() => {
                  if (on) return;
                  set({ strategy: c.id });
                  // 다른 후보를 고르면 P8에서 고친 순서·확정은 그 후보에 맞지 않는다
                  setExtra({ planEdits: {}, confirmed: false });
                }}
                className={`block w-full rounded-[6.795px] text-left transition ${
                  on ? "bg-wine px-[15px] pb-[15px] pt-[10px] text-white" : "border border-line bg-white px-5 pb-3 pt-[10px]"}`}>
                <div className="flex items-start justify-between">
                  <span className={on ? "text-[17px] font-extrabold" : "text-[14px] font-semibold"}>{c.label}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {on && <img src={asset("/ui/check.png")} alt="" width={31} height={31} className="-mr-[4px] -mt-[8px]" />}
                </div>
                {on && (
                  <div className="mt-[10px] grid grid-cols-3 gap-[6px] text-center">
                    {[
                      { k: "하루 걷는 양", v: `${c.steps.toLocaleString("ko-KR")} 보` },
                      { k: "하루 소비", v: `${c.spend.toLocaleString("ko-KR")} 원`, sub: `${Math.round(c.spend / rate).toLocaleString("ko-KR")} 엔` },
                      { k: "하루 총 이동", v: `${c.move.toFixed(1)}KM` },
                    ].map((m) => (
                      <div key={m.k}>
                        <div className="text-[14px] font-extrabold">{m.k}</div>
                        <div className="mt-[5px] flex h-[34px] flex-col items-center justify-center rounded-[6.795px] bg-white text-black">
                          <span className="text-[14px] font-extrabold leading-4">{m.v}</span>
                          {m.sub && <span className="text-[9px] font-extrabold leading-[11px] text-mute-soft">{m.sub}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <p className={`mt-2 text-[11px] leading-[1.45] ${on ? "font-semibold text-white" : "text-mute-soft"}`}>
                  {c.desc}
                  {on && c.lines[0] && <><br />{c.lines[0]}</>}
                </p>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[10.5px] text-mute-soft">
          엔화는 1엔 = {rate}원으로 계산했어요. 실제 환전 금액과 다를 수 있어요.
        </p>
      </div>
    </Page>
  );
}
