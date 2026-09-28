"use client";
import { useState } from "react";
import { useTrip } from "@/components/store";
import { findMember } from "@/lib/places";
import { stepsToKm } from "@/lib/consensus";
import { fmtTime } from "@/lib/schedule";
import { explainDay } from "@/lib/explain";
import { RouteMap, dayColor } from "@/components/RouteMap";
import {
  Avatar, Body, Card, Dot, Footer, LinkButton, Notice, Screen, SectionTitle, TopBar, won,
} from "@/components/ui";

export default function Plan() {
  const { state, schedule, submissions } = useTrip();
  const [day, setDay] = useState(1);
  const [map, setMap] = useState(false);
  const plan = schedule.plans.find((p) => p.day === day) ?? schedule.plans[0];
  const groupWalk = Math.min(...submissions.map((s) => stepsToKm(s.stepLimit)));

  if (!plan) {
    return (
      <Screen><TopBar title="일정" back="/result" />
        <Body><Notice tone="warn">일정을 만들 수 없어요.</Notice></Body>
      </Screen>
    );
  }

  const over = plan.walkKm > groupWalk;

  return (
    <Screen className="bg-surface">
      <TopBar title="일정과 동선" subtitle={`오사카 ${state.nights}박 ${state.nights + 1}일`} back="/result"
        right={
          <button onClick={() => setMap((v) => !v)} className="chip bg-surface text-ink-700">
            {map ? "목록" : "지도"}
          </button>
        } />
      <Body>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {schedule.plans.map((p) => (
            <button key={p.day} onClick={() => setDay(p.day)}
              className={`shrink-0 rounded-full px-3.5 py-2 text-[12.5px] font-semibold transition ${
                day === p.day ? "text-white" : "bg-white text-ink-500"}`}
              style={day === p.day ? { background: dayColor(p.day) } : undefined}>
              {p.day}일차
            </button>
          ))}
        </div>

        <Card>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[15px] font-bold">{plan.day}일차</div>
              <div className="text-[11.5px] text-ink-500">{plan.items.length}곳</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-ink-500">1인 비용</div>
              <div className="text-[15px] font-bold tabular-nums">{won(plan.cost)}</div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-surface py-2">
              <div className="text-[10.5px] text-ink-500">걷는 거리</div>
              <div className={`text-[14px] font-bold tabular-nums ${over ? "text-coral-500" : ""}`}>
                {plan.walkKm}km
              </div>
            </div>
            <div className="rounded-xl bg-surface py-2">
              <div className="text-[10.5px] text-ink-500">총 이동</div>
              <div className="text-[14px] font-bold tabular-nums">{plan.totalKm}km</div>
            </div>
            <div className="rounded-xl bg-surface py-2">
              <div className="text-[10.5px] text-ink-500">이동 시간</div>
              <div className="text-[14px] font-bold tabular-nums">{plan.totalMoveMin}분</div>
            </div>
          </div>
          <div className="mt-3">
            <Notice tone={over ? "warn" : "ok"}>{explainDay(plan, groupWalk)}</Notice>
          </div>
        </Card>

        {map ? (
          <Card>
            <SectionTitle hint="색이 찬 원 = 다 같이">동선</SectionTitle>
            <div className="mt-2"><RouteMap plan={plan} /></div>
          </Card>
        ) : (
          <div className="space-y-2.5">
            {plan.items.map((it, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex w-12 shrink-0 flex-col items-center pt-1">
                  <span className="text-[11px] font-bold tabular-nums" style={{ color: dayColor(plan.day) }}>
                    {fmtTime(it.startMin)}
                  </span>
                  {i < plan.items.length - 1 && <div className="mt-1.5 w-px flex-1 bg-ink-300/40" />}
                </div>
                <Card className={`flex-1 ${it.tier !== "core" ? "border border-dashed border-ink-300/60" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[14px] font-bold">{it.place.name}</span>
                        {it.tier === "option" && <span className="chip bg-brand-50 text-brand-700">선택</span>}
                        {it.tier === "filled" && <span className="chip bg-surface text-ink-500">자동 추가</span>}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-500">
                        <Dot category={it.place.category} size={6} />
                        {it.place.area} · {fmtTime(it.startMin)}–{fmtTime(it.endMin)}
                      </div>
                      {it.moveMin > 0 && (
                        <div className="mt-1 text-[10.5px] text-ink-300">
                          직전 장소에서 {it.moveKm.toFixed(1)}km · {it.moveMin}분
                        </div>
                      )}
                      {it.tier === "option" && it.participants.length > 0 && (
                        <div className="mt-1.5 flex -space-x-1">
                          {it.participants.map((id) => (
                            <span key={id} className="rounded-full border-2 border-white">
                              <Avatar name={findMember(id).name} color={findMember(id).color} size={20} />
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="shrink-0 text-[12px] font-semibold tabular-nums">
                      {it.place.cost ? won(it.place.cost) : "무료"}
                    </span>
                  </div>
                </Card>
              </div>
            ))}
          </div>
        )}

        <Notice tone="info">
          <b>자동 추가</b>는 빈 식사 시간을 채운 곳이에요. 아무도 고르지 않았지만 동선에서 가장 가까운 식당을 넣었어요.
        </Notice>
      </Body>
      <Footer>
        <LinkButton href="/compare" variant="line">전략 비교 보기</LinkButton>
      </Footer>
    </Screen>
  );
}
