"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTrip } from "@/components/store";
import { placeLine } from "@/components/PlaceFinder";
import { CATEGORIES, findPlace } from "@/lib/places";
import { Box, NavButtons, Page, PlanHeader, TextTabs, asset } from "@/components/gachiro";
import type { CategoryId, Place } from "@/lib/types";

type Choice = "must" | "veto";

/**
 * P4 — 모두가 찾아온 곳.
 * 카드를 누르면 버건디 테두리로 펼쳐지며 꼭 가기 / 제외 버튼이 나온다 (피그마 댓글 #8).
 * 고르면 다시 접히고 회색이 된다 (#7). 회색 카드를 누르면 다시 펼쳐져 바꿀 수 있다 (10/7 결정).
 * 꼭 가기·제외는 개수 제한이 없다 (10/7 회의). 누가 올린 곳인지는 보여주지 않는다.
 */
export default function Shortlist() {
  const router = useRouter();
  const { state, setMine, setExtra, pool, submissions } = useTrip();
  const { mustList, vetoList } = state.extra;
  const [open, setOpen] = useState<string | null>(null);

  // 서버에서 복원한 입력에는 목록이 없고 picks·veto만 있다. 그때는 거기서 목록을 만든다
  useEffect(() => {
    if (mustList.length || vetoList.length) return;
    const { picks, veto } = state.mine;
    if (picks.length || veto) setExtra({ mustList: picks, vetoList: veto ? [veto] : [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const votesOf = useMemo(() => {
    const m: Record<string, number> = {};
    submissions.forEach((s) => s.longlist.forEach((id) => (m[id] = (m[id] ?? 0) + 1)));
    return m;
  }, [submissions]);

  const places = useMemo(
    () => pool.map((id) => findPlace(id)).filter((p): p is Place => !!p)
      // 여러 사람이 올린 곳을 위로 — 누가 올렸는지는 감춘다
      .sort((a, b) => (votesOf[b.id] ?? 0) - (votesOf[a.id] ?? 0)),
    [pool, votesOf]
  );
  const tabs = CATEGORIES.filter((c) => places.some((p) => p.category === c.id))
    .map((c) => ({ id: c.id, label: c.label }));
  const [tab, setTab] = useState<CategoryId | null>(null);
  const current = tab ?? tabs[0]?.id ?? null;
  const list = places.filter((p) => p.category === current);

  const choiceOf = (id: string): Choice | null =>
    mustList.includes(id) ? "must" : vetoList.includes(id) ? "veto" : null;

  /**
   * 서버·알고리즘은 아직 must·veto를 하나씩만 받는다(#35에서 목록으로 바꾼다).
   * 그때까지 꼭 가기 전체를 picks로, 첫 꼭 가기를 must로, 첫 제외를 veto로 보낸다.
   */
  const choose = (id: string, c: Choice) => {
    const was = choiceOf(id);
    const nextMust = mustList.filter((x) => x !== id);
    const nextVeto = vetoList.filter((x) => x !== id);
    if (was !== c) (c === "must" ? nextMust : nextVeto).push(id);
    setExtra({ mustList: nextMust, vetoList: nextVeto });
    setMine({ picks: nextMust, must: nextMust[0] ?? null, veto: nextVeto[0] ?? null });
    setOpen(null);
  };

  return (
    <Page nav={<NavButtons prev="/pick" next={() => router.push("/budget")} nextDisabled={mustList.length === 0} />}>
      <PlanHeader />
      <div className="pt-[20px]">
        <TextTabs label="카테고리" items={tabs} value={current as CategoryId} onChange={(v) => { setTab(v); setOpen(null); }} />
        <div className="px-5 pt-2">
          <Box className="min-h-[436px] space-y-[9px] px-[11px] py-[16px]">
            {list.map((p) => {
              const c = choiceOf(p.id);
              const expanded = open === p.id;
              if (!expanded) {
                return (
                  <button key={p.id} onClick={() => setOpen(p.id)} aria-expanded={false}
                    className={`flex h-[49px] w-full items-center gap-2 rounded-[20px] border pl-[13px] pr-[14px] text-left ${
                      c ? "border-line bg-line" : "border-line bg-white"}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[17px] font-medium leading-5">{p.name}</span>
                      <span className={`block truncate text-[8px] font-medium leading-3 ${c ? "text-mute-soft" : "text-line"}`}>
                        {placeLine(p)}
                      </span>
                    </span>
                    {c && (
                      <span className="shrink-0 text-[11px] font-bold text-wine">{c === "must" ? "꼭 가기" : "제외"}</span>
                    )}
                  </button>
                );
              }
              return (
                <div key={p.id} className="rounded-[20px] border border-wine bg-white pb-3 pl-[13px] pr-[14px] pt-[9px]">
                  <button onClick={() => setOpen(null)} aria-expanded className="block w-full text-left">
                    <span className="block truncate text-[17px] font-medium leading-5">{p.name}</span>
                    <span className="block truncate text-[9px] font-medium leading-3 text-line">{placeLine(p)}</span>
                  </button>
                  <div className="mt-[6px] flex justify-around">
                    {(["must", "veto"] as Choice[]).map((k) => (
                      <button key={k} onClick={() => choose(p.id, k)} aria-pressed={c === k}
                        className={`flex flex-col items-center gap-[3px] transition ${c && c !== k ? "opacity-40" : ""}`}>
                        <span className="text-[8px] font-bold text-wine">{k === "must" ? "꼭 가기" : "제외"}</span>
                        <span className="flex h-[45px] w-[45px] items-center justify-center rounded-full bg-wine">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={asset("/ui/thumb.png")} alt="" width={29} height={29}
                            className={k === "veto" ? "-scale-y-100" : ""} />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {list.length === 0 && (
              <p className="py-8 text-center text-[12.5px] text-mute">아직 모인 곳이 없어요.</p>
            )}
          </Box>
          <p className="mt-2 text-right text-[12px] font-semibold text-mute">
            꼭 가기 {mustList.length}곳 · 제외 {vetoList.length}곳
          </p>
        </div>
      </div>
    </Page>
  );
}
