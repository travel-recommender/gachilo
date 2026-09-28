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

`bag_load`는 `scripts/recommend_itinerary.py`가 이미 이름으로 판별하고 있다(`LIGHT_SHOPPING_PLACES`).
그 규칙을 컬럼으로 옮기면 그대로 채워진다.
