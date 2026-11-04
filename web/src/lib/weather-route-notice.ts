/** Optional line in the persisted server summary; old/local results have none. */
const PREFIX = '날씨 경로 안내: ';
export function weatherRouteNotice(summary: string | undefined): string | null {
  return summary?.split('\n').find(line=>line.startsWith(PREFIX))?.slice(PREFIX.length) || null;
}
export function withoutWeatherRouteNotice(summary: string): string {
  return summary.split('\n').filter(line=>!line.startsWith(PREFIX)).join(' ').trim();
}
