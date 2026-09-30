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

### `bag_load` — 값 체계가 정해지지 않아 아직 컬럼으로 옮기지 않는다

| 위치 | 값 |
| --- | --- |
| `scripts/recommend_itinerary.py` (`get_luggage_score`) | 정수 0·1·2 (쇼핑 카테고리 2, `LIGHT_SHOPPING_PLACES` 1) |
| #24 150곳 데이터·`backend/place_catalog.py` (팀 규칙 2026-09-29) | 정수 0·1·2 (위 스크립트와 같은 규칙) |
| #24 `docs/place_data_dictionary.md` 초안 | 0~3 상대 지표 |
| `web/src/lib/places.ts` (`bagLoad`) · 엔진 | **0~1 실수** — `schedule.ts:141` `bagLoad * 2.5 * (1 - load)`가 이 범위를 전제한다 |

데이터(0·1·2)와 엔진(0~1)이 다르므로 **둘 중 하나로 통일하거나, 변환을 한 곳에만 둬야 한다.**

- 윤진 제안: **0~1 실수로 통일**. 사람이 채울 때는 0 / 0.3 / 0.6 / 1 네 단계로 쓴다. 변환 지점이 늘면 스케일이 어디서 틀어졌는지 찾기 어렵기 때문
- 현재 #24: 데이터는 0·1·2로 두고 엔진 연결 시 변환 (`docs/API_계약.md` 0.4)

정해지기 전에는 스크립트 규칙을 그대로 컬럼에 붓지 않는다. 한 체계를 사실상 확정하게 되기 때문이다.

### `category` — 합의한 7개 중 `체험`이 없다

기획서(`docs/기획서.md`)와 웹(`web/src/lib/places.ts`)은 명소·식사·카페·쇼핑·문화·**체험**·자연 7개를 쓴다.
데이터는 6개뿐이다 — 검증본 30곳(명소 8·문화 6·자연 5·쇼핑 5·식사 4·카페 2)과 후보 5,053곳 모두
`체험`이 0건이다. 원인은 `scripts/extract_osaka_places.py`의 `target_categories`와 `get_category`에
`체험` 분류가 없어서다. 나머지 6개 값은 문자열까지 정확히 일치한다(식사 시간대 배치 규칙은 그대로 동작한다).

`체험` 분류 규칙을 넣으려면 OSM 덤프로 후보를 다시 뽑아야 해서 이 PR에서는 고치지 않는다.
**6주차 재수집 때 `target_categories`·`get_category`에 `체험`을 넣는다.**

이게 빠지면 영향이 크다. 엔진 `CategoryId`는 `activity`(체험)를 포함한 7개이고, AI 프롬프트에는
"AI가 추가하는 곳은 확정된 곳과 카테고리가 겹치지 않게 섞는다"는 규칙이 있다. 시연 데이터 36곳에는
가이유칸 수족관 같은 체험 장소가 있지만, 150곳으로 바꾸면 이 축이 통째로 빠져 추천 다양성이 줄어든다.

### `place_id` — 형식이 둘이다

| 위치 | 형식 |
| --- | --- |
| #24 150곳 데이터 · `docs/place_data_dictionary.md` | 연번 `osaka_001` (기존 ID 보존 원칙) |
| 윤진 AI 프롬프트 · #22 초안 예시 | 슬러그 `osaka_castle` |

윤진 제안은 **슬러그**다. 프롬프트는 모델이 장소를 id로만 가리키고 이름은 코드가 채우는 구조인데,
연번이면 모델이 입력에 없는 `osaka_151` 같은 번호를 지어낼 유인이 생긴다(검증기가 후보 밖 id는 거르지만,
애초에 안 지어내게 하는 편이 낫다). 슬러그는 로그를 사람이 읽을 때도 어느 장소인지 바로 보인다.
#24의 ID 보존 원칙과 부딪히므로 데이터 담당과 정한 뒤 #22·#24를 같이 맞춘다.

### `popularity` — 엔진이 쓰는데 16개 컬럼에 없다

엔진 `Place` 타입에는 `popularity`(0~1)가 있고, 직접 고르지 않은 장소의 개인 효용에서 약 절반을 차지한다.

```
consensus.ts:175   0.08 + 0.42 × (내 카테고리 취향) + 0.38 × place.popularity
```

16개 사전(#24)과 150곳 데이터 모두에 이 값이 없다. 비면 `NaN`이 되어 "아무도 고르지 않았지만 모두에게 무난한 곳"을
AI가 고르는 단계(2차 화면의 "AI가 추천해준 여행지")가 통째로 멈춘다. OSM 수집에는 리뷰가 없으므로 둘 중 하나를 정한다.

1. 카테고리별 기본값 하나로 고정 — 간단하지만 후보 간 변별력이 사라진다
2. `data/google_place_links.json`(#24)에서 리뷰 수·평점을 받아 0~1로 정규화

**0으로 채우지 않는다.** 모든 미선택 장소 점수가 똑같이 낮아져 AI가 아무것도 고르지 못한다.
방식이 정해지면 대체값 처리는 AI 연결 쪽(윤진)에서 넣는다.
