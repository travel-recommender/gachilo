# 실험 지점 자동 변경을 위한 브랜드 데이터

2026-11-12 사용자 확정: 이번 실험에도 지점 자동 변경을 적용한다.
이 자료는 [이슈 #6의 역할별 체크리스트](https://github.com/travel-recommender/gachilo/issues/6#issuecomment-6785296514) 중 조은의 데이터 준비이다.
**이 변경만으로 지점 자동 변경이 실행되지는 않는다.** 윤진의 엔진·혜인의 화면 통합과 병합 뒤 새 실험 묶음을 만들어야 한다.

## 범위와 데이터 계약

- 기존 238개 장소 ID 전부 대조: 66개 지점을 27개 브랜드로 명시적으로 묶었다. 172개는 `null`로 남긴다. `null`은 단일 매장이라는 사실 판정이 아니라 이 관계표에서 묶지 않았다는 뜻이다.
- 이름 접두사·일반 명칭·운영사만으로 브랜드를 만들지 않는다. `review.branch_collection.brand`의 “스파”, “호젠지” 같은 검색용 표기는 그대로 브랜드 키로 쓰면 안 된다.
- 카탈로그/API: `brand_id`, `branch_group_id`. 엔진 `Place`: `brandId`, `branchGroupId`.
- `brand_id`는 같은 브랜드의 선호·제외·만족도 계산에 사용할 식별자다. **null끼리 같은 브랜드로 비교하면 안 된다.** null/미지정은 기존 `place_id`로 구분한다.
- `branch_group_id`는 자동 교체 시 방문 목적을 보존할 비교 범위다. 동일한 non-null 브랜드·교체 그룹이어야 하며, 날짜·휴무·예산·카테고리·식사 역할을 다시 검사해야 한다. 기존 엔진과 같이 `mealRole` 없는 식사 장소는 기본 식사 역할을 따른다.
- 교체 전후 전체 일정의 이동·시간·예산·필수/제외 조건 검사를 통과해야 한다. 이 자료는 추가 이동시간 최소화 구현이나 후보 3개 동작을 완료하지 않는다.

## 헷갈리기 쉬운 관계

| 관계 | 기록한 기준 |
| --- | --- |
| 이치란 7개 기록 | 같은 브랜드. 도톤보리 본관은 폐업 보류 유지, 나머지 6곳과 혼동 금지. 브랜드 키가 있어도 일정에 넣을 수 있다는 뜻은 아님 |
| 551 호라이 본점·난바워크 / 다카시마야 | 동일 브랜드, 식당 2곳과 포장 1곳의 교체 그룹 분리 |
| ZARA / ZARA MAN | 동일 브랜드, 일반 매장·남성 전용 매장 분리 |
| 한큐 본점 / 한큐 맨즈 | 동일 브랜드, 백화점·남성 전문관 분리 |
| BAPE 일반·남성관·CDG 내 매장 | 브랜드는 동일하되 취급 범위 동등성이 확인되지 않아 교체 그룹을 각각 보수적으로 분리 |
| PORTER / CLOAKROOM by PORTER | 브랜드 관계만 연결, 매장 형태별 교체 그룹 분리 |
| TULLY'S / TULLY'S &TEA | 브랜드 관계만 연결, 일반·차 특화 형태 분리 |
| Cherry Jam / 빈티지 JAM | 다른 가게. 문자열이 겹쳐도 묶지 않음 |
| BAPE CDG / COMME des GARCONS | 입점 매장과 건물의 브랜드를 합치지 않음 |
| girls mignon / petit mignon | 운영사가 같다는 이유로 다른 상표를 합치지 않음 |
| 스파 스미노에 / 스파월드 | “스파”라는 일반 단어로 묶지 않음 |

주요 구분의 새 확인 출처: [이치란 본관 종료 공지](https://ichiran.com/shop/kinki/),
[551 본점](https://www.551horai.co.jp/shop/list/13/), [551 난바워크](https://www.551horai.co.jp/shop/list/20/),
[551 다카시마야](https://www.551horai.co.jp/shop/list/18/),
[ZARA MAN 공식 상점가 안내](https://www.shinsaibashi.or.jp/stores/show/842/ZARA%20MAN%20%E5%BF%83%E6%96%8E%E6%A9%8B%E7%AD%8B%E5%BA%97),
[TULLY'S &TEA](https://shop.tullys.co.jp/detail/1003053), [BAPE 매장 목록](https://jp.bape.com/pages/store-list/cdg-osaka).
각 지점의 기존 근거 URL도 관계표에 보존했다. 관계 검토일을 영업시간·가격의 새로운 확인일로 덮어쓰지 않았다.

## 운영 조건과 재현

- 새 기본 카탈로그: `data/final/osaka_catalog_20261112.json`.
- 기존 `osaka_profiles_20261104.json` 날짜별 프로필과 모든 영업시간·휴무·가격·좌표·보류 상태를 그대로 유지한다. 브랜드의 공통 영업시간이나 가격을 복사하지 않는다.
- 공통 메뉴 참고가는 API의 `estimate`, 미확인 가격은 미확인으로 유지한다. 쇼핑 구매액 제외를 무료로 바꾸지 않는다.
- 이전 버전은 수정하지 않는다. 관계표 `data/brands/osaka_brand_registry_20261112.json`은 기존 카탈로그 SHA-256을 고정한다.
- 검증된 운영 자료의 적용 기간은 기존대로 **2026-11-30까지**다. 이번 작업은 전체 장소의 최신 영업 재조회가 아니다.

```sh
python3 scripts/publish_brand_catalog.py          # 관계표에서 새 카탈로그 생성
python3 scripts/publish_brand_catalog.py --check  # 생성 결과·런타임 선택 일치 검사
python3 -m unittest discover -s scripts -p 'test_brand_catalog.py'
node --test scripts/test_brand_catalog.mjs scripts/test_november_catalog.mjs
```

역사 버전 생성기 `publish_verified_catalog.py`를 다시 실행하면 기본 카탈로그도 역사 버전으로 돌아간다. 그 경우 관계 검토를 확인한 뒤 `publish_brand_catalog.py`를 마지막에 실행한다.

## 확인 결과와 남은 연결

- 새 데이터 검사 Python 8개 / Node 4개, 기존 11월 데이터 검사 5개, 백엔드 카탈로그 13개, 엔진 140개 통과.
- 238곳 × 가상 여행 4일(11/16~19)의 날짜 적격 판정이 이전 카탈로그와 동일함을 확인했다. 551 본점의 11/17 휴무와 난바워크의 11/18 휴무도 각각 유지된다.
- API 임시 방에서 기존 후보 3개 계산·전원 동일 결과 조회·DB 재조회 통과. 이 검사는 자동 지점 변경 엔진의 완료 검사가 아니다. 유료 호출 없음.
- 윤진: 키/교체 그룹을 읽어 세 후보 자동 배치·브랜드 만족도·제외를 구현하고 검토.
- 혜인: 바뀐 지점 표시와 H4 설명 조건 연결. 설명 없는 조건에 변경 이유를 노출하지 않음.
- 통합 병합 후 조은: 새 코드·데이터로 실험 묶음 재생성. 기존 QR·실험 DB를 데이터 준비 단계에서 바꾸지 않음.
