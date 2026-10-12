"use client";
import { useEffect, useRef, useState } from "react";
import { MAPS_KEY, loadGoogleMaps, type Google } from "@/lib/gmaps";
import { RouteMap } from "@/components/RouteMap";
import { asset } from "@/components/gachiro";
import type { Place } from "@/lib/types";

/**
 * P8 지도. 구글 지도에 장소 순서대로 번호 핀과 동선을 그린다. 확대·이동 가능 (피그마 댓글 #18).
 * 키가 없거나 지도를 못 불러오면 좌표로 그린 동선 그림으로 대신한다.
 */
export function PlanMap({ day, places }: { day: number; places: Place[] }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<Google>(null);
  const drawn = useRef<Google[]>([]);
  const [failed, setFailed] = useState(!MAPS_KEY);

  useEffect(() => {
    if (failed || !el.current) return;
    let live = true;
    loadGoogleMaps()
      .then(async (g) => {
        if (!live || !el.current) return;
        const { Map } = await g.maps.importLibrary("maps");
        map.current ??= new Map(el.current, {
          center: { lat: 34.6937, lng: 135.5023 }, zoom: 13,
          disableDefaultUI: true, zoomControl: true, gestureHandling: "greedy", clickableIcons: false,
        });
        draw(g);
      })
      .catch(() => live && setFailed(true));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed]);

  useEffect(() => {
    const g = (window as Google).google;
    if (map.current && g) draw(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places]);

  function draw(g: Google) {
    drawn.current.forEach((o) => o.setMap(null));
    drawn.current = [];
    if (!places.length) return;
    const bounds = new g.maps.LatLngBounds();
    places.forEach((p, i) => {
      const pos = { lat: p.lat, lng: p.lng };
      bounds.extend(pos);
      drawn.current.push(new g.maps.Marker({
        map: map.current, position: pos, title: `${i + 1}. ${p.name}`,
        icon: {
          url: asset("/ui/pin.png"),
          scaledSize: new g.maps.Size(31, 31),
          labelOrigin: new g.maps.Point(15.5, 20),
        },
        label: { text: String(i + 1), color: "#ffffff", fontSize: "8px", fontWeight: "800" },
      }));
    });
    drawn.current.push(new g.maps.Polyline({
      map: map.current, path: places.map((p) => ({ lat: p.lat, lng: p.lng })),
      strokeColor: "#8b2842", strokeOpacity: 0.7, strokeWeight: 3,
    }));
    if (places.length === 1) { map.current.setCenter(bounds.getCenter()); map.current.setZoom(15); }
    else map.current.fitBounds(bounds, 32);
  }

  if (failed) {
    return (
      <RouteMap plan={{
        day, walkKm: 0, totalKm: 0, totalMoveMin: 0, cost: 0,
        items: places.map((place) => ({ place, tier: "core", startMin: 0, endMin: 0, moveMin: 0, moveKm: 0, participants: [] })),
      }} />
    );
  }
  return <div ref={el} role="region" aria-label={`${day}일차 지도`} className="h-[231px] w-full overflow-hidden rounded-[6px] bg-line-faint" />;
}
