# 장소 데이터

## 파일

| 파일 | 내용 | 행 수 | 만든 방법 |
| --- | --- | --- | --- |
| `osaka_place_candidates.csv` | OSM에서 뽑은 후보 전체 | 5,053 | `scripts/extract_osaka_places.py` |
| `osaka_places_verified.csv` | 사람이 영업시간·출처를 검증한 장소 | 30 | 후보 중에서 골라 수작업 검증 |

`verified` 쪽이 **현재 쓸 수 있는 데이터**다. `candidates`는 거기서 더 뽑아 쓰는 풀이다.

## 원본 OSM 덤프는 깃에 없다

추출에 쓴 `planet_135.475,34.647_135.525,34.741.osm.geojson`은 **99MB라 올리지 않는다.**
(압축본 13MB도 마찬가지. 깃 히스토리는 지워지지 않아서 한 번 올리면 영구히 무거워진다.)

필요하면 같은 범위로 다시 받는다 — 파일 이름이 곧 bbox다.

```
서쪽 135.475 / 남쪽 34.647 / 동쪽 135.525 / 북쪽 34.741
```

- [BBBike extract](https://extract.bbbike.org/) 에서 위 사각형을 지정해 GeoJSON으로 받거나
- `scripts/collect_osaka_places.py`의 Overpass 쿼리로 직접 받는다

받은 파일을 `data/` 에 두면 `extract_osaka_places.py`가 자동으로 찾는다(`*.geojson` 첫 번째 파일).

## 데이터 흐름

```
OSM 덤프(깃에 없음)
   └→ extract_osaka_places.py  → osaka_place_candidates.csv  (5,053곳)
        └→ 사람이 검증           → osaka_places_verified.csv   (30곳)
             └→ 서버 seed        → DB places 테이블
```

**깃이 원본이고 DB는 복사본이다.** DB에서 직접 고치면 다음 배포 때 덮어써진다.
장소를 고칠 일이 있으면 이 CSV를 PR로 고친다.

## 아직 안 맞는 것 — 5주차에 맞춰야 함

`osaka_places_verified.csv`의 컬럼이 4차 회의에서 정한 **장소 데이터 형식 16개 컬럼과 다르다.**

| | 상태 |
| --- | --- |
| 있는 것 | `name` `name_ko` `category` `latitude` `longitude` `opening_hours` `website` `opening_hours_source` `verified_at` |
| 합의됐는데 **없는 것** | `place_id` `area` `address` `cost` `stay_min` `bag_load` `covered` |
| 합의에 없는데 있는 것 | `status` `verification_level` |

없는 7개 중 `cost`·`stay_min`·`bag_load`·`covered`는 **일정 생성에 직접 쓰이는 값**이라
(예산 계산 / 시간 배치 / 쇼핑 뒤로 밀기 / 비 오는 날 실내) 비면 알고리즘이 못 돈다.
`place_id`는 API 계약(`docs/API_계약.md`)에서 장소를 가리키는 키다.

16개 컬럼에 맞춘 판은 이 PR이 아니라 #24의 `data/osaka_places_schema.csv`에 있다
(`place_id`는 `osaka_001` 형식). 작성 기준도 #24의 `docs/place_data_dictionary.md`가 원본이다.
이 파일은 그 전 단계의 검증본으로 둔다.

### `bag_load` — 값 체계가 셋이라 아직 컬럼으로 옮기지 않는다

| 위치 | 값 |
| --- | --- |
| `scripts/recommend_itinerary.py` (`get_luggage_score`) | 정수 0·1·2 (쇼핑 카테고리 2, `LIGHT_SHOPPING_PLACES` 1) |
| `web/src/lib/places.ts` (`bagLoad`) | 0~1 실수 |
| #24 `docs/place_data_dictionary.md` 제안 | 0~3 상대 지표 |

스크립트 규칙을 그대로 컬럼에 부으면 한 체계를 사실상 확정하게 된다.
#24 사전도 팀 확정 전 자동 채움을 막고 있으므로, 값 체계를 정한 뒤 채운다.

### `category` — 합의한 7개 중 `체험`이 없다

기획서(`docs/기획서.md`)와 웹(`web/src/lib/places.ts`)은 명소·식사·카페·쇼핑·문화·**체험**·자연 7개를 쓴다.
데이터는 6개뿐이다 — 검증본 30곳(명소 8·문화 6·자연 5·쇼핑 5·식사 4·카페 2)과 후보 5,053곳 모두
`체험`이 0건이다. 원인은 `scripts/extract_osaka_places.py`의 `target_categories`와 `get_category`에
`체험` 분류가 없어서다. 나머지 6개 값은 문자열까지 정확히 일치한다(식사 시간대 배치 규칙은 그대로 동작한다).

`체험` 분류 규칙을 넣으려면 OSM 덤프로 후보를 다시 뽑아야 해서 이 PR에서는 고치지 않는다.
