import { findPlace } from "./places";
import type { Submission } from "./types";

/**
 * 데모용 동행자 성향 5종.
 * 첫 화면에서 받은 동행자 수만큼 앞에서부터 붙인다.
 * longlist는 그 사람이 1차에서 검색으로 찾은 5곳이고,
 * 2차(picks)는 그룹 후보 풀이 만들어진 뒤에 계산한다.
 */
interface Persona {
  /** 1차에서 직접 찾은 곳 */
  longlist: string[];
  /** 2차에서 '꼭'으로 지정할 곳 */
  must: string;
  /** 2차에서 빼달라고 할 곳 (풀에 있을 때만 반영된다) */
  veto: string | null;
  budgetPerDay: number;
  stepLimit: number;
  activeMin: number;
}

const PERSONAS: Persona[] = [
  // 도심·전망 선호, 예산 여유 있음
  { longlist: ["osaka_castle", "shinsaibashi", "kuromon", "harukas", "rikuro"],
    must: "harukas", veto: "usj", budgetPerDay: 80000, stepLimit: 10000, activeMin: 480 },
  // 체험·베이 지역 선호, 많이 못 걸음
  { longlist: ["kaiyukan", "tempozan", "glico", "ichiran", "namba_parks"],
    must: "kaiyukan", veto: "tennoji_zoo", budgetPerDay: 70000, stepLimit: 7000, activeMin: 360 },
  // 문화·자연 선호, 체력 좋고 예산 넉넉함
  { longlist: ["nakazaki", "amemura", "nmao", "science_museum", "sumiyoshi"],
    must: "nakazaki", veto: null, budgetPerDay: 100000, stepLimit: 13000, activeMin: 540 },
  // 신세카이·레트로 선호, 예산이 가장 빠듯함
  { longlist: ["daruma", "tsutenkaku", "shinsekai", "tennoji_zoo", "donki_umeda"],
    must: "daruma", veto: "nmao", budgetPerDay: 38000, stepLimit: 8500, activeMin: 420 },
  // 쇼핑·먹거리 선호, 평균적인 조건
  { longlist: ["glico", "hankyu", "hanadako", "mizuno", "grand_front"],
    must: "mizuno", veto: null, budgetPerDay: 60000, stepLimit: 9000, activeMin: 450 },
];

/** 2차에서 몇 곳을 고르는가 — '나'와 같은 규칙 */
export const PICK_LIMIT = 5;

/** 카테고리 취향 — longlist의 카테고리 분포 */
function tasteOf(ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  ids.forEach((id) => {
    const p = findPlace(id);
    if (p) out[p.category] = (out[p.category] ?? 0) + 1;
  });
  return out;
}

/**
 * 동행자들의 1차 입력.
 * 첫 화면에서 정한 사람 수만큼(나 제외) 페르소나를 붙인다.
 */
export function demoLonglists(memberIds: string[]): Submission[] {
  return memberIds.map((memberId, i) => {
    const persona = PERSONAS[i % PERSONAS.length];
    return {
      memberId,
      longlist: persona.longlist,
      picks: [],
      must: null,
      veto: null,
      budgetPerDay: persona.budgetPerDay,
      stepLimit: persona.stepLimit,
      activeMin: persona.activeMin,
    };
  });
}

/**
 * 동행자들의 2차 입력.
 * 자기가 찾은 곳 3곳은 그대로 두고, 남이 찾아온 곳 중 자기 취향에 가까운 2곳을 더 고른다.
 * 실제 서비스라면 사람이 직접 고르는 단계이고, 데모에서는 이 규칙으로 대신한다.
 */
export function demoSubmissions(memberIds: string[], pool: string[]): Submission[] {
  return demoLonglists(memberIds).map((sub, i) => {
    const persona = PERSONAS[i % PERSONAS.length];
    const mine = sub.longlist.filter((id) => pool.includes(id));
    const taste = tasteOf(sub.longlist);
    const others = pool
      .filter((id) => !sub.longlist.includes(id))
      .map((id) => ({ id, place: findPlace(id) }))
      .filter((x) => x.place)
      .sort((a, b) => {
        const ta = taste[a.place!.category] ?? 0;
        const tb = taste[b.place!.category] ?? 0;
        if (tb !== ta) return tb - ta;
        return b.place!.popularity - a.place!.popularity;
      })
      .map((x) => x.id);

    const picks = [...mine.slice(0, 3), ...others].slice(0, PICK_LIMIT);
    const must = picks.includes(persona.must) ? persona.must : picks[0] ?? null;
    const veto = persona.veto && pool.includes(persona.veto) && !picks.includes(persona.veto)
      ? persona.veto
      : null;

    return { ...sub, picks, must, veto };
  });
}

/** 데모에서 '나'의 기본값 — 사용자가 바꾼다 */
export const MY_DEFAULT: Submission = {
  memberId: "me",
  longlist: [],
  picks: [],
  must: null,
  veto: null,
  budgetPerDay: 70000,
  stepLimit: 9000,
  activeMin: 480,
};
