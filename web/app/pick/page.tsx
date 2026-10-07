"use client";
import { useRouter } from "next/navigation";
import { useTrip } from "@/components/store";
import { PlaceFinder, placeLine } from "@/components/PlaceFinder";
import { CATEGORIES, findPlace } from "@/lib/places";
import { Box, MinusButton, NavButtons, Page, PlanHeader } from "@/components/gachiro";
import type { Place } from "@/lib/types";

/** 서버가 받는 1차 목록 최대 개수 */
const LIMIT = 30;

/**
 * P3 — 가고 싶은 곳 찾기.
 * 검색으로 찾아 My list에 담는다. 아직 남의 목록은 보이지 않는다.
 */
export default function Pick() {
  const router = useRouter();
  const { state, setMine } = useTrip();
  const longlist = state.mine.longlist;
  const places = longlist.map((id) => findPlace(id)).filter((p): p is Place => !!p);

  const add = (p: Place) => {
    if (!longlist.includes(p.id) && longlist.length < LIMIT) setMine({ longlist: [...longlist, p.id] });
  };
  const remove = (id: string) => setMine({ longlist: longlist.filter((x) => x !== id) });

  const groups = CATEGORIES
    .map((c) => ({ c, items: places.filter((p) => p.category === c.id) }))
    .filter((g) => g.items.length > 0);

  return (
    <Page nav={<NavButtons next={() => router.push("/waiting")} nextDisabled={longlist.length === 0} />}>
      <PlanHeader />
      <div className="px-5 pt-[59px]">
        <PlaceFinder added={longlist} onPick={add} />

        <h2 className="mb-[15px] mt-[43px] text-[23.929px] font-extrabold leading-[29px]">My list</h2>
        <Box className="min-h-[349px] px-[10px] pb-4 pt-[10px]">
          {groups.length === 0 && (
            <p className="px-2 py-8 text-center text-[12.5px] font-medium leading-relaxed text-mute">
              위에서 가고 싶은 곳을 검색해 담아 주세요.
              <br />
              다른 사람에게는 보이지 않아요.
            </p>
          )}
          {groups.map(({ c, items }) => (
            <section key={c.id} className="mb-[15px] last:mb-0">
              <h3 className="mb-2 pl-[3px] text-[17px] font-extrabold leading-5 text-wine">{c.label}</h3>
              <ul className="space-y-[7px]">
                {items.map((p) => (
                  <li key={p.id}
                    className="flex h-[49px] items-center gap-2 rounded-[20px] border border-line pl-[13px] pr-[11px]">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[16.801px] font-medium leading-5">{p.name}</div>
                      <div className="truncate text-[9px] font-medium leading-3 text-line">{placeLine(p)}</div>
                    </div>
                    <MinusButton label={`${p.name} 빼기`} onClick={() => remove(p.id)} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </Box>
      </div>
    </Page>
  );
}
