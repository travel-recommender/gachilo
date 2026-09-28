"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTrip } from "@/components/store";
import { PlaceRow } from "@/components/PlaceSearch";
import { CATEGORIES, findPlace } from "@/lib/places";
import { Body, Card, Dot, Footer, Notice, Screen, SectionTitle, TopBar } from "@/components/ui";
import type { CategoryId } from "@/lib/types";

const LIMIT = 5;

/**
 * 2차 — 전원이 1차에서 찾아온 곳이 한자리에 모였다.
 * 여기서 가고 싶은 5곳, 꼭 가고 싶은 1곳, 빼고 싶은 1곳을 고른다.
 * 누가 올린 곳인지는 보여주지 않는다. 보이면 눈치를 보게 된다.
 */
export default function Shortlist() {
  const router = useRouter();
  const { state, setMine, pool, submissions } = useTrip();
  const { picks, must, veto } = state.mine;
  const [mode, setMode] = useState<"pick" | "veto">("pick");
  const [category, setCategory] = useState<CategoryId | null>(null);

  const votesOf = useMemo(() => {
    const m: Record<string, number> = {};
    submissions.forEach((s) => s.longlist.forEach((id) => (m[id] = (m[id] ?? 0) + 1)));
    return m;
  }, [submissions]);

  const list = useMemo(() => {
    const places = pool.map((id) => findPlace(id)).filter((p): p is NonNullable<typeof p> => !!p);
    const filtered = category ? places.filter((p) => p.category === category) : places;
    // 여러 사람이 올린 곳을 위로 — 누가 올렸는지는 감추고 겹친 수만 보여준다
    return [...filtered].sort((a, b) => (votesOf[b.id] ?? 0) - (votesOf[a.id] ?? 0));
  }, [pool, category, votesOf]);

  const toggle = (id: string) => {
    if (mode === "veto") {
      setMine({ veto: veto === id ? null : id, picks: picks.filter((p) => p !== id) });
      return;
    }
    if (veto === id) return;
    if (picks.includes(id)) {
      setMine({ picks: picks.filter((p) => p !== id), must: must === id ? null : must });
    } else if (picks.length < LIMIT) {
      setMine({ picks: [...picks, id] });
    }
  };

  const done = picks.length === LIMIT && !!must;

  return (
    <Screen>
      <TopBar title="모두가 찾아온 곳" subtitle={`${pool.length}곳 중에서 ${LIMIT}곳`} back="/pick" />
      <Body>
        <Notice tone="info">
          <b>{state.members.length}명이 찾아온 {pool.length}곳이에요.</b> 누가 올렸는지는 보이지 않아요.
          이 중에서 내가 가고 싶은 곳을 다시 골라주세요.
        </Notice>

        <div className="flex gap-1.5">
          <button onClick={() => setMode("pick")}
            className={`flex-1 rounded-2xl py-2.5 text-[13px] font-semibold transition ${
              mode === "pick" ? "bg-brand-600 text-white" : "bg-surface text-ink-500"}`}>
            가고 싶은 곳 {picks.length}/{LIMIT}
          </button>
          <button onClick={() => setMode("veto")}
            className={`flex-1 rounded-2xl py-2.5 text-[13px] font-semibold transition ${
              mode === "veto" ? "bg-coral-500 text-white" : "bg-surface text-ink-500"}`}>
            빼고 싶은 곳 {veto ? 1 : 0}/1
          </button>
        </div>

        {picks.length > 0 && (
          <Card className="animate-slideup">
            <SectionTitle hint="하나만 고르세요">꼭 가고 싶은 곳</SectionTitle>
            <p className="mt-1 text-[11.5px] text-ink-500">
              여기 고른 한 곳은 다른 사람과 겹치지 않아도 일정에 꼭 들어가요.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {picks.map((id) => {
                const p = findPlace(id);
                if (!p) return null;
                return (
                  <span key={id}
                    className={`chip flex items-center gap-1.5 transition ${
                      must === id ? "bg-brand-600 text-white" : "bg-surface text-ink-700"}`}>
                    <button onClick={() => setMine({ must: id })}>
                      {must === id && "★ "}{p.name}
                    </button>
                    <button onClick={() => toggle(id)} aria-label={`${p.name} 빼기`} className="opacity-60">×</button>
                  </span>
                );
              })}
            </div>
          </Card>
        )}

        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          <button onClick={() => setCategory(null)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold ${
              category === null ? "bg-ink-900 text-white" : "bg-white text-ink-500"}`}>전체</button>
          {CATEGORIES.map((c) => (
            <button key={c.id} onClick={() => setCategory(c.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold ${
                category === c.id ? "bg-ink-900 text-white" : "bg-white text-ink-500"}`}>
              <Dot category={c.id} size={6} />{c.label}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {list.map((p) => (
            <PlaceRow key={p.id} place={p} votes={votesOf[p.id]}
              picked={picks.includes(p.id)} vetoed={veto === p.id} isMust={must === p.id}
              disabled={mode === "pick" && picks.length >= LIMIT && !picks.includes(p.id)}
              onClick={() => toggle(p.id)} />
          ))}
          {list.length === 0 && (
            <p className="px-1 py-2 text-[12.5px] text-ink-500">이 카테고리에는 아무도 올린 곳이 없어요.</p>
          )}
        </div>
      </Body>
      <Footer>
        <button onClick={() => router.push("/condition")} disabled={!done} className="btn-primary w-full">
          {picks.length < LIMIT
            ? `${LIMIT - picks.length}곳 더 골라주세요`
            : !must ? "꼭 가고 싶은 곳을 골라주세요" : "다음"}
        </button>
      </Footer>
    </Screen>
  );
}
