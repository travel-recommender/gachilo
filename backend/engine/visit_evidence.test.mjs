import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceOf, evidenceForDate, safeSourceUrl} from './visit_evidence.mjs';
import {visitConditions} from './visit_conditions.mjs';
import {loadRuntimeInputs} from '../../scripts/validate_real_schedule.mjs';

const day = '2026-11-18';
const policy = {today: day};
const source = {kind:'official_web_review', urls:['https://shop.example/branches/a'], checked_at:'2026-11-18', valid_from:'2026-11-01', valid_through:'2026-11-30'};
const record = () => ({place:{place_id:'a', opening_hours:'10:00–20:00', cost:1000, website:'https://shop.example/branches/a'},
  field_sources:{opening_hours:{...source}, cost:{...source}, website:{...source}}, review:{}});
const profiles = () => ({checked_at:'2026-11-18',valid_from:'2026-11-01',valid_through:'2026-11-30',
  places:{a:{window:[600,1200,1200],checked_at:'2026-11-18',source_urls:source.urls}}});
const assess = (r=record(),p=profiles(),date=day) => evidenceForDate(evidenceOf(r,p,policy),date);

test('자료 ID는 지점과 내용에 고정, 평가 날짜만 바뀌어도 동일하며 입력을 수정하지 않음', () => {
  const r=record(),p=profiles(),before=JSON.stringify([r,p]);
  const a=evidenceOf(r,p,policy),b=evidenceOf(r,p,{today:'2026-12-20'});
  assert.deepEqual(a.entries.map(e=>e.id),b.entries.map(e=>e.id));
  assert.equal(JSON.stringify([r,p]),before);
  assert.equal(assess().status,'usable');
});
test('같은 URL이어도 항목별 확인일을 합치지 않음; 날짜만 있는 출처에 확인 시각을 꾸며 넣지 않음', () => {
  const r=record();r.field_sources.cost.checked_at='2026-09-01';
  const es=evidenceOf(r,profiles(),policy).entries;
  assert.equal(es.find(e=>e.field==='cost').freshness,'stale');
  assert.equal(es.find(e=>e.field==='opening_hours').freshness,'current');
  assert.equal(es.find(e=>e.field==='opening_hours').checkedPrecision,'day');
  assert.ok(assess(r).reasons.includes('evidence_stale'));
});
test('전역 확인일·수입일은 지점의 확인일로 대체하지 않음', () => {
  const p=profiles();delete p.places.a.checked_at;
  const r=record();delete r.field_sources.cost.checked_at;r.field_sources.cost.imported_at=day;
  const es=evidenceOf(r,p,policy).entries;
  for(const field of ['cost','operating_rules']) assert.equal(es.find(e=>e.field===field).checkedAt,null);
  assert.ok(assess(r,p).reasons.includes('evidence_date_unknown'));
});
test('정확한 지점 ID만 허용하고 같은 브랜드의 다른 지점 근거를 물려주지 않음', () => {
  const r=record();r.review.visit_evidence=[{place_id:'b',field:'opening_hours',value:'24h',...source}];
  assert.throws(()=>evidenceOf(r,profiles(),policy),/place-scoped/);
  const p=profiles();p.places={b:p.places.a};
  assert.ok(assess(record(),p).reasons.includes('evidence_missing'));
});
test('전체·지점 적용 기간의 교집합을 사용하고 양 끝 날짜는 포함', () => {
  const p=profiles();Object.assign(p.places.a,{valid_from:'2026-11-10',valid_through:'2026-12-31'});
  assert.ok(assess(record(),p,'2026-11-09').reasons.includes('evidence_period'));
  assert.equal(assess(record(),p,'2026-11-10').status,'usable');
  assert.equal(assess(record(),p,'2026-11-30').status,'usable');
  assert.ok(assess(record(),p,'2026-12-01').reasons.includes('evidence_period'));
});
test('과거 값을 남기되 현재 값과 충돌로 취급하지 않음', () => {
  const r=record();r.field_sources.opening_hours.previous={value:'09:00–19:00',source:{...source,checked_at:'2026-09-01'}};
  const e=evidenceOf(r,profiles(),policy);
  assert.equal(e.entries.filter(x=>x.state==='superseded').length,1);
  assert.equal(evidenceForDate(e,day).status,'usable');
});
test('동일 항목·겹치는 적용 기간의 다른 주장은 충돌, 유효기간 밖 자료는 분리', () => {
  const r=record();r.review.visit_evidence=[{place_id:'a',field:'opening_hours',value:'09:00–19:00',...source}];
  const c=assess(r);assert.equal(c.conflicts.length,1);assert.ok(c.reasons.includes('evidence_conflict'));
  assert.ok(c.conflicts[0].evidenceIds.every(id=>!c.usableEvidenceIds.includes(id)));
  r.review.visit_evidence[0].valid_through='2026-11-17';assert.equal(assess(r).conflicts.length,0);
});
test('오래됨 임계일·미래 확인일·유효하지 않은 날짜를 구분', () => {
  const r=record();r.field_sources.cost.checked_at='2026-10-19';assert.equal(assess(r).status,'usable');
  r.field_sources.cost.checked_at='2026-10-18';assert.ok(assess(r).reasons.includes('evidence_stale'));
  r.field_sources.cost.checked_at='2026-11-19';assert.ok(assess(r).reasons.includes('evidence_future'));
  r.field_sources.cost.checked_at='2026-11-18T23:00:00-05:00';assert.ok(assess(r).reasons.includes('evidence_future'));
  r.field_sources.cost.checked_at='2026-02-30';assert.ok(assess(r).reasons.includes('evidence_date_unknown'));
  assert.throws(()=>assess(r,profiles(),'2026-02-30'),/date/);
});
test('지도·사용자 입력은 공식 근거로 승격하지 않고 위험한 링크는 제거', () => {
  const r=record();r.field_sources.cost={...source,urls:['https://www.openstreetmap.org/node/1','javascript:alert(1)','https://user:secret@example.com/a']};
  const e=evidenceOf(r,profiles(),policy).entries.find(e=>e.field==='cost');
  assert.deepEqual(e.sources,[{url:'https://www.openstreetmap.org/node/1',kind:'map'}]);
  r.field_sources.cost={...source,kind:'user_reported_official_web_review'};
  assert.equal(evidenceOf(r,profiles(),policy).entries.find(e=>e.field==='cost').sources[0].kind,'manual');
  for(const s of ['file:///tmp/a','https://','data:text/plain,a'])assert.equal(safeSourceUrl(s),null);
});
test('날짜별 예외는 해당 날짜에만 조회되고 상시 운영 규칙과 구분', () => {
  const p=profiles();p.places.a.exceptions={'2026-11-17':{closed:true}};
  const e=evidenceOf(record(),p,policy),id=e.entries.find(x=>x.field==='operating_exception').id;
  assert.ok(evidenceForDate(e,'2026-11-17').applicableEvidenceIds.includes(id));
  assert.ok(!evidenceForDate(e,'2026-11-18').applicableEvidenceIds.includes(id));
  assert.equal(evidenceForDate(e,'2026-11-17').conflicts.length,0);
});
test('238곳 전체 자료를 읽으며, 검토 부족 경고가 실시간 성공으로 사라지거나 일정 가능 상태를 바꾸지 않음', async () => {
  const {dataset,profiles:p}=loadRuntimeInputs(),before=JSON.stringify([dataset,p]);
  for(const r of dataset.places) evidenceForDate(evidenceOf(r,p,policy),day);
  const liveCheck=async reqs=>({source:'mock',checked_on:day,verdicts:new Map(reqs.map(r=>[`${r.record.place.place_id}|${r.date}`,[]]))});
  const result=await visitConditions({placeIds:['osaka_007'],dates:[day]},dataset,p,{liveCheck,evidencePolicy:policy});
  assert.equal(result.places[0].dates[0].live,'confirmed');
  assert.equal(result.places[0].dates[0].status,'confirmed');
  assert.equal(result.places[0].dates[0].evidenceCheck.status,'check');
  assert.equal(JSON.stringify([dataset,p]),before);
});

