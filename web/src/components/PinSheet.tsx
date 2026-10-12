"use client";
import { useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/gachiro";

/**
 * 4자리 PIN 시트.
 * - set: 다른 기기에서 다시 들어올 때 쓸 PIN을 정한다 (두 번 입력해 확인)
 * - enter: 이미 정한 PIN으로 내 자리에 다시 들어간다
 */
export function PinSheet({ open, mode, name, busy, error, onClose, onDone }: {
  open: boolean;
  mode: "set" | "enter";
  name: string;
  busy?: boolean;
  /** 서버가 돌려준 오류 (틀린 PIN, 잠김 등) */
  error?: string | null;
  onClose: () => void;
  onDone: (pin: string) => void;
}) {
  const [first, setFirst] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setFirst(null); setValue(""); setMismatch(false);
    const t = setTimeout(() => input.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open, mode]);

  // 서버 오류가 오면 다시 입력하게 비운다
  useEffect(() => { if (error) setValue(""); }, [error]);

  const change = (raw: string) => {
    const v = raw.replace(/\D/g, "").slice(0, 4);
    setValue(v);
    setMismatch(false);
    if (v.length < 4) return;
    if (mode === "enter") { onDone(v); return; }
    if (first === null) { setFirst(v); setValue(""); return; }
    if (v === first) onDone(v);
    else { setMismatch(true); setFirst(null); setValue(""); }
  };

  const title = mode === "enter" ? `${name}님, PIN을 입력해 주세요` : first === null ? "PIN 4자리를 정해 주세요" : "한 번 더 입력해 주세요";

  return (
    <Sheet title={title} open={open} onClose={onClose}>
      <p className="text-[12.5px] font-medium leading-relaxed text-mute">
        {mode === "enter"
          ? "처음 들어올 때 정한 4자리예요. 새 기기로 들어오면 이전 기기에서는 나가져요."
          : `다른 기기에서 이 링크로 들어와 '${name}'을 누르고 PIN을 넣으면 내 자리로 다시 들어올 수 있어요.`}
      </p>
      <label className="relative mt-5 flex justify-center gap-3" onClick={() => input.current?.focus()}>
        <input ref={input} value={value} onChange={(e) => change(e.target.value)} disabled={busy}
          inputMode="numeric" autoComplete="one-time-code" maxLength={4} aria-label="PIN 4자리"
          className="absolute inset-0 opacity-0" />
        {[0, 1, 2, 3].map((i) => (
          <span key={i} aria-hidden
            className={`flex h-[52px] w-[46px] items-center justify-center rounded-[10px] border text-[24px] font-extrabold ${
              i === value.length ? "border-wine" : "border-line-soft"}`}>
            {i < value.length ? "•" : ""}
          </span>
        ))}
      </label>
      <p className="mt-3 min-h-[18px] text-center text-[12px] font-semibold text-wine">
        {busy ? "확인하는 중…" : mismatch ? "두 번 입력한 PIN이 달라요. 처음부터 다시 정해 주세요." : error ?? ""}
      </p>
    </Sheet>
  );
}
