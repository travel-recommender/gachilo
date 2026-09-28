"use client";
import { useRouter } from "next/navigation";
import { useTrip } from "@/components/store";
import { PlaceSearch } from "@/components/PlaceSearch";
import { findPlace } from "@/lib/places";
import { Body, Card, Footer, Notice, Screen, SectionTitle, TopBar } from "@/components/ui";
import type { Place } from "@/lib/types";

const LIMIT = 5;

/**
 * 1차 — 아무 목록 없이, 검색으로 내가 가고 싶은 5곳을 찾는다.
 * 여기서는 '꼭'도 '빼고 싶은 곳'도 고르지 않는다. 그건 모두의 후보가 모인 다음이다.
 */
export default function Pick() {
  const router = useRouter();
  const { state, setMine } = useTrip();
  const longlist = state.mine.longlist;

  const toggle = (id: string) => {
    if (longlist.includes(id)) setMine({ longlist: longlist.filter((p) => p !== id) });
    else if (longlist.length < LIMIT) setMine({ longlist: [...longlist, id] });
  };

  const onAdded = (place: Place) => {
    if (longlist.length < LIMIT) setMine({ longlist: [...longlist, place.id] });
  };

  const done = longlist.length === LIMIT;

  return (
    <Screen>
      <TopBar title="가고 싶은 곳 찾기" subtitle={`검색해서 ${LIMIT}곳`} back="/" />
      <Body>
        <Notice tone="info">
          <b>다른 사람에게 보이지 않아요.</b> 남이 뭘 골랐는지도 아직 안 보여요.
          지금은 내가 가고 싶은 곳만 생각하세요.
        </Notice>

        <PlaceSearch selected={longlist} onToggle={toggle} onAdded={onAdded}
          disabledAdd={longlist.length >= LIMIT} />

        {longlist.length > 0 && (
          <Card className="animate-slideup">
            <SectionTitle hint={`${longlist.length}/${LIMIT}`}>내가 찾은 곳</SectionTitle>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {longlist.map((id) => {
                const p = findPlace(id);
                if (!p) return null;
                return (
                  <span key={id} className="chip flex items-center gap-1.5 bg-surface text-ink-700">
                    {p.name}
                    <button onClick={() => toggle(id)} aria-label={`${p.name} 빼기`} className="opacity-60">×</button>
                  </span>
                );
              })}
            </div>
          </Card>
        )}
      </Body>
      <Footer>
        <button onClick={() => router.push("/waiting")} disabled={!done} className="btn-primary w-full">
          {done ? "다 골랐어요" : `${LIMIT - longlist.length}곳 더 찾아주세요`}
        </button>
      </Footer>
    </Screen>
  );
}
