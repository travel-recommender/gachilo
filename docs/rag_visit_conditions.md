# RAG 방문 조건 안내 — 실시간 조회·출처 관리

관련: [이슈 #6](https://github.com/travel-recommender/gachilo/issues/6) 「RAG 방문 조건 안내 — 역할 분담안」. 역할·적용 범위는 팀 논의 후 확정한다.

일정에 담긴 장소의 **휴무·영업시간·예약 조건**을 출처와 확인 시각을 붙여 보여준다.
이번 범위는 근거를 **찾아서 그대로 보여주는 것**까지다. AI 답변 문장은 만들지 않는다.

- 근거 안에서 답하는 규칙과 출처 일치 검증은 윤진 담당이다.
- 조은의 출처·확인 시각·적용 기간 관리는 `visit_evidence.mjs`로 연결한다. 기존 자료를 구조화하며 새로 웹 검증한 것으로 간주하지 않는다.
- 이 결과로 장소를 일정에 넣거나 빼지 않는다. 일정 배치 검사는 기존 엔진이 그대로 한다.

## 흐름

1. P8 일정 화면 아래 「○월 ○일 방문 조건」에서 **휴무·예약 확인** 버튼을 누른다.
   - 실시간 조회는 유료 요청이라 일정을 넘겨 볼 때마다 부르지 않고, 누를 때만 부른다.
   - 실제 장소 방(`osaka_review_150`)에서만 보인다.
2. 웹은 `POST /rooms/{roomId}/visit-conditions`를 부른다. 본문은 `{"placeIds":[...], "dates":["YYYY-MM-DD"]}`이다.
   - 방 참여자 토큰이 있어야 한다.
   - 장소는 1~30곳, 날짜는 1~7개이고, 날짜는 여행 기간 안이어야 한다.
3. 서버는 `backend/engine/visit_conditions.mjs`를 실행한다.
   - **검토 자료**: `availability()`로 그날 휴무인지, 일정에 넣는 구간, 입장 예약·방문 전 확인·검토 기간 밖 같은 조건을 읽는다.
     - 실제 영업·입장 시간은 카탈로그 `opening_hours` 문장을 그대로 `openingHours`로 준다.
     - 일정 엔진의 `window`는 `scheduleHours`("일정에 넣는 시간")로 따로 준다. 점심 가격·심야 할증 같은 가격 조건 때문에 실제 영업보다 좁을 수 있어서(예: 카니도라쿠 영업 11–23시, 일정 11–16시) **영업시간이라고 부르지 않는다**. 그렇게 정한 조건은 `costBasis`로 함께 준다.
     - `scheduleHours[].latestStart`는 입장 마감이 아니라 방문을 시작하는 마지막 시각이다.
   - **실시간 조회**: `live_check.mjs`(Google Places, 하루 캐시)로 그날 영업이 검토 자료와 같은지 다시 확인한다.
     - 대상은 검토 자료상 휴무가 아닌 날 전부다. 예약이 필요한 곳도 갈 수는 있으므로 조회한다.
   - **출처**: 프로필의 `source_urls`(운영 정보)와 카탈로그 `field_sources`(영업시간·공식 사이트) URL과 확인일을 모은다.
     - OSM에서 온 값은 "지도 정보"로 표시하고 공식 출처라고 부르지 않는다.

## 상태

| status | 뜻 |
| --- | --- |
| `confirmed` | 검토 자료에 걸리는 조건이 없고, 실시간 조회에서도 영업이 확인됨 |
| `check` | 예약 필요, 방문 전 확인, 검토 기간 밖, 실시간 시간 변경, 조회 실패·불가 중 하나 |
| `closed` | 검토 자료상 휴무이거나, 실시간 조회에서 폐업·임시휴업·그날 휴무로 나옴 |

| live | 뜻 |
| --- | --- |
| `confirmed` | 실시간 영업시간이 일정에 넣는 시간을 모두 덮음 |
| `changed` | 영업시간이 검토 자료와 다름 |
| `closed` | 실시간 조회상 그날 못 감 |
| `failed` | 조회했지만 확인 못 함 (매칭 실패·시간 정보 없음 등). 변경과 구분한다 |
| `unavailable` | 키가 없거나 오류로 조회 자체를 못 함. 검토 자료와 출처는 그대로 보여준다 |
| `not_checked` | 검토 자료로 이미 갈 수 없는 날이라 조회하지 않음 |

## 화면에서 지키는 것

- 장소마다 상태 칩, 영업시간(검토 자료 문장), 일정에 넣는 시간과 그 조건, 검토 자료 안내, 실시간 조회 한 줄, 출처 링크를 보여준다.
  - 출처 링크에는 사이트 이름과 확인일을 붙인다. 확인일이 없으면 "확인일 기록 없음"이라고 쓴다.
- 출처가 하나도 없으면 "방문 전에 직접 확인해 주세요"로 안내한다.
- 응답은 웹에서 다시 검사한다(`decodeVisitConditions`).
  - 요청한 방·장소·날짜와 맞지 않거나, 알 수 없는 상태, http(s)가 아닌 링크가 있으면 받지 않는다.
- 조회 실패는 오류 문구와 **다시 확인하기** 버튼으로 안내한다. 자동으로 다시 시도하지 않는다.
  - 실시간 조회 실패·불가는 HTTP 200 안에 `live=failed/unavailable`로 온다. 이때도 검토 자료는 그대로 두고 **실시간 조회 다시 확인하기** 버튼을 보여준다.
- 누른 기록은 지금 보고 있는 방·날짜·장소 묶음에만 남긴다. 다른 날로 넘겼다가 돌아오면 다시 눌러야 조회한다(누르지 않은 날짜 이동만으로 유료 요청이 나가지 않게).
- 실험 모드(`NEXT_PUBLIC_EXPERIMENT_MODE=1`)에서는 패널을 그리지 않는다.

## 남은 것 (팀 논의 후)

- 윤진: 이 근거만으로 답하는 AI 안내 문장 규칙과 출처 일치 검증 → 응답에 답변 필드를 더한다.
- 조은: 아래 자료 관리 구현의 리뷰·main 병합. 출처 미확인·오래된 자료를 실제 사이트에서 재검증하는 수집 작업은 별도다.

## 검사

Node **24 이상**과 Python **3.10 이상**을 사용한다. Node 16은 TypeScript 직접 import를 지원하지 않는다. 웹 계약 검사에서 Node가 타입만 제거하고 실행할 수 있도록 `./visit-evidence.ts` 확장자를 명시하고 `allowImportingTsExtensions`를 사용한다. Next가 파일을 변환하므로 브라우저 URL 계약 변경은 없다.

```sh
node --test backend/engine/visit_conditions.test.mjs
cd backend && python3 -m unittest test_server.ApiTests.test_visit_conditions_gives_reviewed_and_live_status_with_sources_for_room_members_only
cd web && node --test _test/visit-conditions.test.ts
```

로컬 확인은 `LIVE_CHECK_MOCK=pass`로 했다. 실제 Google 키로 하는 확인은 아직 하지 않았다.


## 자료·출처·날짜 관리 (조은, 이슈 #6)

`backend/engine/visit_evidence.mjs`는 서버가 실제로 읽는 catalog/profiles에서 자료를 만든다. 환경변수로 실험 동결 데이터를 사용하면 그 데이터에서 그대로 읽으며, 별도의 최신 카탈로그를 섞지 않는다. 브랜드가 같아도 다른 지점의 URL·날짜를 복사하지 않는다.

- `place.evidence`: `schemaVersion=1`, 정확한 `placeId`, 평가일 `evaluatedOn`, 재확인 정책 `maxAgeDays=30`, 자료 목록 `entries`.
- 자료별 `id`, 항목 `field`, 기록된 `value`, 원래 `sourceKind`, URL별 `sources[].kind`, `checkedAt`, `checkedPrecision`, `validFrom/validThrough`, `freshness`, `state`, `note`를 보존한다.
- 날짜별 `day.evidenceCheck`: 적용 후보 ID, 사용 가능한 근거 ID, 충돌 ID, 확인 필요 사유. 현재 API 계약에 필드를 추가하며 기존 응답도 웹에서 읽을 수 있다.
- 화면의 **자료별 출처·확인일·적용 기간**에서 상세 내역을 확인한다. 여러 항목이 같은 URL을 참조해도 각 확인일을 합치지 않는다.

### 날짜와 자료 신뢰도

`evaluatedOn`은 자료의 오래됨을 계산한 일본 날짜이며 실제 웹 조회일이 아니다. `checkedAt`에 날짜만 있으면 `checkedPrecision=day`; 시각을 임의로 붙이지 않는다. 개별 확인일이 없으면 `null/unknown`을 유지한다. 수입일, `place.verified_at`, 프로필 파일 전체의 `checked_at`은 개별 확인일로 대체하지 않는다.

30일은 재확인을 안내하는 관리 기준이지 그 기간 영업을 보장하는 기준이 아니다. 하루 단위로 30일 초과는 `stale`, 미래 확인일은 `future`다. 테스트나 별도 수집 도구는 `evidencePolicy`로 평가일·임계값을 명시할 수 있지만 HTTP 요청자가 정책을 바꾸지는 못한다.

운영 프로필은 전체 검토 기간과 지점 검토 기간의 교집합을 사용하고, 양 끝 날짜를 포함한다. 날짜별 예외는 해당 날짜에만 적용한다. 일반 영업시간 문장·가격의 적용 기간이 원자료에 없으면 프로필 기간을 임의로 붙이지 않는다. 확인일·적용 기간·실시간 Google 조회는 서로 다른 정보다.

명시적으로 공식 자료로 분류된 출처와, 검토한 지점의 공식 사이트 도메인에 연결된 지점 자료만 `official`로 표시한다. OSM/Google 지도는 `map`, 사용자 보고는 `manual`, 그 외는 `reviewed`다. 운영사가 아닌 입점사 등의 교차 확인 URL은 `reviewed_urls`에 명시하여 `reviewed`로 구분할 수 있다. 이 필드는 공식으로 승격하지 않으며, note에 각 출처의 역할을 남긴다. 이 분류는 기존 기록의 출처 유형이며 이번 실행이 사이트 진위를 새로 검증했다는 뜻은 아니다. URL은 http(s)만 허용하며 인증정보가 포함된 URL은 제외한다.

### 이전 자료와 충돌 관리

`field_sources.<field>.previous`는 `superseded`로 보존하고 현재 주장과 충돌로 처리하지 않는다. 같은 항목에 아직 해결되지 않은 복수의 자료가 있으면 해당 장소의 `review.visit_evidence`에 다음처럼 추가한다. 자료 수집자가 장소·내용·출처를 확인한 뒤 커밋하며, HTTP 요청으로 임의 근거를 넣는 기능은 없다.

```json
{
  "place_id": "branch_example",
  "field": "opening_hours",
  "value": "10:00–20:00",
  "kind": "official_web_review",
  "urls": ["https://example.org/branch"],
  "checked_at": "2026-11-18T10:30:00+09:00",
  "valid_from": "2026-11-01",
  "valid_through": "2026-11-30",
  "state": "current"
}
```

허용 항목: `opening_hours`, `cost`, `website`, `operating_rules`, `operating_exception`, `reservation`. `place_id`가 다른 지점이면 거부한다. 같은 운영 항목에서 적용 기간이 겹치고 값이 다르면 **잠재적 충돌**로 보류하며 더 최근 값을 자동 채택하지 않는다. 표현만 다른 경우도 포함할 수 있으므로 사람이 검토한다. 수정이 확정되면 이전 자료를 `superseded`로 바꾸고 새 확인일·범위를 기록한다.

`usableEvidenceIds`는 현재 자료·공식 출처·기록된 최신 확인일·방문일을 포함하는 명시적 적용 기간·충돌 없음이 모두 충족되는 근거만 담는다. `applicableEvidenceIds`에는 기간이 미확인인 참고 자료도 포함될 수 있다. AI 답변 담당은 이 둘을 구분하고 ID와 URL을 답변에 연결해야 한다. 이 PR은 자유 문장 생성이나 의미 기반 충돌 판별을 구현하지 않는다.

### 기존 동작과의 경계

자료 부족·오래됨·확인일 미상 등 관리 사유는 `evidenceCheck`와 펼침 영역에 남기고 기존 `day.status`를 내리지 않는다. 따라서 실시간 영업 확인이 성공하면 원래의 `confirmed`를 유지할 수 있지만, 근거 자체나 요금·예약까지 최신이라고 승격하지 않는다. 실제 근거 충돌(`evidence_conflict`) 또는 잘못된 근거(`evidence_invalid`)일 때만 한 줄 경고와 `check`를 추가한다. 장소별 근거 생성 오류는 빈 entries와 `evidence_invalid`로 격리하여 다른 장소 응답을 보존한다. 감사 스크립트는 잘못된 자료에서 계속 실패하여 수집 단계에서 잡는다. 이미 `closed`인 결과는 유지한다. 이 경고로 `schedule_ready`·추천 엔진·장소 선택 가능 여부를 바꾸지 않는다. 실험 모드의 패널 비활성화도 유지한다. 자료 텍스트는 참고 데이터이며 AI나 프로그램에 실행할 명령으로 전달하면 안 된다.

### 오프라인 감사

```sh
node scripts/audit_visit_evidence.mjs 2026-11-18 2026-11-19 > evidence-audit.json
node --test backend/engine/visit_evidence.test.mjs backend/engine/visit_conditions.test.mjs
node --test web/_test/visit-conditions.test.ts
```

첫 날짜는 평가일, 둘째는 방문일이다. 유료 호출·웹 수집·원본 수정 없이 모든 장소의 링크와 보완 사유를 출력한다. 2026-11-18 main 카탈로그 기준 238곳을 읽었으며 204곳에 공식 유형 링크(현재 또는 보존된 과거 자료)가 있다. 이는 204곳의 영업 조건이 최신 확인됐다는 뜻이 아니다. 미확인·오래된 항목은 감사 결과대로 보류한다.


### 검토 기간과 화면 호환성

현재 프로필 검토 종료일은 2026-11-30이다. 가상 여행 11/16~19는 범위 안이지만, 12월 시연은 별도 재검증·새 프로필이 필요하다. 근거 표시를 개선한다고 이 기간을 연장하지 않는다. 기간 밖이라는 기존 availability 안내는 유지하고 근거의 중복 사유는 상세 영역에서만 보여준다.

기존 출처 링크·확인일은 펼치지 않아도 보인다. 자료별 이유와 보존 기록은 펼침 영역으로 분리하며 운영 규칙 객체는 안내 요약으로 표시한다. `profilesCheckedAt`은 기존 API 클라이언트 호환용 전역 메타데이터로 유지하지만, 개별 출처 확인일로 표시하거나 AI 근거로 사용하지 않는다.
