/**
 * fallback 경로 점검 — AI가 어떤 식으로 실패해도 결과가 나오는지 확인한다.
 *   node ai_fallback_check.mjs
 * 모든 줄이 "결과 나옴"이어야 통과. (실제 키 없이 돌아간다)
 */
import { buildConsensus } from './consensus.ts';
import { enrich } from './ai.ts';

const DAYS = 4;
const SUBS = [
  { memberId: 'm1', longlist: [], picks: ['glico', 'kuromon', 'umeda_sky', 'nakazaki', 'ichiran'],
    must: 'umeda_sky', veto: 'shinsaibashi', budgetPerDay: 75000, stepLimit: 8500, activeMin: 480 },
  { memberId: 'm2', longlist: [], picks: ['osaka_castle', 'kaiyukan', 'tempozan', 'glico', 'rikuro'],
    must: 'kaiyukan', veto: 'usj', budgetPerDay: 70000, stepLimit: 7000, activeMin: 360 },
  { memberId: 'm3', longlist: [], picks: ['nakazaki', 'amemura', 'nmao', 'osaka_castle', 'kuromon'],
    must: 'osaka_castle', veto: null, budgetPerDay: 100000, stepLimit: 13000, activeMin: 540 },
];
const RULE_SUMMARY = '규칙이 만든 설명 문장';
const consensus = buildConsensus({ submissions: SUBS, nights: DAYS - 1, strategy: 'fairness', allowPartial: true });

const CASES = [
  ['정상 응답', { AI_MOCK: '1' }],
  ['JSON이 깨져서 옴', { AI_MOCK: 'bad' }],
  ['없는 장소를 지어냄', { AI_MOCK: 'halluc' }],
  ['응답이 없어 시간 초과', { SOMSOM_API_KEY: 'x', SOMSOM_BASE_URL: 'http://10.255.255.1/v1', AI_TIMEOUT_MS: '800' }],
  ['키가 없음', {}],
  ['주소가 틀림', { SOMSOM_API_KEY: 'x', SOMSOM_BASE_URL: 'https://localhost:9/none' }],
  ['키가 틀림', { SOMSOM_API_KEY: 'wrong-key-for-test' }],
];

for (const [name, env] of CASES) {
  ['AI_MOCK', 'AI_MOCK_ADD', 'AI_TIMEOUT_MS', 'SOMSOM_API_KEY', 'SOMSOM_BASE_URL'].forEach((k) => delete process.env[k]);
  Object.assign(process.env, env);
  const r = await enrich(consensus, SUBS, DAYS, RULE_SUMMARY);
  const ok = typeof r.summary === 'string' && r.summary.length > 0 && r.selections.length > 0;
  console.log(`${ok ? '결과 나옴' : '결과 없음!!'} · ${name.padEnd(12)} · AI ${r.ai.used ? '사용' : '건너뜀'} (${r.ai.reason})${r.ai.errors.length ? ' — ' + r.ai.errors[0] : ''}`);
}