test('개별 확인일과 공식 출처가 모두 최신이면 live 성공과 함께 확인됨', async () => {
  const {dataset,profiles:p}=loadRuntimeInputs();
  const r=structuredClone(dataset.places.find(r=>r.place.place_id==='osaka_007'));
  const pp=structuredClone(p);pp.places.osaka_007.checked_at=day;
  for(const field of ['opening_hours','cost','website'])r.field_sources[field].checked_at=day;
  const liveCheck=async reqs=>({source:'mock',checked_on:day,verdicts:new Map(reqs.map(r=>[`${r.record.place.place_id}|${r.date}`,[]]))});
  const v=await visitConditions({placeIds:['osaka_007'],dates:[day]},{places:[r]},pp,{liveCheck,evidencePolicy:policy});
  assert.equal(v.places[0].dates[0].status,'confirmed');
});
test('검토 기간 밖의 예외가 다른 날짜에 끼어들지 않음; 잘못된 전역 기간은 무시하지 않음', () => {
  const p=profiles();p.places.a.exceptions={'2026-12-01':{closed:true}};
  const e=evidenceOf(record(),p,policy),id=e.entries.find(x=>x.field==='operating_exception').id;
  assert.ok(!evidenceForDate(e,day).applicableEvidenceIds.includes(id));
  assert.ok(!evidenceForDate(e,'2026-12-01').usableEvidenceIds.includes(id));
  p.valid_from='2026-02-30';assert.ok(assess(record(),p).reasons.includes('evidence_period'));
});

test('공식 지점 도메인의 www만 정규화하고 다른 하위 도메인은 승격하지 않는다', () => {
  const r=record();r.place.website='https://www.shop.example/';
  const p=profiles();p.places.a.source_urls=['https://shop.example/rules'];
  assert.equal(evidenceOf(r,p,policy).entries.find(e=>e.field==='operating_rules').sources[0].kind,'official');
  p.places.a.source_urls=['https://other.shop.example/rules'];
  assert.equal(evidenceOf(r,p,policy).entries.find(e=>e.field==='operating_rules').sources[0].kind,'reviewed');
});

test('공식 운영사와 입점사 교차 확인 URL을 구분해 보존한다',()=>{
  const r=record();r.field_sources.cost={...source,urls:[...source.urls,'https://tenant.example/notice'],reviewed_urls:['https://tenant.example/notice']};
  const e=evidenceOf(r,profiles(),policy).entries.find(e=>e.field==='cost');
  assert.deepEqual(e.sources.map(s=>s.kind),['official','reviewed']);
});
