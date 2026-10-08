"use client";
import { useMemo, useRef, useState } from "react";
import { useTrip } from "@/components/store";
import { AddPlaceForm } from "@/components/PlaceSearch";
import { CATEGORY_MAP, allPlaces } from "@/lib/places";
import { searchPlaces } from "@/lib/search";
import { asset } from "@/components/gachiro";
import type { Place } from "@/lib/types";

/** 디자인의 주소 줄 자리. 데모 장소에는 주소가 없어 지역과 소개를 쓴다 */
export const placeLine = (p: Place) => `${p.area} · ${p.blurb}`;

/**
 * 돋보기 검색창 + 추천 목록 (P3, P8 장소 추가).
 * 돋보기를 누르면 입력창에 커서가 가고 키보드가 올라온다 (피그마 댓글 #11).
 */
export function PlaceFinder({ added, onPick, placeholder = "장소, 주소 검색" }: {
  added: string[];
  onPick: (place: Place) => void;
  placeholder?: string;
}) {
  const { state, addPlace } = useTrip();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pool = useMemo(() => allPlaces(), [state.customPlaces]);
  const results = useMemo(() => searchPlaces(pool, query), [pool, query]);
  // 여행방에서는 서버 장소 목록에 있는 id만 저장된다. 서버 장소 등록이 생기기 전까지 직접 추가를 막는다
  const canAdd = !state.room;

  const pick = (p: Place) => {
    onPick(p);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="relative">
      <div className="flex h-[46px] items-center rounded-[6.795px] border border-line bg-white pl-[23px] pr-[19px]">
        <input ref={input} value={query} placeholder={placeholder} aria-label={placeholder}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setAdding(false); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          className="w-full bg-transparent text-[14px] font-semibold text-black outline-none placeholder:text-mute" />
        <button onClick={() => input.current?.focus()} aria-label="검색" className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset("/ui/search.jpg")} alt="" width={26} height={26} />
        </button>
      </div>

      {open && query.trim() && !adding && (
        // 목록을 누르는 동안 입력창 포커스가 빠지며 목록이 닫히지 않게 한다
        <div onMouseDown={(e) => e.preventDefault()} className="absolute inset-x-0 top-[50px] z-30 max-h-[300px] overflow-y-auto rounded-[6.795px] border border-line bg-white shadow-card">
          {results.map((p) => {
            const done = added.includes(p.id);
            return (
              <button key={p.id} disabled={done} onClick={() => pick(p)}
                className="flex w-full items-center justify-between gap-3 border-b border-line-faint px-4 py-2.5 text-left last:border-0 disabled:opacity-50">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium">{p.name}</span>
                  <span className="block truncate text-[10px] font-medium text-mute-soft">{placeLine(p)}</span>
                </span>
                <span className="shrink-0 text-[12px] font-extrabold text-wine">
                  {done ? "추가됨" : CATEGORY_MAP[p.category].label}
                </span>
              </button>
            );
          })}
          {results.length === 0 && (
            <p className="px-4 py-3 text-[12.5px] text-mute">&quot;{query.trim()}&quot; 검색 결과가 없어요.</p>
          )}
          {canAdd && (
            <button onClick={() => setAdding(true)}
              className="w-full border-t border-line-faint px-4 py-2.5 text-left text-[12.5px] font-bold text-wine">
              찾는 곳이 없나요? 직접 추가하기
            </button>
          )}
        </div>
      )}

      {adding && canAdd && (
        <div className="mt-2">
          <AddPlaceForm initialName={query} initialCategory={null}
            onCancel={() => setAdding(false)}
            onSubmit={(input) => { pick(addPlace(input)); setAdding(false); }} />
        </div>
      )}
    </div>
  );
}
