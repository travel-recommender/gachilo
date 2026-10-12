/**
 * 구글 지도 JS API 로더.
 * 키는 web/.env.local의 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY에서 읽는다 (저장소에 올리지 않는다).
 * 브라우저에 실리는 키이므로 Google Cloud 콘솔에서 HTTP 리퍼러·API 제한을 걸어 둔다.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Google = any;

export const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

let loading: Promise<Google> | null = null;

export function loadGoogleMaps(): Promise<Google> {
  if (!MAPS_KEY) return Promise.reject(new Error("지도 키가 없어요."));
  if (typeof window === "undefined") return Promise.reject(new Error("브라우저에서만 쓸 수 있어요."));
  const w = window as any;
  if (w.google?.maps?.importLibrary) return Promise.resolve(w.google);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    w.__gachiroMapsReady = () => resolve(w.google);
    const s = document.createElement("script");
    const q = new URLSearchParams({
      key: MAPS_KEY, v: "weekly", loading: "async", language: "ko", region: "JP",
      callback: "__gachiroMapsReady",
    });
    s.src = `https://maps.googleapis.com/maps/api/js?${q.toString()}`;
    s.async = true;
    s.onerror = () => { loading = null; reject(new Error("지도를 불러오지 못했어요.")); };
    document.head.appendChild(s);
  });
  return loading;
}

/** 오사카 중심 — 숙소 검색을 이 근처로 치우친다 */
export const OSAKA = { lat: 34.6937, lng: 135.5023 };

export interface AddressHit {
  /** 호텔·장소 이름 */
  main: string;
  /** 주소 */
  sub: string;
  /** 고르면 좌표를 받아오는 함수 */
  resolve: () => Promise<{ address: string; lat: number; lng: number }>;
}

/** 숙소 주소·이름 자동완성 (Places API New) */
export async function searchAddress(input: string, session: unknown): Promise<AddressHit[]> {
  const g = await loadGoogleMaps();
  const { AutocompleteSuggestion } = await g.maps.importLibrary("places");
  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input,
    sessionToken: session,
    language: "ko",
    region: "jp",
    locationBias: { center: OSAKA, radius: 30000 },
  });
  return (suggestions as any[])
    .filter((s) => s.placePrediction)
    .slice(0, 6)
    .map((s) => ({
      main: s.placePrediction.mainText?.toString() ?? s.placePrediction.text.toString(),
      sub: s.placePrediction.secondaryText?.toString() ?? "",
      resolve: async () => {
        const place = s.placePrediction.toPlace();
        await place.fetchFields({ fields: ["displayName", "formattedAddress", "location"] });
        return {
          address: [place.displayName, place.formattedAddress].filter(Boolean).join(" · "),
          lat: place.location.lat(),
          lng: place.location.lng(),
        };
      },
    }));
}

export async function newSession(): Promise<unknown> {
  const g = await loadGoogleMaps();
  const { AutocompleteSessionToken } = await g.maps.importLibrary("places");
  return new AutocompleteSessionToken();
}
