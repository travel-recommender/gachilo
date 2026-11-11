"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ExperimentSurveyLink } from "@/components/ExperimentSurveyLink";
import { useTrip } from "@/components/store";
import { buildConsensus, kmToSteps } from "@/lib/consensus";
import { buildSchedule } from "@/lib/schedule";
import { explainResult } from "@/lib/explain";
import { FALLBACK_RATE, roomApi } from "@/lib/room-api";
import { hasCandidates, statusLine } from "@/lib/shared-flow";
import { useSharedResults } from "@/components/useSharedResults";
import { NavButtons, Page, PlanHeader, asset } from "@/components/gachiro";
import { WeatherRouteNotice } from "@/components/WeatherRouteNotice";
import { withoutWeatherRouteNotice } from "@/lib/weather-route-notice";
import { EXPERIMENT_MODE, experimentExplanation, experimentStatusLine, scheduleName, type Letter } from "@/lib/experiment";
import { findPlace } from "@/lib/places";
import { useExperiment } from "@/components/useExperiment";
import type { Strategy } from "@/lib/types";

const STRATEGIES: { id: Strategy; label: string; desc: string }[] = [
  { id: "average", label: "평균", desc: "팀원 모두의 점수를 평균내서 높은 곳부터 담았어요. 무난하게 다 같이 가는 곳이 가장 많아요." },
  { id: "least_misery", label: "최소 불만", desc: "가장 싫어하는 사람 기준으로 담았어요. 아무도 크게 불만이 없는 대신 후보가 조금 줄어요." },
  { id: "fairness", label: "공정성", desc: "사람 사이 만족 차이가 작은 곳부터 담았어요. 누구 하나 소외되지 않게 맞췄어요." },
];

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

interface Card {
  id: Strategy;
  label: string;
  desc: string;
  steps: number;
  spend: number;
  move: number;
  /** 고른 카드(버건디)에 쓰는 이 후보의 결과 설명 */
  note: string;
  ai: boolean;
  /** 실험 모드: 이 그룹에서 이 일정의 글자 */
  letter?: Letter;
  /** 실험 모드: 이 사람에게 설명 문장을 보여주는가 (5.3) */
  explained?: boolean;
}

const EXPERIMENT_HINT = "눌러서 하루 걷는 양·소비·이동을 확인하세요.";

/**
 * P7 — 후보 3개 비교. 카드를 누르면 그 후보가 펼쳐지고 하루 걷는 양·소비·이동이 나온다 (피그마 댓글 #3).
 * - 여행방: 서버가 계산한 공용 후보 3개를 모두가 똑같이 본다. 누구나 후보를 골라 P8에서 일정을 보고, 방장은 P8에서 확정한다.
 *   전원 제출 전에는 내 입력과 예시 동행자로 만든 미리보기를 보여주고, 확정은 막는다.
 * - 데모(서버 없음): 이 기기에서 계산한다.
 */
