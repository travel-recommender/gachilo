"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTrip } from "@/components/store";
import { PlaceFinder, placeLine } from "@/components/PlaceFinder";
import { PlanMap } from "@/components/PlanMap";
import { CATEGORY_MAP, findPlace } from "@/lib/places";
import { explainPlace } from "@/lib/explain";
import { badgeOf } from "@/lib/shared-flow";
import { selectedCandidate } from "@/lib/shared-results-api";
import { useSharedResults } from "@/components/useSharedResults";
import { Box, MinusButton, NavButtons, Page, PlanHeader, Sheet, TextTabs, asset } from "@/components/gachiro";
import type { Place } from "@/lib/types";

/** 목록 한 줄 높이 — 꾹 눌러 끌 때 몇 칸 움직였는지 이 값으로 센다 */
const ROW_H = 58;
const HOLD_MS = 450;

/** 아무도 고르지 않았는데 들어간 곳의 표시. 규칙으로 채운 곳은 "AI 추천"이라 하지 않는다 */
type Badge = { label: "AI 추천" | "추천"; reason: string };

/**
 * P8 — 일정과 동선.
 * - 여행방: 방장이 확정한 서버 후보의 일정을 전원이 똑같이 본다. 기기마다 고치면 다시 달라지므로
 *   공용 편집 API가 생기기 전까지 삭제·추가·순서 변경을 잠근다 (docs/week6_shared_results_api.md).
 * - 데모(서버 없음): 버건디 버튼으로 삭제(#15), 꾹 눌러 순서 변경(#16), 장소 추가(#17).
 *   확정하면 같은 화면을 빼기 버튼 없이 보여준다 (10/7 결정).
 */
export default function Plan() {
  const router = useRouter();
  const { state, setExtra, schedule, consensus } = useTrip();
  const shared = useSharedResults();
  const online = shared.online;
  const final = shared.snap ? selectedCandidate(shared.snap) : null;
  const { planEdits } = state.extra;
  // 공용 결과는 방장 확정이 곧 확정이다. 편집은 잠근다
  const confirmed = online ? true : state.extra.confirmed;
  const days = online ? final?.days.length ?? 0 : state.nights + 1;
  const [day, setDay] = useState(1);
  const [adding, setAdding] = useState(false);

  const badges: Record<string, Badge> = {};
  let ids: string[];
  if (online) {
    const items = final?.days[day - 1]?.items ?? [];
    ids = items.map((it) => it.placeId);
    items.forEach((it) => {
      const label = badgeOf(it);
      if (label) badges[it.placeId] = { label, reason: it.reason ?? "모두의 조건에 맞아 넣은 곳이에요." };
    });
  } else {
    const base = schedule.plans.find((p) => p.day === day)?.items.map((it) => it.place.id) ?? [];
    ids = planEdits[day] ?? base;
    // 이 기기 계산은 규칙 기반이다 — 합의 단계 보완(aiAdded)과 빈 식사 시간 보완(filled)
    consensus.selections.filter((x) => x.aiAdded).forEach((x) => {
      badges[x.place.id] = { label: "추천", reason: explainPlace(consensus, x.place.id) ?? "모두의 조건에 맞아 넣은 곳이에요." };
    });
    schedule.plans.flatMap((p) => p.items).filter((it) => it.tier === "filled").forEach((it) => {
      badges[it.place.id] ??= { label: "추천", reason: "비어 있던 식사 시간에 동선에서 가장 가까운 곳을 넣었어요." };
    });
  }
  const places = ids.map((id) => findPlace(id)).filter((p): p is Place => !!p);
  const save = (next: string[]) => setExtra({ planEdits: { ...planEdits, [day]: next } });

  if (online && !final) {
    return (
      <Page nav={<NavButtons prev="/result" next={() => router.push("/result")} nextLabel="후보 보기" />}>
        <PlanHeader />
        <div className="px-5 pt-[60px]">
          <p className="text-[14px] font-semibold leading-relaxed">
            {shared.snap ? "아직 방장이 일정을 확정하지 않았어요." : "공용 결과를 불러오는 중이에요."}
          </p>
          <p className="mt-2 text-[12px] font-medium leading-relaxed text-mute">
            방장이 후보 3개 중 하나를 확정하면, 모두가 같은 일정을 여기서 봐요.
          </p>
          {shared.error && <p className="mt-3 text-[12px] text-wine">{shared.error}</p>}
        </div>
      </Page>
    );
  }

  return (
    <Page nav={
      <NavButtons prev="/result"
        next={() => setExtra({ confirmed: !confirmed })}
        nextLabel={online ? "확정됨" : confirmed ? "수정하기" : "확정하기"} nextDisabled={online} />
    }>
      <PlanHeader />
      <div className="pt-[20px]">
        <TextTabs label="여행 날짜" value={day} onChange={setDay}
          items={Array.from({ length: days }, (_, i) => ({ id: i + 1, label: `${i + 1}일차` }))} />
        <div className="px-5 pt-[20px]">
          <PlanMap day={day} places={places} />

          <div className="flex h-[38px] items-center justify-between">
            {confirmed
              ? <span className="text-[13px] font-extrabold text-wine">
                  {online ? "방장이 확정한 일정이에요. 모두 같은 일정을 봐요." : "확정된 일정이에요"}
                </span>
              : <span />}
            {!confirmed && (
              <button onClick={() => setAdding(true)}
                className="h-[28px] rounded-[20px] bg-wine px-[10px] text-[14px] font-semibold text-white">
                장소 추가
              </button>
            )}
          </div>

          <Box className="h-[261px] overflow-hidden">
            <Reorder places={places} locked={confirmed} badges={badges}
              onMove={(from, to) => {
                const next = [...ids];
                const [m] = next.splice(from, 1);
                next.splice(to, 0, m);
                save(next);
              }}
              onRemove={(id) => save(ids.filter((x) => x !== id))} />
          </Box>
          {!confirmed && places.length > 1 && (
            <p className="mt-2 text-right text-[11px] font-medium text-mute-soft">한 칸을 꾹 누르면 순서를 바꿀 수 있어요</p>
          )}
        </div>
      </div>

      <Sheet title={`${day}일차에 장소 추가`} open={adding} onClose={() => setAdding(false)}>
        <div className="min-h-[300px]">
          <PlaceFinder added={ids} onPick={(p) => { save([...ids, p.id]); setAdding(false); }} />
        </div>
      </Sheet>
    </Page>
  );
}

