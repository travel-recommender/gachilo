# 서버 API 계약

> 작성일: 2026.09.27 · 초안 / 수정: 2026.09.30 (#22 조은 리뷰 반영)
> 참고: 윤진 「AI 입출력 형식 및 프롬프트 설계」(4차 회의록), 조은 「장소 데이터 형식」(4차 회의록), 조은 `docs/place_data_dictionary.md`·`docs/week5_data_api_notes.md`(#24)
> 상태: **검토 필요** — 장소·비용 부분은 조은 검토 반영, AI 출력 부분은 윤진 확인 전

이 문서는 두 부분으로 나뉜다.

- **A. 현재 계약 (v0)** — #24 서버(`backend/server.py`)가 **지금 실제로** 동작하는 형식. #25 프론트는 이것에 붙는다.
- **B. 목표 계약 (v1)** — 2단계 선택·후보 풀·결과 화면을 위해 **앞으로** 추가할 형식. v0를 깨지 않고 하나씩 붙인다.

프론트 mock은 **이미 있는 기능은 A, 아직 없는 기능은 B**를 기준으로 만든다.

---

## 0. 공통 (v0·v1 모두)

- 요청·응답 `application/json; charset=utf-8`, 본문 64KB 이하
- **계정 로그인 없음. 대신 토큰으로 권한을 확인한다** (0.1)
- 금액은 **원(KRW)**, 거리는 **km**, 시간은 **분**. 장소 원본 `cost`는 엔화(JPY)로 보관하고 **API 경계에서만** 원화로 환산한다 (0.3)
- **null은 "모름"이다.** 0·false·빈 문자열로 바꾸지 않는다 (0.2)

### 0.1 권한 — 토큰 필수

`roomId`·`memberId`는 **주소일 뿐 권한이 아니다.** 방 조회 응답에 다른 사람의 `memberId`가 나오므로, ID만으로 본인 확인을 하면 남의 입력을 조회하거나 덮어쓸 수 있다.

- 방을 만들면 서버가 **방장 토큰 1개(`ownerToken`)와 참여자별 비밀 토큰(`submissionToken`)**을 발급한다. 토큰은 **이 응답에서 한 번만** 나가고, 서버에는 SHA-256 해시만 저장한다.
- 모든 방 관련 요청은 `Authorization: Bearer <토큰>` 헤더를 보낸다.
- 서버 검증 규칙:
  - **본인 전용** (`…/members/:memberId/…`, `…/submissions/:memberId`) — 토큰 해시가 **그 방의 그 `memberId`** 해시와 일치해야 한다. 다른 참여자 토큰·방장 토큰으로는 안 된다.
  - **방장 전용** (결과 계산) — `ownerToken`만 허용
  - **방 공용** (참여 현황·결과 조회) — 그 방의 방장 또는 참여자 토큰
  - 불일치하면 `403`. 방 존재 여부 외에 무엇이 틀렸는지는 알려주지 않는다.
- 토큰은 초대 링크에 실린다(`/join?room=&m=&t=`, #25). **링크는 사람마다 다르고**, 단체방에 하나만 공유하면 서로의 자리에 들어갈 수 있다는 점을 화면에서 안내한다.
- 서버 로그에 토큰·입력값을 남기지 않는다.

### 0.2 null 규칙

조은 데이터 사전(`docs/place_data_dictionary.md`)을 따른다.

| 필드 | null 뜻 | 금지 |
| --- | --- | --- |
| `cost_krw` | 가격 미확인 또는 환율 미설정 | **0원으로 계산 금지.** 예산 합계에서 빼고 "미확인 N곳"으로 따로 센다 |
| `address`, `website`, `area` | 미확인 | 빈 문자열로 대체 금지 |
| `opening_hours` | 미확인 | 24시간 영업으로 간주 금지. 값이 있어도 자유 서술(요일·휴일·접수 마감)이라 `09:00-18:00` 같은 단일 구간으로 자동 변환하지 않는다 |
| `covered` | 실내외 혼합·미확인 | `false`로 간주 금지 |

### 0.3 비용·환율

- 원본 `cost` = **1인 필수 방문 비용(JPY)**. 입장권·기준 메뉴·코스·이용권 가격이며 **평균 총지출이 아니다.** 적용 범위는 `cost_basis`에 있다.
- 환산: `cost_krw = round_half_up(cost × krw_per_jpy)`, **원 단위 정수**
- 환율은 **서버 설정값**(`JPY_TO_KRW` 환경변수, 1 JPY당 KRW)이다. 실시간 시세가 아니다. 응답에 **환율·반올림 방식·기준일·출처**를 함께 싣는다.
- 환율이 설정되지 않으면 유료 장소의 `cost_krw`는 `null`(`cost_status: "exchange_rate_required"`). 원본이 0이면 환율과 상관없이 0.
- **쇼핑 구매비는 계산하지 않는다** (개인차가 커서). 쇼핑 장소는 `cost_krw: null`, `cost_status: "not_applicable_shopping"`이며 **무료가 아니다.** 무료는 `cost_krw: 0` + `cost_status: "known"`이다.

`cost_status` 값:

| 값 | 뜻 | `cost_krw` |
| --- | --- | --- |
| `known` | 가격 확인됨 (0이면 무료) | 정수 |
| `unknown` | 원본 가격 미확인 | null |
| `exchange_rate_required` | 가격은 있으나 서버 환율 미설정 | null |
| `not_applicable_shopping` | 쇼핑 — 구매비는 계산 대상 아님 | null |

### 0.4 장소 필드 — 원본 16개 중 공개 14개

원본은 조은 「장소 데이터 형식」 16개 컬럼이다. API 응답은 **이를 기반으로 한 공개 필드 14개**를 낸다.

- `cost`(JPY) → `cost_krw`(KRW)로 **바꿔서** 낸다
- `opening_hours_source`, `verified_at`은 내부 검증용이라 **빼고** 낸다

| 필드 | 형식 | 비고 |
| --- | --- | --- |
| `place_id` | 문자열 | |
| `name` | 문자열 | 원어명 |
| `name_ko` | 문자열 | |
| `category` | `명소`·`문화`·`자연`·`쇼핑`·`카페`·`식사` | |
| `area` | 문자열 \| null | **오사카시 행정구**(예: `大阪市中央区`). 관광 권역(난바·우메다 등)이 **아니다** — 권역은 별도 매핑 필요(5장) |
| `address` | 문자열 \| null | |
| `latitude`, `longitude` | 숫자 | WGS84 |
| `opening_hours` | 문자열 \| null | 원문 그대로 |
| `cost_krw` | 정수 \| null | 0.3 |
| `stay_min` | 정수 | 체류 분, 이동·대기 제외. 전체 방문 평균값이 아님 |
| `bag_load` | `0`\|`1`\|`2` | **팀 규칙 상대 점수**(kg 아님). 0 증가 없음 · 1 가벼운 쇼핑 · 2 쇼핑 |
| `covered` | 불리언 \| null | **주요 이용 공간**이 실내/지붕인지. 이동 경로의 지붕 여부가 아님 |
| `website` | 문자열 \| null | |

여기에 검토 상태를 알리는 보조 필드를 붙인다. **검증일만 숨기고 무조건 쓸 수 있는 장소처럼 내보내지 않는다.**

| 보조 필드 | 뜻 |
| --- | --- |
| `cost_status` | 0.3 |
| `cost_basis`, `stay_basis` | 가격·체류시간 산정 근거 메모 |
| `planning.schedule_ready` | 일정 생성에 바로 써도 되는지 (현재 150곳 모두 `false`) |
| `planning.review_required` | 남은 검토 사유 목록 (`address_missing`, `hours_not_verified`, `visit_date_hours_review_required` 등) |
| `planning.shopping_spend_excluded` | 쇼핑 구매비 제외 대상인지 |

> **데모 데이터와 섞지 않는다.** 기존 데모 엔진(`GET /places`, 36곳)의 `bagLoad`는 0~1 실수이고, `covered`는 "아케이드로 연결됐는지"라서 뜻이 다르다. 150곳 데이터를 엔진에 넣으려면 변환 규칙을 먼저 정한다(5장). 그 전까지 두 데이터셋은 한 응답·한 계산에 섞지 않는다.

---

## A. 현재 계약 (v0) — #24 서버 기준

경로에 `/api` 접두사가 없다(장소 검색 `/api/places`만 예외). 오류는 `{ "error": "메시지" }` 문자열 하나다.

| 메서드·경로 | 토큰 | 용도 |
| --- | --- | --- |
| `GET /health` | - | 서버 확인 |
| `POST /rooms` | - | 방 만들기 |
| `PUT /rooms/:roomId/submissions/:memberId` | 본인 | 1차·2차·조건 **한 번에** 제출 (다시 내면 덮어씀) |
| `GET /rooms/:roomId/results` | 방 공용 | 제출 현황 + 결과 |
| `POST /rooms/:roomId/calculate` | 방장 | 전원 제출 후 계산 |
| `GET /api/places` | - | 150곳 조회 (0.4 형식) |
| `GET /places` | - | 데모 36곳 (`prototype_demo_36`, 데모 엔진용) |

### A.1 `POST /rooms`

```json
// 요청
{ "startDate": "2026-10-10", "endDate": "2026-10-13", "memberNames": ["혜인", "윤진", "조은"] }
```

```json
// 응답 201 — 토큰은 이 응답에서만 나간다
{
  "roomId": "Qm3…",
  "startDate": "2026-10-10",
  "endDate": "2026-10-13",
  "ownerToken": "…",
  "members": [
    { "id": "a1…", "name": "혜인", "submissionToken": "…" },
    { "id": "b2…", "name": "윤진", "submissionToken": "…" },
    { "id": "c3…", "name": "조은", "submissionToken": "…" }
  ],
  "revision": 0
}
```

기간 1~30일, 인원 2~6명, 이름 1~40자. 프론트는 `nights`를 `startDate`/`endDate`로 환산해 보낸다(#25 `toDateRange`).

### A.2 `PUT /rooms/:roomId/submissions/:memberId`

```
Authorization: Bearer <그 memberId의 submissionToken>
```

```json
{
  "longlist": ["osaka_009", "osaka_001", "osaka_005", "osaka_007", "osaka_022"],
  "picks": ["osaka_009", "osaka_001", "osaka_005"],
  "must": "osaka_009",
  "veto": null,
  "budgetPerDay": 70000,
  "stepLimit": 8000,
  "activeMin": 480
}
```

```json
// 응답 200
{ "saved": true, "memberId": "a1…", "revision": 1 }
```

제출할 때마다 `revision`이 올라가고, 저장된 결과는 무효가 된다.

### A.3 `GET /rooms/:roomId/results`

```json
{ "roomId": "Qm3…", "status": "collecting", "submittedCount": 1, "memberCount": 3, "revision": 1, "result": null }
```

`status`: `collecting` → `awaiting_result`(전원 제출) → `ready`. `result`는 `{ strategy, days: [{ date, placeIds }], summary }`.

### A.4 `POST /rooms/:roomId/calculate` (방장)

`{ "strategy": "average" | "least_misery" | "fairness" }` → A.3과 같은 형식. 전원 제출 전이면 409.

### A.5 `GET /api/places?q=&category=&limit=`

```json
{
  "dataset": "osaka_review_150",
  "total": 1,
  "currency": "KRW",
  "exchange_rate": { "krw_per_jpy": "9.2", "rounding": "ROUND_HALF_UP to integer KRW", "source": "server configuration; not a live quote" },
  "places": [ { "…": "0.4 형식" } ]
}
```

> v0에 없는 것: 환율 **기준일**(`as_of`). v1에서 추가한다(B.3).

---

## B. 목표 계약 (v1) — 추가 예정

v0 규칙(경로 형식, Bearer 토큰, `startDate`/`endDate`)을 **그대로 이어 쓰고**, 없는 기능만 더한다. #25에서 드러난 빈 곳 세 가지가 대상이다.

### B.0 적용 순서 — 조은님과 합의 필요

1. **#24 머지** — v0 서버·150곳 조회가 main에 들어간다
2. **#25 base를 main으로** — 프론트가 v0에 붙는다 (방 만들기·초대 링크·제출·현황)
3. **v1-a: 1차 제출 + 후보 풀** (B.2·B.4·B.5) — 2단계 선택 흐름을 서버로 옮긴다 (#25 발견 1·2)
4. **v1-b: 결과 응답 확장** (B.7) — 코어/옵션·시간표·AI 설명 (#25 발견 3). 150곳 `bag_load`·`covered` 변환 규칙이 정해진 뒤
5. **v1-c: 오류 형식·단계(phase) 통일** (B.1) — 프론트 오류 처리를 한 번에 바꾼다

각 단계는 **서버 + `web/src/lib/room-api.ts`를 한 PR에서 같이** 바꾸고, v0 엔드포인트는 프론트가 모두 옮겨갈 때까지 남긴다.

### B.1 단계(phase)와 오류 형식

```
created → longlist → shortlist → conditions → done
```

전원이 그 단계를 마치면 서버가 다음 단계로 넘긴다. 프론트는 B.2의 `phase`를 보고 화면을 정한다.

```json
{ "error": { "code": "PHASE_MISMATCH", "message": "아직 1차 선택이 끝나지 않았어요." } }
```

| 코드 | 상태 | 뜻 |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | 필수 값 누락·개수 초과 |
| `UNAUTHORIZED` | 401 | 토큰 없음 |
| `FORBIDDEN` | 403 | 토큰이 그 방·그 참여자 것이 아님 |
| `ROOM_NOT_FOUND` | 404 | 없는 방 |
| `PHASE_MISMATCH` | 409 | 지금 단계에서 할 수 없는 요청 |
| `RESULT_NOT_READY` | 409 | 전원 입력 전에 결과 조회 |

### B.2 `GET /rooms/:roomId` — 방 정보·참여 현황 (방 공용 토큰)

```json
{
  "roomId": "Qm3…",
  "phase": "longlist",
  "startDate": "2026-10-10",
  "endDate": "2026-10-13",
  "days": 4,
  "members": [
    { "id": "a1…", "name": "혜인", "done": true },
    { "id": "b2…", "name": "윤진", "done": false }
  ],
  "doneCount": 1,
  "memberCount": 2
}
```

**토큰은 절대 싣지 않는다.** `done`은 현재 단계를 마쳤는지만 알린다. 여기 나온 `id`로는 아무것도 할 수 없다(0.1).

### B.3 `GET /api/places` — v0에 기준일 추가

```json
{
  "dataset": "osaka_review_150",
  "currency": "KRW",
  "exchange_rate": {
    "krw_per_jpy": "9.2",
    "rounding": "ROUND_HALF_UP to integer KRW",
    "as_of": "2026-09-29",
    "source": "팀 고정값 (출처: 서버 설정 JPY_TO_KRW_SOURCE)"
  },
  "places": [
    {
      "place_id": "osaka_009",
      "name": "大阪城",
      "name_ko": "오사카성",
      "category": "문화",
      "area": "大阪市中央区",
      "address": "大阪府大阪市中央区大阪城1-1",
      "latitude": 34.6863,
      "longitude": 135.5255,
      "opening_hours": "09:00-18:00 (최종입장 17:30)",
      "cost_krw": 11040,
      "stay_min": 120,
      "bag_load": 0,
      "covered": null,
      "website": "https://www.osakacastle.net/",
      "cost_status": "known",
      "cost_basis": "…",
      "stay_basis": "…",
      "planning": { "schedule_ready": false, "review_required": ["visit_date_hours_review_required"], "shopping_spend_excluded": false }
    },
    {
      "place_id": "osaka_021",
      "name": "高島屋",
      "name_ko": "다카시마야 오사카점",
      "category": "쇼핑",
      "area": "大阪市中央区",
      "address": "大阪市中央区難波5丁目1番5号",
      "latitude": 34.6646,
      "longitude": 135.5018,
      "opening_hours": "10:00-20:00 (일부 매장 상이)",
      "cost_krw": null,
      "stay_min": 180,
      "bag_load": 2,
      "covered": null,
      "website": "https://www.takashimaya.co.jp/osaka",
      "cost_status": "not_applicable_shopping",
      "cost_basis": null,
      "stay_basis": "…",
      "planning": { "schedule_ready": false, "review_required": ["hours_not_verified", "visit_date_hours_review_required"], "shopping_spend_excluded": true }
    }
  ]
}
```

(값은 형식 예시다. 환율 9.2는 가정값)

### B.4 `PUT /rooms/:roomId/members/:memberId/longlist` — 1차 제출 (본인 토큰)

```json
{ "placeIds": ["osaka_009", "osaka_001", "osaka_005", "osaka_007", "custom_Qm3_01"] }
```

```json
{ "ok": true, "doneCount": 2, "memberCount": 3, "phase": "longlist" }
```

전원이 내면 `phase`가 `shortlist`로 바뀐다.

### B.5 `GET /rooms/:roomId/pool` — 2차 후보 풀 (방 공용 토큰)

```json
{
  "phase": "shortlist",
  "pool": [
    { "place_id": "osaka_009", "name_ko": "오사카성", "category": "문화", "area": "大阪市中央区",
      "cost_krw": 11040, "cost_status": "known", "stay_min": 120, "covered": null, "overlap_count": 3 }
  ]
}
```

`overlap_count`는 **몇 명이 올렸는지**만 알린다. 누가 올렸는지는 없다(윤진 AI 문서와 같은 이름·같은 뜻).

### B.6 `PUT /rooms/:roomId/members/:memberId/submission` — 2차 선택 + 조건 (본인 토큰)

```json
{
  "picks": ["osaka_009", "osaka_001", "osaka_005", "osaka_007", "osaka_022"],
  "must": "osaka_009",
  "veto": null,
  "budgetPerDay": 70000,
  "stepLimit": 8000,
  "activeMin": 480
}
```

```json
{ "ok": true, "doneCount": 3, "memberCount": 3, "phase": "done" }
```

- `picks` 5개, `must`는 `picks` 중 1개, `veto`는 0~1개이고 `picks`에 넣을 수 없다
- 조건 세 값은 **하루 기준**이고 이름은 v0와 같다(`activeMin`은 분). 전체 예산은 서버가 `budgetPerDay × days`로 환산한다

본인 입력 조회는 `GET` 같은 경로로 하고, **본인 토큰일 때만** 돌려준다(새로고침·재접속 복원용).

### B.7 `GET /rooms/:roomId/result` — 결과 (방 공용 토큰)

전원이 B.6을 마쳐야 200이다. 그 전에는 `409 RESULT_NOT_READY`.

```json
{
  "core": [
    { "place_id": "osaka_009", "name_ko": "오사카성", "overlap_count": 3,
      "must_of_anonymous": true, "ai_added": false, "cost_krw": 11040, "cost_status": "known" }
  ],
  "options": [
    { "place_id": "osaka_004", "name_ko": "아메리카무라", "participant_count": 2,
      "cost_krw": null, "cost_status": "not_applicable_shopping" }
  ],
  "excluded": [
    { "place_id": "osaka_021", "name_ko": "다카시마야 오사카점", "reason": "veto" }
  ],
  "schedule": [
    { "date": "2026-10-10",
      "items": [
        { "place_id": "osaka_001", "name_ko": "도톤보리 글리코 사인", "start_min": 540, "end_min": 660,
          "type": "core", "move_km": 0, "move_min": 0 }
      ],
      "walk_km": 3.1, "total_km": 5.2, "total_move_min": 43,
      "cost_krw": 73000, "unknown_cost_count": 1, "shopping_excluded_count": 1 }
  ],
  "budget_basis": { "known_count": 9, "unknown_count": 2, "shopping_excluded_count": 1, "exchange_rate_as_of": "2026-09-29" },
  "explanation": "다섯 분의 '꼭 가고 싶은 곳'은 모두 지켰어요. ...",
  "alternatives": [
    { "condition": "1인 하루 예산을 80,000원으로 올리면", "effect": "명소 2곳이 더 들어올 수 있지만 5명 중 2명이 부담스러워해요." }
  ],
  "budget_check": { "per_person_krw": 620000, "exceeds_limit_for_n_members": 0 },
  "stamina_check": { "total_km": 24.4, "avg_daily_km": 6.1, "exceeds_limit_for_n_members": 0 }
}
```

- **`must_of_anonymous`**: 누군가의 '꼭'이라는 사실만 알리고 누구인지는 내보내지 않는다. `options`도 이름 대신 `participant_count`만 낸다.
- **예산 합계(`cost_krw`, `per_person_krw`)는 가격을 확인한 장소만 더한 값이다.** 미확인·쇼핑 제외 개수를 `unknown_cost_count`·`budget_basis`로 함께 내보내고, 화면은 "가격 미확인 N곳 제외"를 표시한다.
- `explanation`·`alternatives`·`budget_check`·`stamina_check` 4개는 **윤진 AI 출력 스키마를 그대로** 받는다 — **윤진 확인 전**.

### B.8 `POST /rooms/:roomId/places` — 장소 직접 추가 (방 공용 토큰)

검색에 없는 곳을 추가하고, **그 방 안에서만** 후보로 쓴다.

```json
{ "name_ko": "도톤보리 기자미야", "category": "식사", "area": "大阪市中央区", "cost_krw": 15000, "stay_min": 60 }
```

```json
{ "place_id": "custom_Qm3_01", "custom": true, "latitude": 34.6687, "longitude": 135.5013,
  "cost_status": "known", "bag_load": 0, "covered": null, "address": null, "opening_hours": null }
```

- 입력하지 않은 값은 **null로 둔다.** 추측으로 채우지 않는다(`stay_min`만 카테고리 기본값)
- 좌표는 행정구 중심값을 빌려 쓴다. **동선이 대략값이 된다는 점을 프론트가 표시한다**

---

## 비공개 원칙 — API 레벨에서 강제 (v0·v1)

**어떤 응답도 "누가 무엇을 골랐는지"를 내보내지 않는다.** 겹친 사람 수(`overlap_count`)만 내보낸다.
본인 입력은 **본인 토큰**으로 요청할 때만 돌려준다. `memberId`를 안다고 볼 수 있는 게 아니다. 이건 UI 규칙이 아니라 서버 규칙이다.

## AI 연동 — 서버 안쪽

프론트는 AI를 직접 호출하지 않는다. 결과 조회 안에서 서버가 처리한다.

```
규칙 엔진(코어/옵션 확정) → AI 입력 조립 → 모델 호출 1회 → 출력 검증 → 결과 응답
```

- **API 키는 서버 환경변수에만 둔다.** 프론트 번들에 들어가면 안 된다.
- AI 입력·출력 스키마와 System Prompt는 윤진 「AI 입출력 형식 및 프롬프트 설계」를 따른다.
- 조건값은 AI에 넘길 때 **이름 없는 숫자 배열로 셔플**해서 넘긴다(같은 문서 2.1).
- AI 출력은 **제안**이므로 서버가 재검증한다(같은 문서 5장). 검증에 실패하면 코어만으로 결과를 만든다.
  **즉 AI가 죽어도 결과 조회는 200을 돌려준다.**

## 프론트 mock

- 이미 v0에 있는 기능(방 만들기·제출·현황): **A의 형식**으로 붙는다
- 아직 없는 기능(1차 대기·후보 풀·결과 화면): **B의 예시 JSON**을 고정 mock으로 두고, 해당 v1 단계가 머지되면 호출만 바꾼다

---

## 5. 미결 — 회의에서 정할 것

- [ ] **B.0 적용 순서** (조은·혜인)
- [ ] **150곳 → 엔진 변환 규칙**: `bag_load` 0/1/2 ↔ 데모 `bagLoad` 0~1, `covered` 의미 차이. 엔진을 바꿀지 변환할지 (조은)
- [ ] **환율 고정값·기준일·출처** 확정, `as_of` 필드 추가 (조은)
- [ ] **관광 권역 매핑**: 행정구 `area` → 난바·우메다 등 권역. 필요한지, 누가 만들지
- [ ] 경로 접두사 통일 (`/rooms`와 `/api/places` 혼재)
- [ ] `alternatives` 개수: 1개만 vs 최대 3개 (윤진 문서 6장에도 같은 항목)
- [ ] 방장만 로그인할지 (3차 회의 「방을 만드는 사람은 로그인」) — 지금은 토큰 방식, 계정 없음
- [ ] 사용자 추가 장소를 그 방에서만 쓸지, 전체 데이터로 승격할지
- [ ] 결과 확정 후 재조정(한 번 더 체크)을 API로 열지
- [ ] 참여 현황 폴링 주기 (#25는 3초)
