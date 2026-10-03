/** Reproducible category audit. Model passes never promote unreviewed facts. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {loadInputs} from './validate_real_schedule.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function categoryReport(dataset, profiles, audit) {
  if (audit.source_sha256 !== hash(dataset) || audit.profiles_sha256 !== hash(profiles)) {
    throw Error('Regenerate the catalogue audit before reporting categories');
  }
  const checks = new Map(audit.individual_validation.places.map(p => [p.place_id, p]));
  const ids = dataset.places.map(r => r.place.place_id);
  if (new Set(ids).size !== ids.length || checks.size !== ids.length
      || audit.individual_validation.places.length !== ids.length || ids.some(id => !checks.has(id))) {
    throw Error('Every unique catalogue ID needs exactly one matching individual audit');
  }
  const categories = [...new Set(['명소', '문화', '자연', '쇼핑', '카페', '식사',
    ...dataset.places.map(r => r.place.category)])].map(category => {
    const rows = dataset.places.filter(r => r.place.category === category);
    const passed = rows.filter(r => checks.get(r.place.place_id).passed_individual_model);
    const reasons = new Map();
    for (const r of rows.filter(r => !checks.get(r.place.place_id).passed_individual_model)) {
      const codes = new Set(checks.get(r.place.place_id).excluded_date_groups.flatMap(g => g.reasons));
      for (const code of codes) reasons.set(code, (reasons.get(code) || 0) + 1);
    }
    return {category, collected: rows.length, passed_individual_model: passed.length,
      held: rows.length - passed.length,
      promotion_complete: rows.filter(r => r.review.schedule_ready === true).length,
      address_missing: rows.filter(r => !r.place.address).length,
      hours_missing: rows.filter(r => !r.place.opening_hours).length,
      covered_unknown: rows.filter(r => r.place.covered == null).length,
      passed_ids: passed.map(r => r.place.place_id),
      held_ids: rows.filter(r => !checks.get(r.place.place_id).passed_individual_model).map(r => r.place.place_id),
      blockers: [...reasons].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([reason, places]) => ({reason, places}))};
  });
  return {source_sha256: audit.source_sha256, profiles_sha256: audit.profiles_sha256,
    evidence_checked_at: profiles.checked_at, test_dates: audit.individual_validation.dates,
    total_records: ids.length, individual_passed: categories.reduce((n, c) => n + c.passed_individual_model, 0),
    promotion_complete: categories.reduce((n, c) => n + c.promotion_complete, 0), categories,
    policy: '검증 가능한 장소 우선. 카테고리별 의무 비율은 합의되지 않았으며 통과 수를 늘리기 위해 사실을 추정하지 않는다.',
    interpretation: '단독 모델 통과는 표시한 날짜 중 최소 하루의 합성 조건 통과다. 전체 일정 배치·현장 검증·실서비스 승격과 다르다. covered 미확인은 비 대응에 사용할 수 없다.',
    suggested_research_order: [...categories].filter(c => c.held > 0)
      .sort((a,b) => a.passed_individual_model - b.passed_individual_model || b.held - a.held)
      .map(c => c.category)};
}

export function categoryMarkdown(r) {
  const rows = r.categories.map(c => `|${c.category}|${c.collected}|${c.passed_individual_model}|${c.held}|${c.promotion_complete}|`).join('\n');
  return `# 6주차 장소 데이터·카테고리 점검\n\n`+
    `총 **${r.total_records}곳**, 단독 모델 **${r.individual_passed}곳 통과**, **${r.total_records-r.individual_passed}곳 보류**다. 일정용 검증 완료 승격은 **${r.promotion_complete}곳**이다.\n\n`+
    `|카테고리|수집|모델 통과|보류|검증 완료 승격|\n|---|---:|---:|---:|---:|\n${rows}\n\n`+
    `원본 수보다 통과 장소 구성을 함께 확인한다. 다음 조사 우선순위는 **${r.suggested_research_order.join(' → ')}**다. 검증 가능한 후보가 있으면 이 순서를 조정하며 의무 비율을 정한 것은 아니다.\n\n`+
    `검사 날짜: ${r.test_dates[0]}~${r.test_dates.at(-1)}. 자료 확인일: ${r.evidence_checked_at}. 보고서 생성이 모든 출처의 당일 재확인이라는 뜻은 아니다.\n\n`+
    `${r.interpretation}\n\n`+
    `쇼핑 구매비 null은 비산정으로 유지한다. 주소·영업시간·가격 미확인, 폐업·예약·지점 혼동을 무료·상시 영업으로 바꾸지 않는다. 승격 전 남은 사항은 [장소별 검증 목록](week5_remaining_places.md), 출처와 통과 ID는 [구성 JSON](../data/week6/category_balance.json)에 있다.\n\n`+
    `재생성: 먼저 전체 카탈로그 검사를 실행한 뒤 \`node scripts/report_week6_catalog.mjs\`를 실행한다. 자료 해시가 다르거나 ID가 빠진 검사 결과는 거부한다.\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {dataset, profiles} = loadInputs();
  const audit = JSON.parse(fs.readFileSync(new URL('../data/week5/real_catalog_integration_20260930.json', import.meta.url), 'utf8'));
  const report = categoryReport(dataset, profiles, audit);
  fs.mkdirSync(new URL('../data/week6/', import.meta.url), {recursive: true});
  fs.writeFileSync(new URL('../data/week6/category_balance.json', import.meta.url), JSON.stringify(report, null, 2)+'\n');
  fs.writeFileSync(new URL('../docs/week6_catalog.md', import.meta.url), categoryMarkdown(report));
  console.log(JSON.stringify({total: report.total_records, passed: report.individual_passed, promoted: report.promotion_complete}));
}
