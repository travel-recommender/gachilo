# 2026-11-04 장소 데이터 반영

검색 목록은 225곳에서 238곳으로 늘었다. 기존 30곳의 운영 조건을 갱신했고 그중 11곳에 방문일 규칙을 연결했다. 신규 13곳은 검색에만 포함하며 미확인 조건이 해결되기 전까지 자동 일정에서 제외한다.

## 범위와 결과

- 검사 기간: 2026-11-04~2026-11-30. 이 기간 중 하루 이상 조건을 통과한 곳 115, 전 기간 보류 123. 날짜마다 휴무·영업 조건이 달라 실제 사용 가능 수는 달라진다.
- 새로 일정 조건을 연결한 11곳: 코메다 난바 센니치마에·KITTE, 도토루 신사이바시역·우메다시티, 탈리스 난바파크스·그랜드프런트 남관, 마츠야 난카이난바, 야요이켄 닛폰바시, 마루가메 우메다, HEP FIVE 관람차, 나카노시마공원.
- HEP FIVE는 11월 19일 휴업을 제외한다. 쓰텐카쿠는 입장 시간 예약 확인 전 보류하고, 주택박물관·동양도자미술관의 장기 휴관과 이치란 폐점 상태를 유지한다.
- 신규 13곳: 칼디 3지점, 쿠라스시 2지점, 미즈카케차야, 난바워크, 에비스바시, 닛폰바시 덴덴타운, 돈보리 리버크루즈, 온천 3곳. 동일 브랜드도 지점 ID를 나눴다. 칼디는 카페가 아닌 쇼핑이다.

## 데이터 해석

`data/runtime_catalog.json`을 사용하는 서버가 새 카탈로그와 방문일 규칙을 읽는다. 기존 150곳 원본 CSV·225곳 JSON은 변경하지 않는다. 필드별 이전 값·출처와 새 확인 출처는 `data/final/catalog_verification_20261104.json` 및 생성 카탈로그에 남긴다.

코메다 2지점은 해당 지점의 공개 매장 취식 메뉴 가격이다. 도토루·탈리스·마츠야·야요이켄·마루가메의 공통 메뉴 가격은 지점별 차이가 있을 수 있는 **참고 추정액**이며 API와 결과에서도 `cost_status=estimate`로 표시한다. 스타벅스 가격대 및 회전초밥 1접시 가격을 지점별 1인 식사비로 확정하지 않는다. 체류시간·짐 점수는 시연용 추정이다.

지도 좌표는 공식 지도 또는 기존 OSM 참조점이다. 실제 입구·층간 이동·무장애 접근을 현장 검증했다는 뜻이 아니다. 로컬 OSRM 도보 nearest/route를 11곳에 실행해 모두 응답을 확인했고 참조점과 경로망의 간격은 1.1~27.7m였다. 이는 영업 여부나 입구 위치의 증명이 아니다. 난바워크의 실내 공간 정보는 새 도로 경로 데이터로 변환하지 않았다.

모든 원본의 `schedule_ready=false`는 유지한다. 기존 설계처럼 실제 일정 가능 여부는 여행 날짜·예산·방문일 프로필로 판정한다. 새 프로필의 유효기간은 위 검사 기간이며 영구 검증·실시간 확인·예약 확정을 의미하지 않는다.

## 재현

Node 24 이상 및 Python 3.10 이상에서, 유료 호출 없이 실행한다.

```sh
python3 scripts/publish_verified_catalog.py
node scripts/audit_runtime_dates.mjs
python3 -m unittest discover -s scripts -p test_publish_verified_catalog.py
node --test scripts/test_november_catalog.mjs scripts/test_runtime_catalog.mjs scripts/test_verified_branches.mjs
python3 -m unittest discover -s backend
node --test backend/engine/*.test.mjs
python3 scripts/test_final_catalog_flow.py
```

방문일 검사 결과는 `data/final/schedule_audit_20261104.json`, 실행 당시 OSRM 결과는 `data/final/osrm_reference_check_20261104.json`에 있다. 단일 장소 모델 검사는 넉넉한 가상 제한을 사용하며 모든 그룹 일정의 성공을 보장하지 않는다. 기존 사용자 방·SQLite·실행 서버는 변경하지 않는다. 팀원이 사용하려면 이 브랜치를 받은 뒤 서버를 재시작해야 한다.

## 이어서 확인할 수집 요청

아쿠아라이너·나카자키초·덴포잔 관람차·엑셀시오르·무겐라멘·미츠키·카네코 한노스케·카라카라·규카츠 토미타·야키토리 샤바노는 이번 추가 13곳에 포함하지 않았다. 상호/지점 식별, 좌표, 운영 조건을 더 확인해야 한다. 교토 Gion Nandattei는 오사카 일정과 분리해서 검토한다.
