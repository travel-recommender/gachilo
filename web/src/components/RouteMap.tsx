"use client";
import type { DayPlan, ScheduleItem } from "@/lib/types";

export const DAY_COLORS = ["#2f45e0", "#f9584a", "#12b98c", "#f59e0b", "#7a5af5", "#e0498f"];
export const dayColor = (d: number) => DAY_COLORS[(d - 1) % DAY_COLORS.length];

const W = 340, H = 300, PAD = 34;

/**
 * 좌표를 뷰박스에 맞추는 등장방형 투영.
 * 위도에 따라 경도 1도의 실제 거리가 줄어드는 것만 보정했다.
 */
function project(items: ScheduleItem[]) {
  const lats = items.map((i) => i.place.lat);
  const lngs = items.map((i) => i.place.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const xs = lngs.map((v) => v * kx);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...lats), maxY = Math.max(...lats);
  const spanX = Math.max(maxX - minX, 1e-4), spanY = Math.max(maxY - minY, 1e-4);
  const scale = Math.min((W - PAD * 2) / spanX, (H - PAD * 2) / spanY);
  const offX = (W - spanX * scale) / 2, offY = (H - spanY * scale) / 2;
  return (p: { lat: number; lng: number }) => ({
    x: offX + (p.lng * kx - minX) * scale,
    y: offY + (maxY - p.lat) * scale,
  });
}

export function RouteMap({ plan }: { plan: DayPlan }) {
  const items = plan.items;
  if (items.length === 0) {
    return <p className="py-8 text-center text-[12px] text-ink-300">표시할 장소가 없어요.</p>;
  }
  const pr = project(items);
  const pts = items.map((it) => ({ ...pr(it.place), item: it }));
  const color = dayColor(plan.day);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-2xl bg-surface">
        <polyline
          points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none" stroke={color} strokeWidth={2} strokeDasharray="5 4" opacity={0.5}
        />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={13}
              fill={p.item.tier === "core" ? color : "#fff"}
              stroke={color} strokeWidth={2} />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={11} fontWeight={700}
              fill={p.item.tier === "core" ? "#fff" : color}>{i + 1}</text>
          </g>
        ))}
      </svg>
      <div className="mt-2 space-y-1">
        {pts.map((p, i) => (
          <div key={i} className="flex items-center gap-2 text-[11.5px]">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
              style={{ background: color }}>{i + 1}</span>
            <span className="truncate font-medium">{p.item.place.name}</span>
            <span className="ml-auto shrink-0 text-ink-300">{p.item.place.area}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
