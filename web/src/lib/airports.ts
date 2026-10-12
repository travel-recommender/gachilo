/**
 * 고를 수 있는 공항 (피그마 댓글 #5: 한국·일본의 모든 공항).
 * 정기 여객편이 있는 공항 기준이다. 코드는 IATA.
 */
export interface Airport {
  code: string;
  name: string;
  country: "KR" | "JP";
}

const KR: [string, string][] = [
  ["ICN", "인천"], ["GMP", "김포"], ["PUS", "김해"], ["CJU", "제주"], ["TAE", "대구"],
  ["CJJ", "청주"], ["MWX", "무안"], ["KWJ", "광주"], ["YNY", "양양"], ["RSU", "여수"],
  ["USN", "울산"], ["KPO", "포항경주"], ["HIN", "사천"], ["KUV", "군산"], ["WJU", "원주"],
];

const JP: [string, string][] = [
  ["KIX", "간사이"], ["ITM", "이타미"], ["UKB", "고베"], ["NRT", "나리타"], ["HND", "하네다"],
  ["NGO", "주부"], ["CTS", "신치토세"], ["FUK", "후쿠오카"], ["OKA", "나하"], ["KKJ", "기타큐슈"],
  ["HIJ", "히로시마"], ["OKJ", "오카야마"], ["TAK", "다카마쓰"], ["MYJ", "마쓰야마"], ["TKS", "도쿠시마"],
  ["KCZ", "고치"], ["KOJ", "가고시마"], ["KMJ", "구마모토"], ["NGS", "나가사키"], ["OIT", "오이타"],
  ["KMI", "미야자키"], ["HSG", "사가"], ["SDJ", "센다이"], ["KIJ", "니가타"], ["FSZ", "시즈오카"],
  ["KMQ", "고마쓰"], ["TOY", "도야마"], ["YGJ", "요나고"], ["IZO", "이즈모"], ["UBJ", "야마구치우베"],
  ["AOJ", "아오모리"], ["AXT", "아키타"], ["HNA", "하나마키"], ["GAJ", "야마가타"], ["FKS", "후쿠시마"],
  ["IBR", "이바라키"], ["MMB", "메만베쓰"], ["AKJ", "아사히카와"], ["HKD", "하코다테"], ["KUH", "구시로"],
  ["OBO", "오비히로"], ["ISG", "이시가키"], ["MMY", "미야코"], ["SHI", "시모지시마"], ["ASJ", "아마미"],
];

export const AIRPORTS: Airport[] = [
  ...KR.map(([code, name]) => ({ code, name, country: "KR" as const })),
  ...JP.map(([code, name]) => ({ code, name, country: "JP" as const })),
];

export const airportLabel = (code: string) => {
  const a = AIRPORTS.find((x) => x.code === code);
  return a ? `${a.name} ${a.code}` : code;
};
