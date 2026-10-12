"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * 최종 UI 디자인(피그마 UI P0~P8) 공통 조각.
 * 피그마 프레임은 402px 폭이다. 좌우 여백은 화면마다 14~40px로 달라서 20px로 맞췄다.
 */

/** public/ 파일 경로. GitHub Pages에서는 basePath가 붙는다 */
export const asset = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;

/** 하단 동덕여대 크레딧 — 모든 화면 공통 (높이 62px) */
export function Credit() {
  return (
    <div className="flex h-[62px] shrink-0 items-center justify-between bg-line pl-[9px] pr-[13px]">
      <div className="text-[12.867px] font-bold leading-[1.2] text-wine">
        <p>동덕여자대학교</p>
        <p>
          2026 캡스톤 디자인 <span className="text-black">엄혜인 이조은 권윤진</span>
        </p>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset("/ui/symbol.png")} alt="동덕여자대학교 심볼" width={46} height={39} />
    </div>
  );
}

/** 오른쪽 위 "PLAN", 왼쪽은 화면 제목(있을 때) */
export function PlanHeader({ title }: { title?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between px-5 pt-[58px]">
      <h1 className="text-[26.92px] font-extrabold leading-[34px] text-wine">{title}</h1>
      <span className="text-[26.92px] font-extrabold leading-[34px] text-wine">PLAN</span>
    </div>
  );
}

/** 이전 / 다음 (높이 57px, 반지름 20px) */
export function NavButtons({ prev, next, nextLabel = "다음", nextDisabled, busy }: {
  prev?: string | (() => void);
  next: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  busy?: boolean;
}) {
  const router = useRouter();
  const goPrev = () => {
    if (typeof prev === "function") prev();
    else if (prev) router.push(prev);
    else router.back();
  };
  return (
    <div className="grid shrink-0 grid-cols-2 gap-4 px-5 pb-[15px] pt-3">
      <button onClick={goPrev}
        className="h-[57px] rounded-[20px] bg-line text-[23.929px] font-extrabold text-black transition active:scale-[0.98]">
        이전
      </button>
      <button onClick={next} disabled={nextDisabled || busy}
        className="h-[57px] rounded-[20px] bg-wine text-[23.929px] font-extrabold text-white transition active:scale-[0.98] disabled:opacity-40">
        {busy ? "잠시만요…" : nextLabel}
      </button>
    </div>
  );
}

/** 화면 틀: 내용(스크롤) + 이전/다음 + 크레딧 */
export function Page({ children, nav, className = "" }: {
  children: React.ReactNode;
  nav?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex min-h-[100dvh] flex-col bg-white sm:min-h-[852px] ${className}`}>
      <div className="flex-1">{children}</div>
      {/* 내용이 길어도 이전/다음은 화면 아래에 붙어 있다 */}
      {nav && <div className="sticky bottom-0 z-20 bg-white">{nav}</div>}
      <Credit />
    </div>
  );
}

/** P1·P2 표지 — 오사카 사진 + 아래로 흰색 그라데이션 + OSAKA / PLAN */
export function Hero({ sub }: { sub?: React.ReactNode }) {
  return (
    <div className="relative h-[353px] overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset("/ui/cover.jpg")} alt="오사카 도톤보리의 글리코 간판" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-x-0 bottom-0 top-5 bg-gradient-to-b from-white/0 to-white" />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between px-5 pb-4">
        <div>
          <div className="text-[53.839px] font-extrabold leading-[1.1] text-wine">OSAKA</div>
          {sub && <div className="mt-0.5 text-[17px] font-extrabold text-black">{sub}</div>}
        </div>
        <span className="pb-2 text-[26.92px] font-extrabold leading-[34px] text-wine">PLAN</span>
      </div>
    </div>
  );
}

/**
 * 테두리가 있는 카드. 누르고 있는(포커스가 있는) 동안 테두리가 버건디가 된다 (피그마 댓글 #2).
 */
export function FocusCard({ children, className = "", radius = "rounded-[20px]" }: {
  children: React.ReactNode;
  className?: string;
  radius?: string;
}) {
  return (
    <div className={`border border-line-soft bg-white transition-colors focus-within:border-wine active:border-wine ${radius} ${className}`}>
      {children}
    </div>
  );
}

/** 디자인 슬라이더 (트랙 10px, 버건디 채움) */
export function WineSlider({ value, min, max, step, onChange, left, right, label }: {
  value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
  left?: string; right?: string; label: string;
}) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="range-wine"
        style={{ ["--track" as string]: `linear-gradient(to right,#8b2842 ${fill}%,#d6d6d6 ${fill}%)` }} />
      {(left || right) && (
        <div className="flex justify-between text-[8px] font-medium text-black">
          <span>{left}</span><span>{right}</span>
        </div>
      )}
    </div>
  );
}

/** 위쪽에 잠깐 뜨는 말풍선 */
export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1800);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div role="status" className="animate-toast relative mx-auto mt-2 w-fit rounded-[10px] bg-black/80 px-3 py-1.5 text-[12px] font-semibold text-white">
      <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-black/80" />
      {text}
    </div>
  );
}

