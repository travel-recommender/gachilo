# 5주차 실제 OSM 수집

2026-09-23 Overpass API에 지역·종류 조건을 보내 받은 실제 데이터다. 기존 5,053개 CSV를 재선별한 결과와 구분하여 `data/week5/live_20260923/`에 보존한다.

## 파일

- `raw/osaka_overpass.json`: OSM 서버 원문. 변경하지 않는다.
- `raw/osaka.overpassql`: 사용한 수집 조건. 오사카 중심부 사각형 범위, node/way/relation 포함.
- `official_checks.json`: 주요 7개 장소의 항목별 공식 확인 결과, 카페 지점 문제 2건. 날짜는 가공일이 아닌 실제 확인일이다.
- `processed/collection_manifest.json`: 원본·쿼리·기존 초안·검증 파일의 해시, 수집일과 OSM 데이터 기준 시각, 통계.
- `processed/osaka_candidates_fresh.json`: 분류한 전체 후보와 OSM ID·원본 태그·출처.
- `processed/osaka_places_150_fresh.json`: 카테고리별 150개 검토용 초안.
- `processed/previous_draft_comparison.json`: 기존 150개와 새 원본의 매칭 및 항목별 차이.
- `processed/collection_report.md`: 사람이 읽는 결과 보고서.

## 다시 생성하기

프로젝트 루트에서 다음을 실행한다. 저장된 원본을 사용하므로 네트워크 요청을 하지 않는다.

```sh
python3 scripts/refresh_osaka_places.py \
  --raw data/week5/live_20260923/raw/osaka_overpass.json \
  --query data/week5/live_20260923/raw/osaka.overpassql \
  --previous data/week5/osaka_places_week5_draft.json \
  --checks data/week5/live_20260923/official_checks.json \
  --output data/week5/live_20260923/processed
```

새 수집은 `--raw`를 생략하고 `--output`을 새 수집 폴더로 지정한다. 원본 스냅샷 파일명에는 UTC 시각이 붙는다. 재사용하는 공식 확인 파일의 날짜가 자동 갱신되는 것은 아니므로 운영 정보는 별도로 재확인한다. 공용 API를 앱 사용자 요청마다 호출하지 않고 수집 결과를 저장해 사용한다. 서버 오류·불완전 응답은 데이터로 받아들이지 않는다.

## 데이터 해석

`place`는 기존 16개 항목을 유지한다. `source`는 OSM 객체 ID·링크·원본 태그·주소 구성요소·수집일·좌표 산정 방식을 담는다. `field_sources`는 필드마다 OSM/기존 초안/공식 확인/번역 편집을 구분한다.

OSM의 빈 값은 null이다. 비용 0, 실외, 24시간 영업으로 대체하지 않는다. OSM의 가격 태그는 오래될 수 있어 공식 대조 전 `cost`로 채택하지 않는다. 체류시간·짐 증가량은 아직 팀 추정 기준이 확정되지 않아 null로 둔다.

`partially_verified`는 공식 확인 파일에 나열된 항목만 확인했다는 뜻이다. `verified_at`도 그 부분 검토일이며 모든 정보나 해당 지점의 실제 영업을 보증하는 값이 아니다. 다른 모든 장소는 `needs_verification`이다. 일정 엔진에 바로 투입하지 않도록 `schedule_ready=false`로 표시했다.

이전 ID 연결은 같은 이름·카테고리·250m 이내 좌표로 추정하며 지점 정체성에 대한 공식 인증은 아니다. 서로 비슷하게 가까운 후보는 자동 연결하지 않는다. 지점 이름이 바뀐 경우 비교 파일을 보고 수동 확인한다. OSM ID가 다른 동일 장소 표현은 같은 이름·75m 이내 또는 명시적인 공식 검토 그룹으로 묶되, 원본 객체는 삭제하지 않는다.

150개는 관광 적합성 검토 전 샘플이다. 카테고리 배분은 명소20·문화25·자연20·쇼핑25·카페25·식사35. 기존 초안에 명확히 매칭된 장소를 우선하고 남는 자리를 웹사이트·영업시간·한국어명 보유 여부와 지역 분산으로 채운다. 별칭·폐업·시설 내부 명소의 중복을 추가 검토해야 한다.

## 사용 출처

- [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API)
- [OpenStreetMap 출처 및 라이선스](https://www.openstreetmap.org/copyright): © OpenStreetMap contributors, ODbL 1.0. 앱 표시와 배포 시 출처를 유지한다.
- 공식 관광·운영 사이트는 `official_checks.json`의 URL 참조. 본문·이미지 대신 확인한 운영 사실만 요약했다.

## 검사

```sh
python3 -m unittest discover -s scripts -p test_refresh_osaka_places.py -v
```

표준 Python 라이브러리만 사용한다. GitHub 업로드와 프론트/백엔드 연결은 이 수집 작업에 포함하지 않았다.
