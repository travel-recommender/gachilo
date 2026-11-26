"use client";
import { useEffect, useState } from "react";
import type { Place } from "@/lib/types";
import type { RoomSession } from "@/components/store";
import { API_BASE } from "@/lib/room-api";

type Photo = { url: string; mapsUrl: string; authors: { name: string; url: string | null; avatar: string | null }[] };
export function PlacePhoto({ place, room }: { place: Place; room: RoomSession | null }) {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 28000);
    setPhoto(null); setLoading(true);
    if (!room || place.custom) { setLoading(false); clearTimeout(timer); return; }
    fetch(`${API_BASE}/rooms/${encodeURIComponent(room.roomId)}/place-photo`, {
      method: "POST", cache: "no-store", signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${room.token}` },
      body: JSON.stringify({ placeId: place.id }),
    }).then(async response => {
      if (!response.ok) return;
      const data = await response.json();
      if (live && data.placeId === place.id && data.status === "ready") setPhoto(data.photo);
    }).catch(() => {}).finally(() => { clearTimeout(timer); if (live) setLoading(false); });
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  }, [place.id, place.custom, room?.roomId, room?.token]);
  const maps = photo?.mapsUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([place.name, place.address].filter(Boolean).join(" "))}`;
  return <figure className="my-3 overflow-hidden rounded-xl border border-line">
    {photo ? <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.url} alt={`${place.name} 장소 사진`} className="aspect-[4/3] w-full object-cover" referrerPolicy="no-referrer" onError={() => setPhoto(null)} />
      <div className="flex flex-wrap items-center gap-2 px-3 pt-2 text-xs text-mute">
        <a href={maps} target="_blank" rel="noopener noreferrer" className="font-medium">Google Maps</a>
        {photo.authors.map((author, i) => <span key={i} className="inline-flex items-center gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {author.avatar && <img src={author.avatar} alt="" className="h-5 w-5 rounded-full" referrerPolicy="no-referrer" />}
          {author.url ? <a href={author.url} target="_blank" rel="noopener noreferrer" className="underline">{author.name}</a> : author.name}
        </span>)}
      </div>
    </> : <div role="status" className="flex aspect-[4/3] items-center justify-center bg-stone-100 px-4 text-center text-sm text-mute">
      {loading ? "장소 사진을 불러오는 중이에요" : <a href={maps} target="_blank" rel="noopener noreferrer" className="underline">Google 지도에서 사진 보기 ↗</a>}
    </div>}
    <figcaption className="px-3 py-3">
      <p className="text-base font-bold">{place.name}</p>
      {place.address && <p className="mt-1 text-xs leading-5 text-mute">{place.address}</p>}
    </figcaption>
  </figure>;
}