/** 아래에서 올라오는 시트 (공항·시간 고르기, 장소 추가) */
export function Sheet({ title, open, onClose, children }: {
  title: string; open: boolean; onClose: () => void; children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="animate-slideup w-full max-w-[402px] rounded-t-[20px] bg-white px-5 pb-6 pt-4">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
        <div className="mb-3 text-[17px] font-extrabold">{title}</div>
        {children}
      </div>
    </div>
  );
}

const ROW = 40;

/**
 * 아이폰 알람 같은 드래그 다이얼 (스크롤 스냅). 가운데 줄이 고른 값이다.
 */
export function Wheel<T extends string | number>({ items, value, onChange, render, label }: {
  items: T[];
  value: T;
  onChange: (v: T) => void;
  render?: (v: T) => React.ReactNode;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 처음 열 때 고른 값으로 스크롤
  useEffect(() => {
    const i = Math.max(0, items.indexOf(value));
    ref.current?.scrollTo({ top: i * ROW });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ROW)));
      if (items[i] !== value) onChange(items[i]);
    }, 90);
  };

  return (
    <div className="relative" style={{ height: ROW * 5 }}>
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-10 -translate-y-1/2 rounded-[10px] bg-wine-50" />
      <div ref={ref} onScroll={onScroll} role="listbox" aria-label={label}
        className="no-scrollbar relative h-full snap-y snap-mandatory overflow-y-scroll"
        style={{ paddingTop: ROW * 2, paddingBottom: ROW * 2 }}>
        {items.map((it, i) => (
          <button key={String(it)} role="option" aria-selected={it === value}
            onClick={() => { ref.current?.scrollTo({ top: i * ROW, behavior: "smooth" }); onChange(it); }}
            className={`flex h-10 w-full snap-center items-center justify-center text-[18px] ${
              it === value ? "font-extrabold text-wine" : "font-medium text-mute-soft"}`}>
            {render ? render(it) : it}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 회색 테두리 상자 (P3·P4·P8 목록, 반지름 6.8px) */
export function Box({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[6.795px] border border-line bg-white ${className}`}>{children}</div>;
}

/** 버건디 원 안 흰 막대 — 빼기 버튼 (지름 25px) */
export function MinusButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label}
      className="flex h-[25px] w-[25px] shrink-0 items-center justify-center rounded-full bg-wine active:scale-95">
      <span className="block h-[2px] w-3 bg-white" />
    </button>
  );
}

/** 카테고리처럼 큰 글씨로 고르는 탭 (선택 25px 버건디, 나머지 20px 회색) */
export function TextTabs<T extends string | number>({ items, value, onChange, label }: {
  items: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="no-scrollbar flex items-baseline gap-2 overflow-x-auto px-5">
      {items.map((it) => (
        <button key={String(it.id)} role="tab" aria-selected={it.id === value} onClick={() => onChange(it.id)}
          className={`shrink-0 font-extrabold leading-[25px] transition-all ${
            it.id === value ? "text-[25px] text-wine" : "text-[20px] text-line"}`}>
          {it.label}
        </button>
      ))}
    </div>
  );
}
