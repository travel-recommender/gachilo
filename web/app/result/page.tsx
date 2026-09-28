"use client";
import { useTrip } from "@/components/store";
import { findMember } from "@/lib/places";
import { tripBudget } from "@/lib/consensus";
import { explainPlace, explainResult } from "@/lib/explain";
import {
  Avatar, Bar, Body, Card, Dot, Footer, LinkButton, Notice, Screen, SectionTitle, TopBar, pct, won,
} from "@/components/ui";

export default function Result() {
  const { state, consensus, submissions } = useTrip();
  const days = state.nights + 1;
  const lines = explainResult(consensus, submissions, days);
  const groupBudget = Math.min(...submissions.map((s) => tripBudget(s, days)));
  const m = consensus.metrics;

  return (
    <Screen className="bg-surface">
      <TopBar title="합의 결과" subtitle={`오사카 ${state.nights}박 ${days}일 · ${state.members.length}명`} back="/" />
      <Body>
        <Card className="animate-pop bg-gradient-to-br from-brand-600 to-brand-400 text-white">
          <div className="text-[11px] text-white/70">다 같이 가는 곳</div>
          <div className="text-[30px] font-bold leading-tight">{consensus.core.length}곳</div>
          <div className="mt-1 text-[12.5px] text-white/85">
            원하는 사람만 가는 곳 {consensus.options.length}곳 · 1인 {won(m.perPersonCost)}
          </div>
          {m.mustKeptRate === 1 && (
            <div className="mt-3 inline-flex rounded-full bg-white/20 px-3 py-1.5 text-[12px] font-semibold">
              {state.members.length}명의 꼭 가고 싶은 곳, 모두 지켰어요
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle>어떻게 정해졌나요</SectionTitle>
          <div className="mt-2 space-y-1.5">
            {lines.map((l, i) => (
              <p key={i} className="text-[12.5px] leading-relaxed text-ink-700">· {l}</p>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle hint="누가 얼마를 적었는지는 비공개">사람별 만족도</SectionTitle>
          <div className="mt-3 space-y-2.5">
            {consensus.satisfaction.map((s) => {
              const mem = findMember(s.memberId);
              return (
                <div key={s.memberId} className="flex items-center gap-2.5">
                  <Avatar name={mem.name} color={mem.color} size={28} />
                  <span className="w-10 shrink-0 text-[12px] font-semibold">{mem.name}</span>
                  <Bar value={s.score} color={mem.color} />
                  <span className="w-9 shrink-0 text-right text-[12px] font-semibold tabular-nums">
                    {pct(s.score)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-black/5 pt-3 text-center">
            <div><div className="text-[10.5px] text-ink-500">평균</div>
              <div className="text-[14px] font-bold tabular-nums">{pct(m.mean)}</div></div>
            <div><div className="text-[10.5px] text-ink-500">가장 낮은 사람</div>
              <div className="text-[14px] font-bold tabular-nums">{pct(m.min)}</div></div>
            <div><div className="text-[10.5px] text-ink-500">편차</div>
              <div className="text-[14px] font-bold tabular-nums">{m.std.toFixed(3)}</div></div>
          </div>
        </Card>

        <SectionTitle hint={`${consensus.core.length}곳`}>다 같이 가요</SectionTitle>
        <div className="space-y-2">
          {consensus.core.map((s) => (
            <Card key={s.place.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    {s.mustOf && <span className="text-brand-600">★</span>}
                    <span className="truncate text-[14px] font-bold">{s.place.name}</span>
                    {s.aiAdded && <span className="chip bg-brand-50 text-brand-600">AI 추가</span>}
                    {s.place.custom && <span className="chip bg-surface text-ink-500">직접 추가</span>}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-500">
                    <Dot category={s.place.category} size={6} />{s.place.area}
                  </div>
                  <p className="mt-1 text-[11.5px] text-brand-700">{explainPlace(consensus, s.place.id)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[12px] font-semibold tabular-nums">
                    {s.place.cost ? won(s.place.cost) : "무료"}
                  </div>
                  {s.votes > 1 && <div className="mt-0.5 text-[10.5px] text-ink-300">{s.votes}명 선택</div>}
                </div>
              </div>
            </Card>
          ))}
        </div>

        {consensus.options.length > 0 && (
          <>
            <SectionTitle hint={`${consensus.options.length}곳`}>원하는 사람만 가요</SectionTitle>
            <Notice tone="info">
              모두가 모든 곳에 함께 갈 필요는 없어요. 자유시간에 원하는 분만 다녀오세요.
            </Notice>
            <div className="space-y-2">
              {consensus.options.map((s) => (
                <Card key={s.place.id} className="border border-dashed border-ink-300/60">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="truncate text-[14px] font-bold">{s.place.name}</span>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-500">
                        <Dot category={s.place.category} size={6} />{s.place.area}
                      </div>
                      <div className="mt-1.5 flex -space-x-1">
                        {s.participants.map((id) => (
                          <span key={id} className="rounded-full border-2 border-white">
                            <Avatar name={findMember(id).name} color={findMember(id).color} size={22} />
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="shrink-0 text-[12px] font-semibold tabular-nums">
                      {s.place.cost ? won(s.place.cost) : "무료"}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}

        {consensus.excluded.length > 0 && (
          <Card className="bg-white/60 shadow-none">
            <SectionTitle hint={`${consensus.excluded.length}곳`}>이번엔 못 갔어요</SectionTitle>
            <div className="mt-2 space-y-1.5">
              {consensus.excluded.map((s) => (
                <div key={s.place.id} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="truncate text-ink-500">{s.place.name}</span>
                  <span className="shrink-0 text-[11px] text-ink-300">
                    {explainPlace(consensus, s.place.id)}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        <p className="px-1 text-[11px] leading-relaxed text-ink-300">
          그룹 예산은 가장 빠듯한 분에 맞춘 {won(groupBudget)}이에요. 누구인지는 공개하지 않아요.
        </p>
      </Body>
      <Footer>
        <div className="flex gap-2">
          <LinkButton href="/compare" variant="line">전략 비교</LinkButton>
          <LinkButton href="/plan">일정 보기</LinkButton>
        </div>
      </Footer>
    </Screen>
  );
}