/** 번호 핀 (지름 44px, 흰 점 아래 번호) */
function Pin({ n }: { n: number }) {
  return (
    <span className="relative block h-[44px] w-[44px] shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset("/ui/pin.png")} alt="" width={44} height={44} />
      <span className="absolute inset-x-0 top-[22px] text-center text-[10.645px] font-extrabold leading-none text-white">{n}</span>
    </span>
  );
}

/** 꾹 눌러 끌어서 순서를 바꾸는 목록 */
function Reorder({ places, locked, badges, onMove, onRemove }: {
  places: Place[];
  badges: Record<string, Badge>;
  locked: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: (id: string) => void;
}) {
  const box = useRef<HTMLUListElement>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef(0);
  const [drag, setDrag] = useState<{ i: number; dy: number } | null>(null);
  const dragging = useRef(false);

  // 끄는 동안 목록이 같이 스크롤되지 않게 터치 이동을 막는다 (passive가 아니어야 막힌다)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const stop = (e: TouchEvent) => { if (dragging.current) e.preventDefault(); };
    el.addEventListener("touchmove", stop, { passive: false });
    return () => el.removeEventListener("touchmove", stop);
  }, []);

  const cancelHold = () => { if (hold.current) clearTimeout(hold.current); hold.current = null; };
  const target = drag ? Math.max(0, Math.min(places.length - 1, drag.i + Math.round(drag.dy / ROW_H))) : -1;

  const shiftOf = (k: number) => {
    if (!drag || k === drag.i) return 0;
    if (drag.i < target && k > drag.i && k <= target) return -ROW_H;
    if (drag.i > target && k < drag.i && k >= target) return ROW_H;
    return 0;
  };

  if (places.length === 0) {
    return <p className="px-4 py-10 text-center text-[12.5px] text-mute">이 날은 아직 장소가 없어요.</p>;
  }

  return (
    <ul ref={box} className="thin-scroll h-full overflow-y-auto py-[11px] pl-[6px] pr-[3px]">
      {places.map((p, k) => {
        const isDrag = drag?.i === k;
        return (
          <li key={p.id}
            onPointerDown={(e) => {
              if (locked || (e.target as HTMLElement).closest("button")) return;
              start.current = e.clientY;
              const el = e.currentTarget;
              const id = e.pointerId;
              hold.current = setTimeout(() => {
                dragging.current = true;
                try { el.setPointerCapture(id); } catch { /* 이미 끝난 포인터 */ }
                navigator.vibrate?.(10);
                setDrag({ i: k, dy: 0 });
              }, HOLD_MS);
            }}
            onPointerMove={(e) => {
              const dy = e.clientY - start.current;
              if (!dragging.current) { if (Math.abs(dy) > 8) cancelHold(); return; }
              setDrag((d) => (d ? { ...d, dy } : d));
            }}
            onPointerUp={() => {
              cancelHold();
              if (dragging.current && drag && target !== drag.i) onMove(drag.i, target);
              dragging.current = false;
              setDrag(null);
            }}
            onPointerCancel={() => { cancelHold(); dragging.current = false; setDrag(null); }}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              transform: `translateY(${isDrag ? drag!.dy : shiftOf(k)}px)`,
              transition: isDrag ? "none" : "transform .15s ease",
            }}
            className={`relative flex h-[58px] select-none items-center gap-[4px] border-b border-line pr-[17px] last:border-0 ${
              isDrag ? "z-10 rounded-[10px] bg-white shadow-card" : "bg-white"}`}>
            <Pin n={k + 1} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-[6px] text-[14px] leading-4">
                <span className="truncate font-semibold">{p.name}</span>
                <span className="shrink-0 font-extrabold text-wine">{CATEGORY_MAP[p.category].label}</span>
                {badges[p.id] && (
                  <span className="shrink-0 rounded-[20px] bg-line-faint px-[7px] py-[2px] text-[10px] font-bold leading-3 text-wine">{badges[p.id].label}</span>
                )}
              </div>
              {/* AI 추천이면 주소 줄 대신 왜 넣었는지를 쓴다 */}
              <div className={`mt-[3px] truncate leading-3 ${badges[p.id] ? "text-[9px] font-semibold text-wine" : "text-[8px] font-medium text-line"}`}>
                {badges[p.id]?.reason ?? placeLine(p)}
              </div>
            </div>
            {!locked && <MinusButton label={`${p.name} 빼기`} onClick={() => onRemove(p.id)} />}
          </li>
        );
      })}
    </ul>
  );
}
