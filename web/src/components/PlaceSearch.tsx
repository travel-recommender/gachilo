"use client";
import { useMemo, useRef, useState } from "react";
import { useTrip } from "@/components/store";
import { AREAS, CATEGORIES, CATEGORY_MAP, allPlaces } from "@/lib/places";
import { Card, Dot, SectionTitle, won } from "@/components/ui";
import type { CategoryId, Place } from "@/lib/types";

/** 이름·지역·카테고리·소개문 어디든 걸리면 결과로 본다 */
function match(p: Place, q: string) {
  const hay = `${p.name} ${p.area} ${CATEGORY_MAP[p.category].label} ${p.blurb}`.toLowerCase();
  return hay.includes(q.trim().toLowerCase());
}

/**
 * 검색으로 장소를 찾고, 없으면 직접 추가하는 화면 조각.
 * 1차(허허벌판에서 찾기)에서 쓰고, 2차에서는 후보 풀만 보므로 쓰지 않는다.
 */
export function PlaceSearch({ selected, onToggle, onAdded, disabledAdd }: {
  selected: string[];
  onToggle: (id: string) => void;
  onAdded: (place: Place) => void;
  /** 더 고를 수 없는 상태 (정원이 찼다) */
  disabledAdd: boolean;
}) {
  const { state, addPlace } = useTrip();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pool = useMemo(() => allPlaces(), [state.customPlaces]);

  const results = useMemo(() => {
    const q = query.trim();
    // 검색어도 카테고리도 없으면 아무것도 보여주지 않는다 — 목록을 훑는 화면이 아니다
    if (!q && !category) return [];
    let list = pool;
    if (category) list = list.filter((p) => p.category === category);
    if (q) list = list.filter((p) => match(p, q));
    return list;
  }, [pool, query, category]);

  const searched = query.trim().length > 0 || category !== null;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 rounded-2xl border border-black/5 bg-white px-4 py-3 shadow-sm">
        <span aria-hidden>🔍</span>
        <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="가고 싶은 곳을 검색해보세요"
          className="w-full bg-transparent text-[13.5px] outline-none placeholder:text-ink-300" />
        {query && <button onClick={() => setQuery("")} aria-label="지우기" className="text-ink-300">×</button>}
      </div>

      {/* 카테고리 — 뭘 검색할지 모를 때 여기서 고른다 */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {CATEGORIES.map((c) => (
          <button key={c.id} onClick={() => setCategory(category === c.id ? null : c.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold ${
              category === c.id ? "bg-ink-900 text-white" : "bg-white text-ink-500"}`}>
            <Dot category={c.id} size={6} />{c.label}
          </button>
        ))}
      </div>

      {adding ? (
        <AddPlaceForm
          initialName={query}
          initialCategory={category}
          onCancel={() => setAdding(false)}
          onSubmit={(input) => {
            onAdded(addPlace(input));
            setAdding(false);
            setQuery("");
            setCategory(null);
          }}
        />
      ) : (
        <>
          {!searched && (
            <div className="rounded-2xl border border-dashed border-black/10 px-4 py-8 text-center">
              <p className="text-[13px] font-semibold text-ink-700">아직 아무것도 없어요</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">
                가고 싶은 곳을 검색하거나 위 카테고리를 눌러보세요.
                <br />
                목록에 없으면 직접 추가할 수 있어요.
              </p>
            </div>
          )}

          <div className="space-y-2">
            {results.map((p) => (
              <PlaceRow key={p.id} place={p} picked={selected.includes(p.id)}
                disabled={disabledAdd && !selected.includes(p.id)}
                onClick={() => onToggle(p.id)} />
            ))}
          </div>

          {searched && results.length === 0 && (
            <p className="px-1 py-2 text-[12.5px] text-ink-500">
              {query ? `"${query.trim()}" 검색 결과가 없어요.` : "이 카테고리에 장소가 없어요."}
            </p>
          )}

          <button onClick={() => setAdding(true)}
            className="w-full rounded-2xl border border-dashed border-brand-500/60 bg-brand-50/40 px-4 py-3 text-[13px] font-semibold text-brand-600">
            {query.trim() ? `"${query.trim()}" 직접 추가하기` : "찾는 곳이 없나요? 직접 추가하기"}
          </button>
        </>
      )}
    </div>
  );
}

export function PlaceRow({ place: p, picked, vetoed, isMust, disabled, votes, onClick }: {
  place: Place;
  picked: boolean;
  vetoed?: boolean;
  isMust?: boolean;
  disabled?: boolean;
  /** 몇 명이 후보로 올렸는가 (2차 화면에서만) */
  votes?: number;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} disabled={disabled} className="w-full text-left disabled:opacity-45">
      <Card className={`transition ${
        vetoed ? "border-2 border-coral-500 bg-coral-50/40"
        : picked ? "border-2 border-brand-500" : "border-2 border-transparent hover:bg-surface"}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {isMust && <span className="text-brand-600">★</span>}
              <span className="truncate text-[14px] font-bold">{p.name}</span>
              {p.custom && <span className="chip bg-brand-50 text-brand-600">직접 추가</span>}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-500">
              <Dot category={p.category} size={6} />
              {p.area} · {p.stayMin}분
              {p.covered && <span className="chip bg-surface text-ink-500">실내</span>}
              {votes !== undefined && votes > 1 && (
                <span className="chip bg-surface text-ink-500">{votes}명이 올림</span>
              )}
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">{p.blurb}</p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[12px] font-semibold tabular-nums">{p.cost ? won(p.cost) : "무료"}</div>
            {vetoed && <div className="mt-1 text-[10.5px] font-bold text-coral-500">제외</div>}
          </div>
        </div>
      </Card>
    </button>
  );
}

function AddPlaceForm({ initialName, initialCategory, onCancel, onSubmit }: {
  initialName: string;
  initialCategory: CategoryId | null;
  onCancel: () => void;
  onSubmit: (input: { name: string; category: CategoryId; area: string; cost?: number; stayMin?: number }) => void;
}) {
  const [name, setName] = useState(initialName.trim());
  const [category, setCategory] = useState<CategoryId>(initialCategory ?? "landmark");
  const [area, setArea] = useState(AREAS[0]);
  const [cost, setCost] = useState("");
  const [stayMin, setStayMin] = useState("");

  const valid = name.trim().length > 0;
  const field = "w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-[13px] outline-none focus:border-brand-500";

  return (
    <Card className="animate-slideup space-y-3">
      <SectionTitle hint="비워두면 평균값">장소 직접 추가</SectionTitle>
      <p className="text-[11.5px] leading-relaxed text-ink-500">
        위치는 고른 지역의 중심으로 잡혀요. 동선·이동 시간은 대략값으로 계산됩니다.
      </p>

      <label className="block space-y-1">
        <span className="text-[11.5px] font-semibold text-ink-500">이름</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예) 신세카이 츠텐카쿠" className={field} />
      </label>

      <div className="space-y-1">
        <span className="text-[11.5px] font-semibold text-ink-500">카테고리</span>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button key={c.id} onClick={() => setCategory(c.id)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold ${
                category === c.id ? "bg-ink-900 text-white" : "bg-surface text-ink-500"}`}>
              <Dot category={c.id} size={6} />{c.label}
            </button>
          ))}
        </div>
      </div>

      <label className="block space-y-1">
        <span className="text-[11.5px] font-semibold text-ink-500">지역</span>
        <select value={area} onChange={(e) => setArea(e.target.value)} className={field}>
          {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>

      <div className="flex gap-2">
        <label className="block flex-1 space-y-1">
          <span className="text-[11.5px] font-semibold text-ink-500">1인 예상 비용(원)</span>
          <input value={cost} onChange={(e) => setCost(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric" placeholder="예) 12000" className={field} />
        </label>
        <label className="block flex-1 space-y-1">
          <span className="text-[11.5px] font-semibold text-ink-500">머무는 시간(분)</span>
          <input value={stayMin} onChange={(e) => setStayMin(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric" placeholder="예) 60" className={field} />
        </label>
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} className="flex-1 rounded-2xl bg-surface py-2.5 text-[13px] font-semibold text-ink-500">
          취소
        </button>
        <button disabled={!valid}
          onClick={() => onSubmit({
            name, category, area,
            cost: cost ? Number(cost) : undefined,
            stayMin: stayMin ? Number(stayMin) : undefined,
          })}
          className="btn-primary flex-1 disabled:opacity-40">
          추가하고 선택
        </button>
      </div>
    </Card>
  );
}
