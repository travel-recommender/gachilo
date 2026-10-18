/** 같은 시설의 표기 변형만 연결한다. 장소 ID·지점·일정 데이터는 합치지 않는다. */
export const PLACE_NAME_GROUPS: readonly (readonly string[])[] = [
  ["유니버셜 스튜디오 재팬", "유니버설 스튜디오 재팬", "유니버셜", "유니버설", "USJ", "Universal Studios Japan"],
  ["도톤보리 글리코 사인", "도톤보리 글리코사인", "도톤보리 글리고 사인", "도톤보리 글리고사인", "글리코", "글리고", "글리코상", "글리고상", "글리코 간판", "글리고 간판", "Glico sign"],
  ["쓰텐카쿠", "츠텐카쿠", "츠텐카꾸", "Tsutenkaku"],
  ["구로몬 시장", "쿠로몬 시장", "Kuromon Market"],
  ["시텐노지", "시텐노우지", "시텐노오지", "Shitennoji"],
  ["가이유칸 수족관", "가이유칸", "카이유칸 수족관", "카이유칸", "해유관", "Kaiyukan"],
  ["덴포잔 대관람차", "텐포잔 대관람차", "Tempozan Ferris Wheel"],
  ["텐노지 동물원", "덴노지 동물원", "Tennoji Zoo"],
  ["난바 파크스", "남바 파크스", "Namba Parks"],
  ["우메다 스카이빌딩 공중정원", "우메다 스카이 빌딩", "우메다 공중정원", "Umeda Sky Building"],
  ["그랑프론트 오사카", "그랜드프론트 오사카", "Grand Front Osaka"],
  ["신사이바시스지 상점가", "신사이바시수지 상점가", "Shinsaibashi-suji Shopping Street"],
  ["스미요시타이샤", "스미요시 대사", "Sumiyoshi Taisha"],
  ["츠루하시 코리아타운", "쓰루하시 코리아타운", "Tsuruhashi Koreatown"],
  ["아베노 하루카스 전망대", "아베노 하루카스", "하루카스 300", "Harukas 300"],
  ["아메리카무라", "아메무라", "Amerikamura"],
];

/** 초성 검색을 보존하면서 띄어쓰기·구두점·영문 대소문자·전각 영숫자를 통일한다. */
export const normalizePlaceName = (value: string) => value.normalize("NFC")
  .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  .toLowerCase().replace(/[\s\p{P}]/gu, "");

const groupsByName = new Map<string, readonly string[]>();
for (const group of PLACE_NAME_GROUPS) {
  const normalized = group.map(normalizePlaceName);
  for (const name of normalized) groupsByName.set(name, normalized);
}

/** 이름 전체가 등록된 표기와 같을 때만 별칭을 부여한다. 부분 이름으로 다른 지점을 묶지 않는다. */
export function searchablePlaceNames(name: string): readonly string[] {
  const normalized = normalizePlaceName(name);
  return groupsByName.get(normalized) ?? [normalized];
}