export default function Result() {
  const router = useRouter();
  const { state, set, setExtra, submissions } = useTrip();
  const days = state.nights + 1;
  const [rate, setRate] = useState(FALLBACK_RATE.krwPerJpy);
  const shared = useSharedResults();
  const snap = shared.snap;
  const server = shared.online && hasCandidates(snap);
  const exp = useExperiment();

  useEffect(() => {
    roomApi.exchangeRate()
      .then((r) => { if (r?.krw_per_jpy) setRate(Number(r.krw_per_jpy)); })
      .catch(() => { /* 서버가 없으면 기준 환율을 쓴다 */ });
  }, []);

  /** 이 기기에서 만든 후보 (데모·미리보기). store의 일정과 같은 규칙 */
  const localCards = useMemo<Card[]>(() => {
    const vetoed = new Set(submissions.flatMap((s) => s.vetoes ?? (s.veto ? [s.veto] : [])));
    return STRATEGIES.map((st) => {
      const consensus = buildConsensus({
        submissions, nights: state.nights, strategy: st.id, allowPartial: state.allowPartial,
      });
      const { plans } = buildSchedule(consensus.selections, days, { considerBags: true, fillMeals: true, vetoed });
      return {
        ...st,
        note: explainResult(consensus, submissions, days)[0] ?? "",
        ai: false,
        steps: kmToSteps(avg(plans.map((p) => p.walkKm))),
        spend: Math.round(avg(plans.map((p) => p.cost))),
        move: avg(plans.map((p) => p.totalKm)),
      };
    });
  }, [submissions, state.nights, state.allowPartial, days]);

  /**
   * 서버 공용 후보. 기기에서 다시 계산하거나 예시 입력을 섞지 않는다.
   * 실험 모드: 일정 A·B·C로만, 이 사람의 순서로 놓고, 전략 이름·방법 설명은 숨긴다. 설명 문장은 배정된 일정에만.
   * 실험 모드에서는 서버 후보가 나오기 전 미리보기(전략별 이 기기 계산)를 보여주지 않는다.
   */
  const cards: Card[] = EXPERIMENT_MODE
    ? (server && exp ? exp.slots.map((slot): Card | null => {
        const c = snap!.candidates.find((x) => x.strategy === slot.strategy);
        return c ? {
          id: slot.strategy, label: scheduleName(slot.letter), desc: EXPERIMENT_HINT,
          // 서버 요약에는 전략 이름이 있어 쓰지 않는다
          note: slot.explained ? experimentExplanation(c, state.mine, (id) => findPlace(id)?.name ?? "고른 곳").join(" ") : "", ai: false, letter: slot.letter, explained: slot.explained,
          steps: c.metrics.walkStepsPerDay, spend: c.metrics.costKrwPerDay, move: c.metrics.totalKmPerDay,
        } : null;
      }).filter((c): c is Card => !!c) : [])
    : server
    ? STRATEGIES.map((st) => {
        const c = snap!.candidates.find((x) => x.strategy === st.id);
        return c ? {
          ...st, note: c.summary, ai: c.explanationSource === "ai",
          steps: c.metrics.walkStepsPerDay, spend: c.metrics.costKrwPerDay, move: c.metrics.totalKmPerDay,
        } : null;
      }).filter((c): c is Card => !!c)
    : localCards;

  // 펼쳐 볼 후보. 확정된 게 있으면 그것, 없으면 마지막으로 누른 것
  const [view, setView] = useState<Strategy | null>(null);
  // 실험 방은 확정하지 않는다 (2장). 고르기 전에는 이 사람 화면의 첫 일정을 펼친다
  const confirmed = !EXPERIMENT_MODE && server && snap!.status === "ready" ? snap!.selectedStrategy : null;
  const shown: Strategy = view ?? confirmed ?? (EXPERIMENT_MODE ? cards[0]?.id ?? state.strategy : state.strategy);
  const shownCard = cards.find((c) => c.id === shown);

  const choose = (id: Strategy) => {
    setView(id);
    if (server) return; // 공용 결과에서는 방장 확정만 결과를 바꾼다
    if (id === state.strategy) return;
    set({ strategy: id });
    // 다른 후보를 고르면 P8에서 고친 순서·확정은 그 후보에 맞지 않는다
    setExtra({ planEdits: {}, confirmed: false });
  };

  // 하단 버튼: 고른 후보의 일정(P8)으로 간다. 공용 결과는 세 후보 모두 들어가 볼 수 있고, 확정은 P8에서 방장이 한다
  let nextLabel = "다음";
  let nextDisabled = false;
  let next = () => router.push("/plan");
  if (EXPERIMENT_MODE) {
    nextLabel = "일정 보기";
    nextDisabled = !shownCard?.letter;
    next = () => { if (shownCard?.letter) router.push(`/plan?c=${shownCard.letter}`); };
  } else if (shared.online && !server) {
    nextDisabled = true;
  } else if (server) {
    nextLabel = "일정 보기";
    next = () => router.push(`/plan?s=${shown}`);
  }

  const intro = EXPERIMENT_MODE
    ? experimentStatusLine(snap, shared.online, !!exp)
    : !shared.online
    ? "세 가지 방법으로 일정을 만들어 봤어요. 마음에 드는 후보를 눌러 고르세요."
    : server
      ? statusLine(snap, shared.isOwner)
      : `${statusLine(snap, shared.isOwner)} 아래는 내 입력과 예시 동행자로 이 기기에서 만든 미리보기예요.`;

  return (
    <Page nav={<NavButtons prev={shared.online ? "/waiting" : "/condition"} next={next}
      nextLabel={nextLabel} nextDisabled={nextDisabled} />}>
      <PlanHeader />
      <ExperimentSurveyLink />
      <div className="px-5 pt-[34px]">
        <div className="mb-[60px] space-y-2">
          <p className="text-[12px] font-medium leading-relaxed text-mute">{intro}</p>
          {shared.online && snap && !server && snap.status === "collecting" && (
            <p className="text-[12px] font-bold text-wine">{snap.submittedCount}/{snap.memberCount}명 제출</p>
          )}
          {shared.calcError && (
            <div className="rounded-[10px] bg-wine-50 px-3 py-2 text-[12px] leading-relaxed text-wine">
              후보를 계산하지 못했어요. {shared.calcError}
              <button onClick={shared.retryCalculate} className="mt-1 block font-bold underline">다시 계산하기</button>
            </div>
          )}
          {shared.error && <p className="text-[12px] leading-relaxed text-wine">{shared.error}</p>}
        </div>

        <div role="radiogroup" aria-label="일정 후보" className="space-y-[14px]">
          {cards.map((c) => {
            const on = shown === c.id;
            return (
              <button key={c.id} role="radio" aria-checked={on} onClick={() => choose(c.id)}
                className={`block w-full rounded-[6.795px] text-left transition ${
                  on ? "bg-wine px-[15px] pb-[15px] pt-[10px] text-white" : "border border-line bg-white px-5 pb-3 pt-[10px]"}`}>
                <div className="flex items-start justify-between">
                  <span className={on ? "text-[17px] font-extrabold" : "text-[14px] font-semibold"}>
                    {c.label}
                    {confirmed === c.id && <span className={`ml-2 text-[11px] font-bold ${on ? "text-white/80" : "text-wine"}`}>확정됨</span>}
                  </span>
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
                  {/* 고르기 전(회색)에는 방법 설명, 고른 뒤(버건디)에는 이 후보의 결과 설명만. 실험 모드에서 설명이 없는 일정은 비운다 */}
                  {on ? withoutWeatherRouteNotice(c.note) : c.desc}
                  {on && c.ai && <span className="ml-1 rounded-[20px] bg-white/20 px-1.5 py-[1px] text-[9px] font-bold">AI 설명</span>}
                </p>
              </button>
            );
          })}
        </div>
        {/* 날씨 안내는 서버 요약에서 뽑는다. 실험 모드에서는 두 조건 모두 같게 빼 둔다 */}
        {server && !EXPERIMENT_MODE && <WeatherRouteNotice summary={shownCard?.note} />}
        <p className="mt-3 text-[10.5px] text-mute-soft">
          엔화는 1엔 = {rate}원으로 계산했어요. 실제 환전 금액과 다를 수 있어요.
          {server && " 걸음·소비·이동은 추정치이고 교통·숙박비는 빠져 있어요."}
        </p>
      </div>
    </Page>
  );
}
