import { weatherRouteNotice } from '@/lib/weather-route-notice';

export function WeatherRouteNotice({ summary }: { summary?: string }) {
  const notice = weatherRouteNotice(summary);
  if (!notice) return null;
  return (
    <aside aria-label="날씨에 따른 이동 안내" className="my-3 rounded-lg border border-line bg-wine-50 px-3 py-3 text-left text-wine">
      <p className="text-[12px] font-bold">날씨를 고려한 이동</p>
      <p className="mt-1 text-[12px] leading-relaxed">{notice}</p>
    </aside>
  );
}
