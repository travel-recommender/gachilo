"use client";
import { useState } from "react";
import { useVisitConditions } from "@/components/useVisitConditions";
import { STATUS_LABEL, hoursLine, liveLine, sourceHost, type VisitRequest, type VisitStatus } from "@/lib/visit-conditions";

const CHIP: Record<VisitStatus, string> = {
  confirmed: "bg-emerald-50 text-emerald-700",
  check: "bg-amber-50 text-amber-700",
  closed: "bg-wine-50 text-wine",
};

const dateLabel = (iso: string) => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;

/**
 * P8 — 그날 일정에 담긴 장소의 방문 조건(휴무·영업시간·예약)을 출처·확인 시각과 함께 보여준다 (이슈 #6 RAG, 혜인).
 * 누를 때만 조회한다 — 실시간 조회는 유료 요청이라 일정을 넘겨 볼 때마다 부르지 않는다.
 * 실제 장소 방에서만 쓴다. AI가 만든 답변이 아니라 검토 자료와 실시간 조회 결과 그대로다.
 */
export function VisitConditionsPanel({ roomId, token, placeIds, date }: {
  roomId: string; token: string; placeIds: string[]; date: string;
}) {
  // 누른 날·장소 묶음만 기억한다. 다른 날로 넘기면 다시 눌러야 조회한다
  const [asked, setAsked] = useState<string | null>(null);
  const key = JSON.stringify([roomId, date, placeIds]);
  const request: VisitRequest | null = asked === key && placeIds.length ? { roomId, token, placeIds, dates: [date] } : null;
  const { data, error, loading, retry } = useVisitConditions(request);

  if (!placeIds.length) return null;
  return (
    <section aria-label="방문 조건" className="mt-4 rounded-[6.795px] border border-line bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-extrabold">{dateLabel(date)} 방문 조건</h3>
        {!request && (
          <button onClick={() => setAsked(key)}
            className="h-[28px] shrink-0 rounded-[20px] bg-wine px-[10px] text-[12px] font-semibold text-white">
            휴무·예약 확인
          </button>
        )}
      </div>
      {!request && (
        <p className="mt-1 text-[11px] leading-relaxed text-mute">
          이 날 장소의 휴무·영업시간·예약 조건을 공식 출처와 실시간 조회로 확인해요.
        </p>
      )}
      {loading && <p role="status" className="mt-2 text-[12px] text-mute">공식 자료와 실시간 영업 정보를 확인하고 있어요…</p>}
      {error && (
        <div role="alert" className="mt-2 rounded-[10px] bg-wine-50 px-3 py-2 text-[12px] leading-relaxed text-wine">
          {error}
          <button onClick={retry} className="mt-1 block font-bold underline">다시 확인하기</button>
        </div>
      )}
      {data && (
        <ul className="mt-2 space-y-3">
          {data.places.map((p) => {
            const d = p.dates[0];
            return (
              <li key={p.placeId} className="border-t border-line pt-2 first:border-0 first:pt-0">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{p.name}</span>
                  <span className={`shrink-0 rounded-[20px] px-2 py-[2px] text-[10.5px] font-bold ${CHIP[d.status]}`}>{STATUS_LABEL[d.status]}</span>
                </div>
                <p className="mt-1 text-[11.5px] text-ink-700">영업 {hoursLine(d)}</p>
                {d.notices.filter((n) => n.source === "review").map((n) => (
                  <p key={n.code} className="mt-1 text-[11.5px] font-semibold leading-snug text-amber-700">{n.text}</p>
                ))}
                <p className={`mt-1 text-[11px] leading-snug ${d.live === "confirmed" ? "text-emerald-700" : d.live === "not_checked" ? "text-mute" : "text-amber-700"}`}>
                  {liveLine(d.live, data.checkedOn)}
                </p>
                {p.sources.length > 0 ? (
                  <ul className="mt-1 space-y-0.5">
                    {p.sources.map((s) => (
                      <li key={s.url} className="truncate text-[10.5px] text-mute">
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">{s.label} ({sourceHost(s.url)})</a>
                        {s.checkedAt ? ` · ${s.checkedAt} 확인` : " · 확인일 기록 없음"}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[10.5px] text-mute">공식 출처가 연결되지 않았어요. 방문 전에 직접 확인해 주세요.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {data && (
        <p className="mt-3 text-[10px] leading-relaxed text-mute-soft">
          검토 자료 기준 {data.profilesCheckedAt ?? "기록 없음"}. 예약 가능 여부·임시 휴무는 바뀔 수 있으니 방문 전 공식 안내를 확인하세요.
        </p>
      )}
    </section>
  );
}
