# 6주차 데이터 검토 — 2026-10-06

**150곳 전체의 일정용 검증 완료 승격은 아직 끝나지 않았다.** 공식 근거·운영 조건을 보완한 현재 데이터에서 55곳이 단독 모델 검사를 통과하고 95곳은 보류다. 현장 방문 가능 보증과 실서비스 승격을 뜻하지 않으며 모든 `schedule_ready`는 false를 유지한다.

사용자가 서비스 화면 연결과 3대 기기 시험은 10월 7일 팀 회의에서 진행하기로 했다. 이번 변경은 데이터, 검토 출처, 오프라인 검사와 CSV 내보내기 범위다.

## 이번에 반영한 내용

- 21곳의 공식 자료를 재검토하거나 조회 실패 사유를 기록했다. 13개 필드의 값 또는 출처를 갱신했다(값 변경 11개·출처 범위 갱신 2개, 빈칸 보완 5개). 날짜 규칙은 7곳 추가·1곳 재검토했다. 전체 150곳의 당일 공식 재조회라는 뜻은 아니다.
- 우메키타 사우스 파크는 일반 야외 산책의 무료·24시간 범위를 확인했다. 유료 행사·점포·미개방 북쪽 구역은 제외한다.
- 와케 다리는 오사카시의 和気橋 표기와 기존 지도/OSM 대조를 연결해 남아 있던 지점 불명 차단을 해제했다. 지도 재조회·출입구 검증을 완료했다는 뜻은 아니다.
- 컴포트 존 에이트의 1,150엔 파스타를 공통 점심 창 12~14시, 최종 입장 13시로 한정했다. 월·화·공휴일은 제외한다. 세금 포함 표시가 없는 참고 메뉴 금액이며 추가 주문·코스·평균 식비가 아니다.
- 나가라 공원은 공식 운영시간 PDF의 해당 행을 확인해 OSM의 24/7을 통상 09~17시, 5/17~8/16에는 09~19시로 정정했다. 비용은 공식 명시 근거가 없어 null이다.
- Akiba Kart는 7,000엔이 16시 전 출발에만 적용됨을 명시하고 예약·운전 자격 확인을 차단 조건에 추가했다. 42195커피는 공식 휴무일 충돌, MERCY는 공식 주소 충돌로 보류한다.
- 출처 링크가 `urls` 배열 대신 OSM의 `url` 한 개로 저장된 경우도 CSV 근거 열에 표시하도록 했다. 공식 검증으로 출처 종류를 변경하지 않으며 `field_sources_json.kind`에서 구별한다.

값·출처·이전 값·조회 실패·차단 해제 근거는 [이번 검토 JSON](../data/week6/official_followup_20261006.json), 누적 기록은 [변경 원장](../data/week5/live_20260923/processed/planning_review_20260930.json)에 있다. 추정값으로 빈칸을 없애지 않았다.

## 내일 사용할 파일

- [전체 150곳 원본 검토 CSV, 31열](../data/week5/live_20260923/processed/osaka_places_150_review.csv): 이름, 주소, 원래 필드, 메모, 필드별 출처를 확인한다.
- [회의용 150곳 판정 CSV, 15열](../data/week6/osaka_places_meeting_review_20261007.csv): `passed_individual_model_on_20261007=true`로 필터하면 내일 날짜의 단독 모델 통과 54곳을 볼 수 있다. 그 중 몇 곳을 선택한 전체 일정은 다시 계산해야 한다.
- [날짜별 판정 JSON](../data/week6/place_checks_20261006.json): 10/7~13 중 최소 하루 통과 55곳, 전 날짜 보류 95곳. 몬톰웍스는 10/7 휴무 때문에 내일 통과 목록에서는 빠진다.

쇼핑 구매비 null은 비산정이다. 전체 null 비용 99곳 중 30곳은 쇼핑·시장 등 구매비를 계산하지 않는 대상이며, 나머지 69곳은 가격 근거 보완이 필요하다. 빈칸과 무료(0), 미확인 covered와 false를 서로 바꾸지 않는다.

## 남은 데이터 검증

|항목|현재|
|---|---:|
|주소 빈칸|2곳|
|영업시간 빈칸|17곳|
|비용 미확인(쇼핑 비산정 제외)|69곳|
|날짜별 운영 규칙 없음|75곳|
|covered 미확인|85곳|
|일정용 검증 완료 승격|0곳|

위 사유는 중복되므로 더해서 장소 수로 세면 안 된다. 폐업·장기 휴관·지점 불명은 빈칸만 채워 해결할 수 없다. 출처가 확인되는 새 후보를 별도 ID로 추가하고, 기존 ID의 이력을 유지해야 한다. 메뉴 이미지 판독·방문일 공지·동일 지점 확인이 남은 곳을 포함하여 [전체 보류 목록](week5_remaining_places.md)에 다음 조치를 기록했다. 공개 자료가 없는 경우의 현장 확인을 완료했다고 표시하지 않았다.

카테고리 통과 구성은 명소 4, 문화 11, 자연 10, 쇼핑 17, 카페 1, 식사 12곳이다. 특히 카페가 부족하다. 의무 비율을 임의로 만들지 않고 사용자의 ‘검증 가능한 장소 우선’ 기준으로 후속 후보를 선택한다.

## 검사와 재생성

데이터 원장·ID·좌표 보존·CSV 31열 왕복 검사 5건과 날짜/예산/일정/자료 적용 검사 44건을 통과했다. CSV에서는 한국어 이름·null·0·false·필드 출처가 원본 JSON과 일치한다. API나 실제 사용자 데이터는 수정하지 않았다.

```sh
python3 scripts/export_place_review.py
node scripts/validate_real_schedule.mjs --report data/week5/schedule_validation_20260930.json
node scripts/audit_real_catalog.mjs data/week5/real_catalog_integration_20260930.json
node scripts/report_remaining_places.mjs
node scripts/report_week6_catalog.mjs
node scripts/report_week6_place_checks.mjs
python3 -m unittest discover -s scripts -p 'test_official_enrichment.py'
node --test scripts/test_place_review_20261006.mjs scripts/test_official_followup.mjs scripts/test_week6_catalog.mjs scripts/test_real_schedule.mjs scripts/test_real_rooms.mjs
```

검사 환율 9.5는 가상값이며 실제 고시 환율이 아니다. 이동은 기존 추정식이다. 내일 서비스 화면·3대 기기 시험과 이 데이터 판정은 별개로 기록한다. 이슈의 ‘150곳 검증 완료’는 체크하지 않는다.
