# OSRM 도보 경로 연결

## 결정과 적용 범위

**도보 프로필로 자체 구동하는 OSRM을 서버에서 호출한다.** 공개 FOSSGIS 서버는 초당 1회·과도한 사용 금지 정책이 있어 전체 장소 행렬을 반복 계산하는 용도로 쓰지 않는다. 기존 Python 예제에 고정돼 있던 공개 서버 주소도 제거했다.

OSRM은 OSM 데이터를 전처리할 때 이동 모드가 결정된다. URL에 `foot`을 넣는 것만으로 자동차 서버가 도보 서버가 되지 않는다. 반드시 `foot.lua`로 준비한 전용 서버를 `OSRM_FOOT_URL`에 설정한다. 해당 변수는 서버 환경변수로만 읽으며 방/사용자 입력으로 받지 않는다.

- `queryWalkingRoute(a, b)`: Route API, 입력 `{lat,lng}`, 출력 `{km,min,source,fallbackReason?}`. 좌표는 요청에 `경도,위도` 순서, 응답 미터/초는 km/분으로 변환한다.
- `withRouting(places, calculate)`: 계산 시작 전 Table API 1회. 거리와 시간을 함께 받아 방향별로 보관하며 장소 선택·시간표·AI 검증·최종 지표에서 같은 값을 쓴다. 방 사이 캐시는 공유하지 않는다.
- 데모 단일 전략과 3후보 계산은 자동 보완 장소까지 포함한 36곳, 실제 장소 모드는 사용자가 선택한 좌표만 조회한다. 150곳 전체 선택도 지원한다(서버 한도 200곳). 실제 모드는 여전히 평균 전략만 지원한다.
- 유효한 OSRM 도보 거리가 1.2km 이하면 도보, 초과하면 대중교통 추정으로 판정한다. 경로를 받지 못한 구간은 기존 직선거리×1.35에 같은 기준을 적용한다. 가까워 보여도 강·도로를 우회하는 도보 경로가 1.2km를 넘으면 대중교통으로 다시 분류한다.
- 가까운 식사 보완 장소와 다음 방문 장소의 순서는 동일한 직선거리 기준으로 비교한다. 도보 실거리와 대중교통 추정 km를 섞어 비교하지 않는다. 실제 도착 시각·걸음 수·이동 지표는 판정된 이동 수단의 거리·시간을 사용한다.
- 대중교통은 실제 교통 경로가 아닌 추정이다. 거리 기준은 `max(직선거리×1.35, 도보 경로 거리)`, 시간은 `round(기준 거리 / 18km/h × 60) + 8분`, 역 접근 도보는 0.7km를 쓴다. 강 건너 추정 0.3km·도보 우회 1.4km라면 대중교통 추정은 1.4km·13분으로 기록해 알려진 우회를 지우지 않는다. 도보 경로 조회 실패 시에는 기존 추정과 같으며, 도보 경로를 실제 대중교통 노선으로 확인했다는 뜻은 아니다. 방향별 도보 거리가 다르면 수단 판정도 다를 수 있다. 실제 교통·환승 API는 후속 범위다.
- 기존 JSON 계약을 바꾸지 않는다. 결과 `summary` 끝에 최종 일정의 `OSRM 도보 N구간 / 도보 추정 N구간 / 대중교통 추정 N구간`을 남긴다. AI 설명이 있어도 이동 출처 문구는 서버가 별도로 붙인다.
- 실제 장소 결과와 날짜별 검사 보고서의 `limitations`도 최종 일정 구간의 출처를 센다. 요청 컨텍스트가 있어도 OSRM 미설정·실패 또는 사용 구간이 없으면 OSRM 도보 0구간으로 표시한다.
- 브라우저 자체 미리보기(`web/src/lib`)와 오프라인 데이터 감사는 기존 추정을 유지한다. 서비스 화면의 서버 공용 결과 연결은 PR #40 범위이며 이 변경이 화면 연결·3대 기기 시험 완료를 뜻하지 않는다.

## 실패 처리

환경변수 미설정, 연결 오류, HTTP 오류, 시간 초과, JSON/행렬 형식 오류, NoRoute/NoTable/NoSegment, 개별 null 셀, 100m 초과 도로 스냅은 추정으로 돌아간다. 요청에는 `radiuses=100`을 넣지 않고 응답의 각 waypoint 거리를 검사한다. 따라서 한 장소의 스냅 거리가 100m를 넘더라도 그 장소에 연결된 셀만 대체하고 다른 정상 경로는 유지한다. 서버가 요청 전체를 거절하면 전체 추정으로 돌아간다. 거리/시간은 유한한 0 이상 숫자여야 한다. 서로 다른 좌표가 같은 도로 노드에 붙어 0m/0초가 나와도 두 waypoint가 유효하면 정상 OSRM 결과로 센다. 거리 또는 시간 한쪽만 0이면 `invalid_response`로 추정 복귀한다.

잘못된 좌표 자체는 경로를 만들어내지 않고 `Invalid routing coordinates` 오류로 처리한다. NaN을 정상 일정으로 흘려보내던 동작은 유지하지 않는다. 실제 장소 서버는 `availability`에서 누락·문자열·범위 밖 좌표를 `coordinates_invalid`로 제외하므로 다른 유효 장소는 계속 계산한다. 행렬 준비에서도 잘못된 좌표를 제외한다. 데모 카탈로그와 `makeCustomPlace`가 생성하는 좌표는 숫자임을 회귀검사하며, 해당 엔진/AI/일정 계산에 직접 전달하는 외부 좌표는 호출 전에 검증해야 한다.

