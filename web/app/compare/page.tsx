"use client";
import { useMemo } from "react";
import { useTrip } from "@/components/store";
import { buildConsensus } from "@/lib/consensus";
import { findMember } from "@/lib/places";
import {
  Avatar, Bar, Body, Card, Footer, LinkButton, Notice, Screen, SectionTitle, TopBar, pct,
} from "@/components/ui";
import type { Strategy } from "@/lib/types";

const LABEL: Record<Strategy, string> = {
  average: "평균",
  least_misery: "최소 불만",
  fairness: "공정성",
};
const DESC: Record<Strategy, string> = {
  average: "모두의 점수를 평균내서 높은 곳부터",
  least_misery: "가장 싫어하는 사람 기준으로",
  fairness: "만족도 편차가 작은 곳부터",
};

export default function Compare() {
  const { state, set, submissions } = useTrip();

  const results = useMemo(() => {
    const out: Record<string, ReturnType<typeof buildConsensus>> = {};
    (["average", "least_misery", "fairness"] as Strategy[]).forEach((st) => {
      out[st] = buildConsensus({
        submissions, nights: state.nights, strategy: st, allowPartial: state.allowPartial,
      });
    });
    return out;
  }, [submissions, state.nights, state.allowPartial]);

  const partialOn = useMemo(
    () => buildConsensus({ submissions, nights: state.nights, strategy: state.strategy, allowPartial: true }),
    [submissions, state.nights, state.strategy]
  );
  const partialOff = useMemo(
    () => buildConsensus({ submissions, nights: state.nights, strategy: state.strategy, allowPartial: false }),
    [submissions, state.nights, state.strategy]
  );

  return (
    <Screen className="bg-surface">
      <TopBar title="전략 비교" subtitle="연구용 화면" back="/result" />
      <Body>
        <Notice tone="info">
          같은 입력에 취합 전략만 바꿔서 비교합니다. 아래에서 전략을 고르면 결과 화면에도 적용돼요.
        </Notice>

        <Card>
          <SectionTitle hint="선호 취합 전략">전략별 결과</SectionTitle>
          <div className="mt-3 space-y-2">
            {(Object.keys(LABEL) as Strategy[]).map((st) => {
              const r = results[st];
              const on = state.strategy === st;
              return (
                <button key={st} onClick={() => set({ strategy: st })} className="w-full text-left">
                  <div className={`rounded-2xl p-3 transition ${on ? "bg-brand-50 ring-2 ring-brand-500" : "bg-surface"}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-[13.5px] font-bold ${on ? "text-brand-700" : ""}`}>{LABEL[st]}</span>
                      <span className="text-[11px] text-ink-500">
                        코어 {r.core.length} · 옵션 {r.options.length}
                      </span>
                    </div>
                    <div className="text-[11px] text-ink-500">{DESC[st]}</div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                      <div><div className="text-[10px] text-ink-500">평균</div>
                        <div className="text-[13px] font-bold tabular-nums">{pct(r.metrics.mean, 1)}</div></div>
                      <div><div className="text-[10px] text-ink-500">최저</div>
                        <div className="text-[13px] font-bold tabular-nums">{pct(r.metrics.min, 1)}</div></div>
                      <div><div className="text-[10px] text-ink-500">편차</div>
                        <div className="text-[13px] font-bold tabular-nums">{r.metrics.std.toFixed(3)}</div></div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <Card>
          <SectionTitle hint="이 프로젝트의 핵심 가설">부분 동행의 효과</SectionTitle>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">
            모두가 모든 곳에 함께 가야 한다고 두면 어떻게 달라지는지 비교합니다.
          </p>
          <div className="mt-3 space-y-2">
            {[
              { label: "부분 동행 허용", r: partialOn, on: true },
              { label: "전원 동행만", r: partialOff, on: false },
            ].map((x) => (
              <div key={x.label} className={`rounded-2xl p-3 ${x.on ? "bg-emerald-50" : "bg-surface"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold">{x.label}</span>
                  <span className="text-[11px] text-ink-500">
                    코어 {x.r.core.length} · 옵션 {x.r.options.length} · 제외 {x.r.excluded.length}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="w-10 text-[11px] text-ink-500">평균</span>
                  <Bar value={x.r.metrics.mean} color={x.on ? "#12b98c" : "#a6acba"} />
                  <span className="w-10 text-right text-[12px] font-bold tabular-nums">
                    {pct(x.r.metrics.mean, 1)}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="w-10 text-[11px] text-ink-500">최저</span>
                  <Bar value={x.r.metrics.min} color={x.on ? "#12b98c" : "#a6acba"} />
                  <span className="w-10 text-right text-[12px] font-bold tabular-nums">
                    {pct(x.r.metrics.min, 1)}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => set({ allowPartial: !state.allowPartial })}
            className="btn-line mt-3 w-full py-2 text-[12.5px]">
            {state.allowPartial ? "전원 동행만으로 바꿔보기" : "부분 동행 다시 켜기"}
          </button>
        </Card>

        <Card>
          <SectionTitle hint="가상 그룹 500개">시뮬레이션 결과</SectionTitle>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">
            3~6인, 2~4박 그룹을 무작위로 만들어 전략별로 비교한 결과입니다.
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-black/5">
            <table className="w-full text-[11.5px]">
              <thead className="bg-surface text-ink-500">
                <tr>
                  <th className="px-2 py-1.5 text-left font-semibold">조건</th>
                  <th className="px-2 py-1.5 text-right font-semibold">평균</th>
                  <th className="px-2 py-1.5 text-right font-semibold">최저</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr className="border-t border-black/5"><td className="px-2 py-1.5">평균 취합</td>
                  <td className="px-2 py-1.5 text-right">0.891</td><td className="px-2 py-1.5 text-right">0.789</td></tr>
                <tr className="border-t border-black/5"><td className="px-2 py-1.5">최소 불만</td>
                  <td className="px-2 py-1.5 text-right">0.892</td><td className="px-2 py-1.5 text-right">0.791</td></tr>
                <tr className="border-t border-black/5"><td className="px-2 py-1.5">공정성</td>
                  <td className="px-2 py-1.5 text-right">0.891</td><td className="px-2 py-1.5 text-right">0.788</td></tr>
                <tr className="border-t-2 border-black/10 bg-emerald-50/60 font-semibold">
                  <td className="px-2 py-1.5">부분 동행 허용</td>
                  <td className="px-2 py-1.5 text-right">0.891</td><td className="px-2 py-1.5 text-right">0.788</td></tr>
                <tr className="border-t border-black/5 text-ink-500">
                  <td className="px-2 py-1.5">전원 동행만</td>
                  <td className="px-2 py-1.5 text-right">0.809</td><td className="px-2 py-1.5 text-right">0.697</td></tr>
              </tbody>
            </table>
          </div>
          <Notice tone="ok">
            <b>취합 전략은 차이가 거의 없었습니다.</b> 반면 부분 동행을 허용하면 평균 만족도가 0.082 올랐고,
            500건 중 443건에서 개선됐어요. 공정성은 <b>누구를 우선할지 고르는 것</b>이 아니라
            <b> 함께 갈지 말지를 유연하게 두는 것</b>에서 나왔습니다.
          </Notice>
        </Card>

        <Card>
          <SectionTitle>입력값 (연구용)</SectionTitle>
          <div className="mt-2 space-y-1.5">
            {submissions.map((s) => {
              const m = findMember(s.memberId);
              return (
                <div key={s.memberId} className="flex items-center gap-2 text-[11.5px]">
                  <Avatar name={m.name} color={m.color} size={22} />
                  <span className="w-10 shrink-0 font-semibold">{m.name}</span>
                  <span className="text-ink-500">
                    {(s.budgetPerDay / 10000).toFixed(1)}만원/일 · {s.stepLimit.toLocaleString("ko-KR")}보 · {s.picks.length}곳
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink-300">
            실제 서비스에서는 이 화면을 사용자에게 보여주지 않습니다. 비공개 원칙 때문이에요.
          </p>
        </Card>
      </Body>
      <Footer>
        <LinkButton href="/result">결과로 돌아가기</LinkButton>
      </Footer>
    </Screen>
  );
}
