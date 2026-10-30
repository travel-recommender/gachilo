/** Request-local experimental costs. Relative bag points are not kilograms or money. */
import {AsyncLocalStorage} from 'node:async_hooks';

export interface WeatherSnapshot {
  source: string;
  fetched_at: string | null;
  status: string;
  days: {date: string; probability: number | null; status: string}[];
}
const context = new AsyncLocalStorage<{weather?: WeatherSnapshot; start: string; date: string}>();
export function withTripConditions<T>(weather: WeatherSnapshot | undefined, start: string, fn: () => T): T {
  return context.run({weather, start, date:start}, fn);
}
export function withConditionDate<T>(date: string, fn: () => T): T {
  const current = context.getStore();
  return current ? context.run({...current,date},fn) : fn();
}
export function withConditionDay<T>(index: number, fn: () => T): T {
  const current = context.getStore();
  if (!current) return fn();
  const date = new Date(Date.parse(current.date+'T00:00:00Z')+index*86400000).toISOString().slice(0,10);
  return withConditionDate(date, fn);
}
export function rainProbability(): number | null {
  const current = context.getStore();
  const day = current?.weather?.days.find(d=>d.date===current.date);
  return day?.status === 'forecast' && typeof day.probability === 'number'
    && Number.isFinite(day.probability) && day.probability >= 0 && day.probability <= 1 ? day.probability : null;
}
export const hasRainForecast = () => context.getStore()?.weather?.days.some(
  d=>d.status==='forecast' && typeof d.probability==='number' && d.probability>0 && d.probability<=1) ?? false;

// A tunable experiment coefficient, not a measured fatigue effect or a speed correction.
export const BAG_WEIGHT = 0.35;
export function bagIncrement(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}
export const bagExtraCost = (walkKm: number, load: number) => Math.max(0,walkKm) * bagIncrement(load) * BAG_WEIGHT;
export const carryingCost = (walkKm: number, load: number) => Math.max(0,walkKm) + bagExtraCost(walkKm,load);

export function weatherDescription(): string {
  const current = context.getStore();
  if (!current?.weather) return ' 날씨 예보 미연결: 날씨 가중치를 적용하지 않았습니다.';
  const known = current.weather.days.filter(d=>d.status==='forecast' && typeof d.probability==='number' && Number.isFinite(d.probability) && d.probability>=0 && d.probability<=1);
  const missing = current.weather.days.length-known.length;
  const ranges = known.map(d=>`${d.date} ${Math.round(d.probability!*100)}%`).join(', ');
  return ` Open-Meteo 강수확률(일 최대): ${ranges || '미확인'}.`
    + (current.weather.fetched_at ? ` 조회 ${current.weather.fetched_at}.` : '')
    + (missing ? ` 예보 미확인 ${missing}일은 날씨 가중치 미적용(맑음으로 간주하지 않음).` : '');
}