대체 도보 거리 = 기존 직선거리×1.35, 대체 시간 = round(거리/4.2×60). 기본 시간 제한 2초이며 응답 본문을 읽는 시간도 포함한다. `OSRM_TIMEOUT_MS`는 1~3000ms만 허용하며, 5000처럼 범위를 넘으면 조용히 줄이지 않고 `invalid_config`로 추정 복귀한다. 자동 재시도는 없다. 한 계산 안에서는 한 번 받아둔 결과를 재사용하므로 경로 장애가 장소 수만큼 누적되지 않는다. 기존 Python 실제 장소 엔진의 20초 제한도 유지한다.

`source=osrm-foot`도 지도 기반 **예상** 이동이다. 실측, 최신 도로 통제, 교통 시간표, 숙소 왕복, 시설 내부 이동을 보장하지 않는다. 원본 장소 CSV의 검증 상태나 보류값은 바꾸지 않는다.

## 자체 서버 준비

Docker가 설치·실행된 개발 PC 또는 팀 서버에서 진행한다. 공식 OSRM 이미지 버전은 `v26.10.0`으로 고정했다. [Geofabrik 일본 지역 추출](https://download.geofabrik.de/asia/japan.html) 등에서 오사카와 주변 동선을 포함한 OSM PBF를 준비한다. 전체 지구 데이터 대신 지역 파일을 사용한다. 다운로드한 파일은 `data/osrm/osaka.osm.pbf`에 두며 지도 원본/전처리 그래프는 Git에서 제외된다.

저장소 루트에서 실행:

```sh
mkdir -p data/osrm
# 준비한 지역 파일을 data/osrm/osaka.osm.pbf로 배치한 뒤 전처리한다.
docker run --rm -v "$PWD/data/osrm:/data" ghcr.io/project-osrm/osrm-backend:v26.10.0 osrm-extract -p /opt/foot.lua /data/osaka.osm.pbf
docker run --rm -v "$PWD/data/osrm:/data" ghcr.io/project-osrm/osrm-backend:v26.10.0 osrm-contract /data/osaka.osrm
docker compose -f config/osrm-compose.yaml up -d
source config/osrm_local.sh
python3 backend/server.py
```

전처리 각 단계의 성공을 확인하고 다음 단계로 진행한다. CH를 사용해 거리·시간 행렬을 제공하며 200개 좌표까지 받는다. 기본 포트는 같은 컴퓨터에서만 접속 가능한 `127.0.0.1:5001`이다. 팀 서버에서 앱과 OSRM을 함께 운영하면 이 구성을 그대로 쓴다. 휴대폰은 앱 서버에만 접속하면 된다.

서버를 준비하지 않은 채 백엔드를 실행해도 동작하지만 결과는 **추정 경로**다. 이번 개발 환경에는 Docker 실행 파일이 없어 실제 지도 전처리·OSRM 배포 성공은 아직 확인하지 않았다.

## 실행 확인과 검사

```sh
source config/osrm_local.sh
echo '[{"lat":34.6687,"lng":135.5013},{"lat":34.6675,"lng":135.5031}]' | node scripts/query_walking_route.mjs
python3 scripts/calculate_routes.py
node --test backend/engine/*.test.mjs scripts/test_real_schedule.mjs scripts/test_real_rooms.mjs scripts/test_planning_reasons.mjs
python3 -m unittest discover -s backend -v
```

성공한 실제 서버 조회는 `source: "osrm-foot"`여야 한다. 중단된 서버에서도 JSON과 일정은 반환되며 `distance-estimate` 및 이유가 기록된다. `OSRM_FOOT_URL`을 비우면 외부 요청 없이 추정만 사용한다. Node 24 이상이 필요하며 Python 예제는 필요 시 `NODE_BINARY`를 지정한다.

Python 예제는 Node 실행 실패·시간 초과·잘못된 경로 응답을 traceback 대신 안내 문구로 출력하고 `None`을 반환한다. 중간 구간이 실패하면 전체 합계 계산도 중단해 일부 구간만 계산된 수치를 하루 전체 이동으로 표시하지 않는다.

회귀검사는 OSRM 응답을 대체한 단위/계산 통합 검사와 로컬 HTTP 서버의 헤더·본문 지연 검사로 구성한다. 실제 오사카 도로 데이터 정확도와 배포 검사는 별도다. OSM 경로를 서비스에서 표시할 때 [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright) 출처를 표시한다.

## 근거

- [OSRM 프로필: 전처리 시 모드 결정](https://github.com/Project-OSRM/osrm-backend/blob/master/docs/profiles.md)
- [OSRM HTTP API: Route·Table·단위·오류](https://github.com/Project-OSRM/osrm-backend/blob/master/docs/http.md)
- [OSRM Docker·CH 실행 방법](https://github.com/Project-OSRM/osrm-backend#quick-start)
- [FOSSGIS 공개 서버 정책](https://routing.openstreetmap.de/about.html)
