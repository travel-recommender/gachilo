/** Request-local experimental costs. Relative bag points are not kilograms or money. */
import {AsyncLocalStorage} from 'node:async_hooks';

export interface WeatherSnapshot {
  source: string;
  fetched_at: string | null;
  status: string;
  days: {date: string; probability: number | null; max_temperature_c?: number | null; status: string}[];
}
const context = new AsyncLocalStorage<{weather?: WeatherSnapshot; start: string; date: string; shelter?:boolean}>();
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
type ForecastDay = WeatherSnapshot['days'][number];
// Service preference based on Japan's >=35°C hot-day definition; not a heat alert/WBGT.
export const HEAT_THRESHOLD_C = 35;
// Product preference for a day that stays cold, not an official cold-wave alert.
export const COLD_THRESHOLD_C = 5;
const validProbability = (d?:ForecastDay) => d?.status==='forecast' && typeof d.probability==='number'
  && Number.isFinite(d.probability) && d.probability>=0 && d.probability<=1 ? d.probability : null;
const validTemperature = (d?:ForecastDay) => d?.status==='forecast' && typeof d.max_temperature_c==='number'
  && Number.isFinite(d.max_temperature_c) && d.max_temperature_c>=-90 && d.max_temperature_c<=60 ? d.max_temperature_c : null;
const currentDay = () => {
  const current=context.getStore();
  return current?.weather?.days.find(d=>d.date===current.date);
};
export const rainProbability = () => validProbability(currentDay());
export const isHeatDay = () => (validTemperature(currentDay()) ?? -Infinity)>=HEAT_THRESHOLD_C;
export const isColdDay = () => (validTemperature(currentDay()) ?? Infinity)<=COLD_THRESHOLD_C;
/** Rain and heat use the same sheltered-edge evidence; never double count it. */
const exposureWeight = (day?:ForecastDay) => Math.max(validProbability(day)??0,
  (validTemperature(day)??-Infinity)>=HEAT_THRESHOLD_C || (validTemperature(day)??Infinity)<=COLD_THRESHOLD_C ? 1 : 0);
export function withShelterPreference<T>(enabled:boolean, fn:()=>T):T {
  const current=context.getStore();
  return current ? context.run({...current,shelter:enabled},fn) : fn();
}
export const routingColdPreference = () => context.getStore()?.shelter!==false && isColdDay();
export const hasColdForecast = () => context.getStore()?.weather?.days.some(d=>(validTemperature(d)??Infinity)<=COLD_THRESHOLD_C) ?? false;
export const hasRainOrHeatForecast = () => context.getStore()?.weather?.days.some(d=>(validProbability(d)??0)>0 || (validTemperature(d)??-Infinity)>=HEAT_THRESHOLD_C) ?? false;
export const routingExposureWeight = () => context.getStore()?.shelter===false ? 0 : exposureWeight(currentDay());
export const shelterFallbackDescription = () => context.getStore()?.shelter===false
  ? ' 방문 조건을 지키기 위해 이 후보는 실내·지붕 우회 선호를 적용하지 않았습니다.' : '';
export const hasShelterWeather = () => context.getStore()?.weather?.days.some(d=>exposureWeight(d)>0) ?? false;

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
  const rain=current.weather.days.filter(d=>validProbability(d)!==null);
  const heat=current.weather.days.filter(d=>validTemperature(d)!==null);
  const missingRain=current.weather.days.length-rain.length, missingHeat=current.weather.days.length-heat.length;
  return ` Open-Meteo 강수확률(일 최대): ${rain.map(d=>`${d.date} ${Math.round(d.probability!*100)}%`).join(', ') || '미확인'}.`
    + ` 일 최고기온: ${heat.map(d=>`${d.date} ${d.max_temperature_c}°C`).join(', ') || '미확인'}.`
    + ` 폭염 회피 기준은 일 최고기온 예보 ${HEAT_THRESHOLD_C}°C 이상이며 추위 회피는 일 최고기온 예보 ${COLD_THRESHOLD_C}°C 이하입니다. 공식 특보 판정은 아닙니다.`
    + (current.weather.fetched_at ? ` 조회 ${current.weather.fetched_at}.` : '')
    + (missingRain || missingHeat ? ` 미확인 예보(강수 ${missingRain}일·기온 ${missingHeat}일)는 해당 가중치 미적용(맑음·선선함으로 간주하지 않음).` : '');
}
