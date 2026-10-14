"use client";
import { useEffect, useRef, useState } from "react";
import { MAPS_KEY, loadGoogleMaps } from "@/lib/gmaps";
import { asset } from "@/components/gachiro";

/**
 * P5 숙소 위치 확인. P8 지도와 같은 핀을 번호 없이 하나만 꽂는다.
 * 키가 없거나 지도를 못 불러오면 구글 지도 앱·웹으로 여는 링크로 대신한다.
 */
export function LodgingMap({ lat, lng, name }: { lat: number; lng: number; name: string }) {
  const el = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(!MAPS_KEY);

  useEffect(() => {
    if (failed || !el.current) return;
    let live = true;
    loadGoogleMaps()
      .then(async (g) => {
        if (!live || !el.current) return;
        const { Map } = await g.maps.importLibrary("maps");
        const pos = { lat, lng };
        const map = new Map(el.current, {
          center: pos, zoom: 16,
          disableDefaultUI: true, zoomControl: true, gestureHandling: "greedy", clickableIcons: false,
        });
        new g.maps.Marker({
          map, position: pos, title: name,
          icon: { url: asset("/ui/pin.png"), scaledSize: new g.maps.Size(31, 31) },
        });
      })
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [failed, lat, lng, name]);

  const link = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  if (failed) {
    return (
      <a href={link} target="_blank" rel="noreferrer"
        className="mt-2 block rounded-[6px] bg-line-faint py-3 text-center text-[13px] font-semibold text-wine underline">
        구글 지도에서 보기
      </a>
    );
  }
  return (
    <div ref={el} role="region" aria-label={`${name} 위치 지도`}
      className="animate-slideup mt-2 h-[180px] w-full overflow-hidden rounded-[6px] bg-line-faint" />
  );
}
