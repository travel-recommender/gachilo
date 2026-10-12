"use client";
import { useEffect, useRef, useState } from "react";
import { MAPS_KEY, newSession, searchAddress, type AddressHit } from "@/lib/gmaps";
import { asset } from "@/components/gachiro";
import type { Lodging } from "@/components/store";

/**
 * 숙소 위치 검색. 실제 주소나 호텔 이름을 치면 구글 장소 자동완성이 뜨고,
 * 고르면 좌표까지 저장한다 (숙소에서 출발하는 거리 계산용, #35).
 * 지도 키가 없거나 검색이 실패하면 적은 글자만 주소로 저장한다.
 */
export function LodgingSearch({ value, onChange, label }: {
  value: Lodging | undefined;
  onChange: (v: Lodging) => void;
  label: string;
}) {
  const [query, setQuery] = useState(value?.address.split(" · ")[0] ?? "");
  const [hits, setHits] = useState<AddressHit[]>([]);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const session = useRef<unknown>(null);
  const input = useRef<HTMLInputElement>(null);

  // 저장된 숙소는 화면이 뜬 뒤에 복원된다. 입력 중이 아닐 때만 저장값으로 맞춘다
  useEffect(() => {
    if (!open && value?.address) setQuery(value.address.split(" · ")[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.address]);

  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2 || !MAPS_KEY) { setHits([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        session.current ??= await newSession();
        const found = await searchAddress(q, session.current);
        if (live) { setHits(found); setNote(null); }
      } catch {
        if (live) { setHits([]); setNote("주소 검색을 쓸 수 없어 적은 글자 그대로 저장해요."); }
      }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [query, open]);

  const pick = async (h: AddressHit) => {
    setOpen(false);
    try {
      const r = await h.resolve();
      setQuery(h.main);
      onChange(r);
    } catch {
      setQuery(h.main);
      onChange({ address: [h.main, h.sub].filter(Boolean).join(" · ") });
    }
    session.current = null; // 한 번 고르면 검색 세션을 닫는다
  };

  return (
    <div className="relative">
      <div className="flex h-[46px] items-center rounded-[6.795px] border border-line bg-white pl-[23px] pr-[19px]">
        <input ref={input} value={query} aria-label={label} placeholder="숙소 위치 검색"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); onChange({ address: e.target.value }); }}
          onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
          className="w-full bg-transparent text-[14px] font-semibold text-black outline-none placeholder:text-mute" />
        {value?.lat !== undefined && <span className="mr-2 shrink-0 text-[11px] font-bold text-wine">위치 확인</span>}
        <button onClick={() => input.current?.focus()} aria-label={`${label} 검색`} className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset("/ui/search.jpg")} alt="" width={26} height={26} />
        </button>
      </div>
      {open && hits.length > 0 && (
        <div onMouseDown={(e) => e.preventDefault()}
          className="absolute inset-x-0 top-[50px] z-30 overflow-hidden rounded-[6.795px] border border-line bg-white shadow-card">
          {hits.map((h, i) => (
            <button key={i} onClick={() => pick(h)}
              className="block w-full border-b border-line-faint px-4 py-2 text-left last:border-0">
              <span className="block truncate text-[14px] font-semibold">{h.main}</span>
              <span className="block truncate text-[10.5px] font-medium text-mute-soft">{h.sub}</span>
            </button>
          ))}
        </div>
      )}
      {note && <p className="mt-1 text-[11px] text-mute">{note}</p>}
    </div>
  );
}
