"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CATEGORY_MAP } from "@/lib/places";
import type { CategoryId } from "@/lib/types";

export const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
export const wonShort = (n: number) => {
  const v = Math.round(n);
  if (Math.abs(v) >= 10000) { const m = v / 10000; return `${m % 1 === 0 ? m : m.toFixed(1)}만원`; }
  return `${v.toLocaleString("ko-KR")}원`;
};
export const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;

export function Screen({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex min-h-[760px] flex-col ${className}`}>{children}</div>;
}

export function TopBar({ title, subtitle, back, right }:
  { title: string; subtitle?: string; back?: string; right?: React.ReactNode }) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-black/5 bg-white/95 px-5 pb-3 pt-9 backdrop-blur">
      {back && (
        <button onClick={() => router.push(back)} aria-label="뒤로"
          className="-ml-1 flex h-8 w-8 items-center justify-center rounded-full text-ink-500 hover:bg-surface">←</button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[17px] font-bold leading-tight">{title}</h1>
        {subtitle && <p className="truncate text-[12px] text-ink-500">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

export function Body({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex-1 space-y-4 px-5 py-5 ${className}`}>{children}</div>;
}

export function Footer({ children }: { children: React.ReactNode }) {
  return <div className="sticky bottom-0 z-20 border-t border-black/5 bg-white/95 px-5 pb-6 pt-3 backdrop-blur">{children}</div>;
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`card p-4 ${className}`}>{children}</div>;
}

export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-end justify-between px-0.5">
      <h2 className="text-[15px] font-bold">{children}</h2>
      {hint && <span className="text-[11px] text-ink-300">{hint}</span>}
    </div>
  );
}

export function Notice({ tone = "info", children }:
  { tone?: "info" | "warn" | "ok" | "danger"; children: React.ReactNode }) {
  const tones = {
    info: "bg-brand-50 text-brand-700", warn: "bg-amber-50 text-amber-700",
    ok: "bg-emerald-50 text-emerald-700", danger: "bg-red-50 text-red-600",
  };
  return <div className={`rounded-2xl px-3.5 py-3 text-[12.5px] leading-relaxed ${tones[tone]}`}>{children}</div>;
}

export function Dot({ category, size = 8 }: { category: CategoryId; size?: number }) {
  return <span aria-hidden className="inline-block shrink-0 rounded-full"
    style={{ width: size, height: size, background: CATEGORY_MAP[category].color }} />;
}

export function Avatar({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, background: color, fontSize: size * 0.4 }}>
      {name.slice(-2)}
    </span>
  );
}

export function Slider({ value, min, max, step, onChange, left, right }:
  { value: number; min: number; max: number; step: number; onChange: (v: number) => void; left: string; right: string }) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="range"
        style={{ ["--track" as string]: `linear-gradient(to right,#2f45e0 ${fill}%,#eceef5 ${fill}%)` }} />
      <div className="flex justify-between text-[10.5px] text-ink-300">
        <span>{left}</span><span>{right}</span>
      </div>
    </div>
  );
}

export function LinkButton({ href, children, variant = "primary" }:
  { href: string; children: React.ReactNode; variant?: "primary" | "ghost" | "line" }) {
  const cls = variant === "primary" ? "btn-primary" : variant === "ghost" ? "btn-ghost" : "btn-line";
  return <Link href={href} className={`${cls} w-full`}>{children}</Link>;
}

/** 0~1 값을 막대로 */
export function Bar({ value, color = "#2f45e0" }: { value: number; color?: string }) {
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
      <div className="h-full rounded-full transition-all duration-700"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  );
}
