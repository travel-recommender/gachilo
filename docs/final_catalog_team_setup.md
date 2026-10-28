# 최종 205곳 테스트본 실행

기존 150곳과 추가 지점 55곳을 같은 서비스 카탈로그에 연결했다. #49의 수집 원장만 있는 상태에서는 검색되지 않았지만 이 브랜치는 서버 기본 경로·계산 엔진·웹 페이지 로딩까지 함께 바꾼다. `osaka_review_150`은 기존 방과의 호환 ID이며 150개 제한이 아니다.

## 코드 받기

작업 중인 파일은 먼저 확인하고, 저장할 변경이 있으면 본인이 커밋하거나 별도 작업 폴더를 사용한다. DB·`.env.local`을 지우지 않는다. 실행 중인 자신의 서버/웹 터미널은 Ctrl+C로 중지한다.

```sh
git status --short
git fetch origin
git switch feat/final-place-catalog
git pull --ff-only origin feat/final-place-catalog
```

첫 전환 때 원격 브랜치를 자동 인식하지 못하면 `git switch --track origin/feat/final-place-catalog`를 사용한다. PR 병합 전에는 main에서 추가 데이터가 보이지 않는 것이 정상이다. 병합 후에는 최신 main으로 실행할 수 있다.

## 서버 — 터미널 1

Node.js 24 이상과 Python 3.10 이상이 필요하다. 저장소 최상위에서:

```sh
unset REAL_CATALOG_PATH REAL_PROFILES_PATH
source config/hana_20260930.sh
cd backend
python3 server.py
```

환경변수 해제는 과거 개인 경로 설정을 없애기 위한 것이다. 기본값은 저장소에 포함된 `data/runtime_catalog.json`이며 Python API와 Node 계산이 같은 파일을 읽는다. 환율 파일은 2026-09-30 하나은행 고시의 **시연용 고정 스냅샷**이다. 현재 환율로 자동 갱신되는 기능은 아니다. 실제 도보 OSRM을 쓰려면 기존 서버를 먼저 실행하고 서버 시작 전에 `source config/osrm_local.sh`도 실행한다. OSRM을 설정하지 않거나 연결이 실패하면 추정 경로로 동작한다.

## 웹 — 터미널 2

저장소 최상위에서:

```sh
cd web
npm ci
npm run dev
```

`web/.env.local`에서 기존 지도 키는 유지한다. 다음 설정이 다른 시연 포트/36곳을 가리키고 있으면 아래 값으로 맞춘 뒤 웹을 재시작한다.

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
NEXT_PUBLIC_DATASET=osaka_review_150
```

접속 주소는 **http://localhost:3000/** 이다. 정적 빌드/배포본을 사용했다면 `npm run build`로 다시 빌드해야 한다. 각 팀원의 localhost는 각자 컴퓨터의 서버이므로 조은 컴퓨터만 수정해도 다른 컴퓨터가 자동으로 바뀌지는 않는다.

## 반영 확인

1. `http://127.0.0.1:8000/api/places?limit=150`에서 `total: 205`, `next_offset: 150`을 확인한다. 첫 페이지 150개, 다음 페이지 55개다.
2. 새 방을 만든 후 P3에서 `이치란 아베노`·`이치란 신사이바시`를 각각 검색한다. `이치란`은 7곳이 나온다.
3. 두 참여자가 서로 다른 신규 지점을 담고 P4의 공동 목록에 모이는지 확인한다. 새로 추가한 지점을 포함해 입력을 제출하면 세 후보와 방장 확정 결과에 사용된다.
4. 예전 방의 저장 결과는 자동 변경하지 않는다. 기존 결과를 다시 보았다면 입력을 다시 제출해 새 revision으로 계산한다. 기존 36곳 방은 계속 36곳이다.

## 자동 일정의 범위

205곳 모두 검색되지만 모든 곳이 자동 배치되는 것은 아니다. 신규 55곳 중 **51곳은 2026-10-26~2026-11-30의 날짜 조건 검사를 통과하는 경우 시연 일정에 사용**한다. 4곳(girls mignon 신사이바시, petit mignon 다이마루 신사이바시, 와나카 센니치마에·도톤보리)은 근거 부족으로 자동 배치 보류다. 기존 제외 9곳은 검색에 이유를 표시하고 새 선택을 막는다.

좌표는 점포/건물 지도 기준점이며 실측 출입구가 아니다. 체류·짐·같은 건물 이동은 표시된 시연 추정이며, 후쿠타로 우메다 가격은 공식 평균예산 추정이다. 휴일·분리 영업시간·입장권 조건·검토 기간·예산·활동 한도는 계산 때 다시 검사한다. 모든 장소에 대한 production `schedule_ready` 확정을 의미하지 않는다.

검토 근거와 재생성: [data/final/README.md](../data/final/README.md). 원본 수집표·기존 보완 3건 제안은 보존한다.

## 자동 검사

```sh
python3 -m unittest discover -s backend -p 'test_*.py'
python3 scripts/test_final_catalog.py
python3 scripts/test_final_catalog_flow.py
node --test backend/engine/*.test.mjs scripts/test_verified_branches.mjs scripts/test_runtime_catalog.mjs scripts/test_real_schedule.mjs
node --test web/_test/*.test.ts web/_test/search.test.mjs
```

흐름 검사는 임시 DB에서 기본 경로 205곳 검색·P3 공동 풀·신규 지점의 세 전략 배치·보류 지점 제외·방장 확정·참여자 동일 결과·DB 재조회를 검사한다. 유료 AI/지도 호출을 사용하지 않는다.


## 10/28 리뷰·최신 main 통합

#56의 날짜별 일정 가능 목록과 P3 목록 채우기/날짜 분배를 함께 유지합니다.
API·schedulable·계산 엔진이 모두 같은 205곳 runtime manifest를 읽습니다.
P3에서는 전체 205곳을 검색하며, 방문일에 사용할 수 없는 곳은 사유를 표시하고 선택을 막습니다.
목록은 40곳씩 더 보기로 렌더링하므로 뒤쪽 지점도 접근할 수 있습니다.
원래 이름/브랜드 검색은 searchNames 하나로 통합했습니다. 쇼핑 구매액은 '구매액 제외'로 표시합니다.
제외된 장소가 있는 과거 입력은 DB에서 지우지 않습니다. 해당 장소를 목록에서 제거하고 다시 제출하세요.


10/28 최신 main 통합 검사: 백엔드 79개, 엔진/일정 123개, 웹/검색 92개, production build/타입 검사 및 205곳 HTTP 공동 결과 흐름 통과. 독립 Chrome 시험방(11/4~11/7)에서 205곳 목록, 더 보기 40→80, 이치란 7지점, 아베노 지점 선택 및 제외 장소 비활성화를 확인했다.
