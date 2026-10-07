import { CATEGORY_MAP } from "./places";
import type { Place } from "./types";

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const isCho = (c: string) => CHO.includes(c);

/** 완성형 한글 한 글자의 초성. 한글이 아니면 그대로 */
export function choseong(c: string) {
  const code = c.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return c;
  return CHO[Math.floor(code / 588)];
}

/** 이름 안에 검색어가 이어서 들어 있는가. 검색어의 초성 글자는 이름 글자의 초성과 비교한다 */
function nameHas(name: string, q: string) {
  const n = name.toLowerCase();
  outer: for (let i = 0; i + q.length <= n.length; i++) {
    for (let j = 0; j < q.length; j++) {
      const a = n[i + j], b = q[j];
      if (isCho(b) ? choseong(a) !== b : a !== b) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * 검색어로 장소를 찾는다 (피그마 댓글 #11: 한 글자 칠 때마다 추천, "ㄱ"만 쳐도 글리코상).
 * 이름이 앞에서부터 맞는 곳을 먼저, 그다음 이름 중간, 마지막으로 지역·카테고리·소개문에서 찾는다.
 */
export function searchPlaces(pool: Place[], query: string, limit = 8): Place[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, "");
  if (!q) return [];
  const scored: { p: Place; s: number }[] = [];
  for (const p of pool) {
    const at = nameHas(p.name.replace(/\s+/g, ""), q);
    if (at === 0) scored.push({ p, s: 0 });
    else if (at > 0) scored.push({ p, s: 1 });
    else if (![...q].some(isCho)) {
      const hay = `${p.area} ${CATEGORY_MAP[p.category].label} ${p.blurb}`.toLowerCase();
      if (hay.includes(q)) scored.push({ p, s: 2 });
    }
  }
  return scored
    .sort((a, b) => a.s - b.s || b.p.popularity - a.p.popularity)
    .slice(0, limit)
    .map((x) => x.p);
}
