"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { vetoFields } from "@/lib/room-state";
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
  const { state, catalog, setMine, setExtra, pool, fetchPool } = useTrip();
  const { mustList, vetoList } = state.extra;
  const [open, setOpen] = useState<string | null>(null);
  const poolKey = state.room ? JSON.stringify([state.room.roomId, state.room.memberId, state.room.token, state.room.ownerToken]) : null;
  const [poolLoad, setPoolLoad] = useState<{ key: string; status: "loading" | "ready" | "error"; error?: string } | null>(null);
  const [poolRetry, setPoolRetry] = useState(0);
  const poolBlocked = poolKey !== null && (poolLoad?.key !== poolKey || poolLoad.status !== "ready");
  const poolError = poolLoad?.key === poolKey && poolLoad.status === "error" ? poolLoad.error : null;

  // 복원한 입력에서 목록을 만든다. 옛 입력은 단일 veto로 되살린다
  useEffect(() => {
    if (mustList.length || vetoList.length) return;
    const { picks, veto, vetoes } = state.mine;
    if (picks.length || veto || vetoes?.length) setExtra({ mustList: picks, vetoList: vetoes ?? (veto ? [veto] : []) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 서버 방이면 들어올 때 모두의 목록을 다시 받는다 (기다리는 화면을 건너뛰고 들어온 경우 등)
  useEffect(() => {
    if (!poolKey) return;
    let live = true;
    setPoolLoad({ key: poolKey, status: "loading" });
    fetchPool().then((got) => {
      if (!live) return;
      if (!got || got.roomId !== state.room?.roomId) throw new Error("모인 장소 목록을 확인하지 못했어요. 다시 불러와 주세요.");
      setPoolLoad({ key: poolKey, status: "ready" });
    }).catch((error) => {
      if (live) setPoolLoad({ key: poolKey, status: "error", error: error instanceof Error ? error.message : "모인 장소 목록을 확인하지 못했어요. 다시 불러와 주세요." });
    });
    return () => { live = false; };
    // fetchPool은 렌더마다 새 함수다. 방/참여자/토큰 또는 명시적 재시도에만 다시 조회한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolKey, poolRetry]);

  // pool은 여러 사람이 올린 곳부터 온다 — 누가 올렸는지는 감춘다
  const places = useMemo(
    () => poolBlocked ? [] : pool.map((id) => findPlace(id)).filter((p): p is Place => !!p),
    // catalog: 150곳 목록이 늦게 오면 그때 다시 찾는다
    [pool, catalog, poolBlocked]
  );
  const tabs = CATEGORIES.filter((c) => places.some((p) => p.category === c.id))
    .map((c) => ({ id: c.id, label: c.label }));
  const [tab, setTab] = useState<CategoryId | null>(null);
  const current = tab ?? tabs[0]?.id ?? null;
  const list = places.filter((p) => p.category === current);

  const choiceOf = (id: string): Choice | null =>
    mustList.includes(id) ? "must" : vetoList.includes(id) ? "veto" : null;

  /**
   * 전체 제외 목록은 vetoes로 보내고, veto는 이전 입력과의 호환용으로 유지한다.
   */
  const choose = (id: string, c: Choice) => {
    if (poolBlocked) return;
    const was = choiceOf(id);
    const nextMust = mustList.filter((x) => x !== id);
    const nextVeto = vetoList.filter((x) => x !== id);
    if (was !== c) (c === "must" ? nextMust : nextVeto).push(id);
    setExtra({ mustList: nextMust, vetoList: nextVeto });
    setMine({ picks: nextMust, must: nextMust[0] ?? null, ...vetoFields(nextVeto) });
    setOpen(null);
  };

  return (
    <Page nav={<NavButtons prev="/pick" next={() => router.push("/budget")} nextDisabled={poolBlocked || mustList.length === 0} />}>
      <PlanHeader />
      <div className="pt-[20px]">
        <TextTabs label="카테고리" items={tabs} value={current as CategoryId} onChange={(v) => { setTab(v); setOpen(null); }} />
        <div className="px-5 pt-2">
          <Box className="min-h-[436px] space-y-[9px] px-[11px] py-[16px]">
            {poolBlocked && (poolError ? (
              <div role="alert" className="space-y-3 rounded-[12px] bg-wine-50 px-3 py-4 text-[13px] leading-relaxed text-wine">
                <p>{poolError}</p>
                <p>목록을 확인한 뒤 선택을 이어갈 수 있어요. 앞에서 고른 내용은 유지돼요.</p>
                <button onClick={() => { setPoolLoad(null); setOpen(null); setPoolRetry((n) => n + 1); }}
                  className="font-bold underline">목록 다시 불러오기</button>
              </div>
            ) : <p role="status" className="py-8 text-center text-[13px] text-mute">모두의 장소 목록을 불러오는 중이에요.</p>)}
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
            {!poolBlocked && list.length === 0 && (
              <p className="py-8 text-center text-[12.5px] text-mute">아직 모인 곳이 없어요.</p>
            )}
          </Box>
          {!poolBlocked && <p className="mt-2 text-right text-[12px] font-semibold text-mute">
            꼭 가기 {mustList.length}곳 · 제외 {vetoList.length}곳
          </p>}
        </div>
      </div>
    </Page>
  );
}
