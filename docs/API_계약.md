# 서버 API 계약

> 작성일: 2026.09.27 · 초안
> 참고: 윤진 「AI 입출력 형식 및 프롬프트 설계」(4차 회의록), 조은 「장소 데이터 형식」(4차 회의록)
> 상태: **검토 필요** — 조은·윤진 확인 후 확정

프론트는 이 문서만 보고 mock을 만들고, 백엔드는 이 문서대로 구현한다.
**서버가 완성되기 전에도 프론트가 진행할 수 있게 하는 것이 이 문서의 목적이다.**

---

## 0. 공통

- Base URL: `/api`
- 요청·응답 모두 `application/json; charset=utf-8`
- **로그인 없음.** 방을 만든 사람도, 들어온 사람도 계정이 필요 없다.
  방은 `roomId`로, 개인은 `memberId`로 구분한다. 링크를 아는 사람이 참여자다.
- 금액 단위는 **원(KRW)**, 거리는 **km**, 시간은 **분**으로 통일한다.
  (장소 데이터의 `cost`는 엔화지만, API 경계에서 원화로 환산해 내보낸다.)

### 오류 형식

```json
{ "error": { "code": "ROOM_NOT_FOUND", "message": "방을 찾을 수 없어요." } }
```

| 코드 | 상태 | 뜻 |
| --- | --- | --- |
| `ROOM_NOT_FOUND` | 404 | 없는 방 |
| `MEMBER_NOT_FOUND` | 404 | 그 방에 없는 참여자 |
| `PHASE_MISMATCH` | 409 | 지금 단계에서 할 수 없는 요청 (예: 1차가 안 끝났는데 2차 제출) |
| `VALIDATION_FAILED` | 400 | 필수 값 누락·개수 초과 |
| `RESULT_NOT_READY` | 409 | 전원 입력 전에 결과 조회 |

### 비공개 원칙 — API 레벨에서 강제

**어떤 응답도 "누가 무엇을 골랐는지"를 내보내지 않는다.** 겹친 사람 수(`overlap_count`)만 내보낸다.
본인 입력은 본인 `memberId`로 조회할 때만 돌려준다. 이건 UI 규칙이 아니라 서버 규칙이다.

---

## 1. 단계(phase)

방은 아래 순서로만 움직인다. 각 API는 맞는 단계에서만 동작한다.

```
created → longlist → shortlist → conditions → done
   방 생성      1차 검색      2차 선택      조건 입력     결과
```

전원이 그 단계를 마치면 서버가 다음 단계로 넘긴다. 프론트는 `GET /rooms/:roomId`의 `phase`를 보고 화면을 정한다.

---

## 2. 엔드포인트

### 2.1 `POST /api/rooms` — 방 만들기

```json
// 요청
{ "destination": "오사카", "nights": 3, "memberNames": ["혜인", "윤진", "조은"] }
```

```json
// 응답 201
{
  "roomId": "r_8fk2p",
  "inviteUrl": "https://.../join/r_8fk2p",
  "phase": "longlist",
  "destination": "오사카",
  "nights": 3,
  "days": 4,
  "members": [
    { "memberId": "m_01", "name": "혜인" },
    { "memberId": "m_02", "name": "윤진" },
    { "memberId": "m_03", "name": "조은" }
  ]
}
```

`nights` 최대 6 (3차 회의 「6박 7일 최대」). 인원 2~6명.

### 2.2 `GET /api/rooms/:roomId` — 방 정보·참여 현황

```json
// 응답 200
{
  "roomId": "r_8fk2p",
  "phase": "longlist",
  "destination": "오사카",
  "nights": 3,
  "days": 4,
  "members": [
    { "memberId": "m_01", "name": "혜인", "done": true },
    { "memberId": "m_02", "name": "윤진", "done": false },
    { "memberId": "m_03", "name": "조은", "done": false }
  ],
  "doneCount": 1,
  "memberCount": 3
}
```

`done`은 **현재 단계를 마쳤는지**만 알려준다. 무엇을 골랐는지는 내보내지 않는다.
대기 화면은 이 응답을 주기적으로 조회한다.

### 2.3 `GET /api/places` — 장소 검색 (1차 화면)

```
GET /api/places?q=오사카성&category=명소&limit=20
```

```json
// 응답 200
{
  "places": [
    {
      "place_id": "osaka_castle",
      "name": "大阪城",
      "name_ko": "오사카성",
      "category": "문화",
      "area": "오사카성·텐마바시",
      "address": "大阪市中央区大阪城1-1",
      "latitude": 34.6873,
      "longitude": 135.5262,
      "opening_hours": "09:00-18:00",
      "cost_krw": 8000,
      "stay_min": 90,
      "bag_load": 0,
      "covered": false,
      "website": "https://..."
    }
  ]
}
```

필드는 **조은님 장소 데이터 형식 16개 컬럼을 그대로** 쓴다. 단 `cost`는 엔화라
API에서는 `cost_krw`로 환산해 내보낸다(환율 기준은 백엔드가 고정값으로 보유).
`opening_hours_source`·`verified_at`은 내부 검증용이라 응답에 넣지 않는다.

### 2.4 `POST /api/rooms/:roomId/places` — 장소 직접 추가

검색에 없는 곳을 사용자가 추가한다. **그 방 안에서만** 후보가 된다.

```json
// 요청
{ "name_ko": "도톤보리 기자미야", "category": "식사", "area": "난바", "cost_krw": 15000, "stay_min": 60 }
```

```json
// 응답 201
{ "place_id": "custom_r8fk2p_01", "custom": true, "latitude": 34.6687, "longitude": 135.5013, "...": "나머지는 카테고리 기본값" }
```

좌표는 `area` 중심값을 빌려 쓴다. **동선이 대략값이 된다는 점을 프론트가 표시한다.**

### 2.5 `PUT /api/rooms/:roomId/members/:memberId/longlist` — 1차 제출

```json
// 요청
{ "placeIds": ["osaka_castle", "dotonbori", "kuromon", "umeda_sky", "custom_r8fk2p_01"] }
```

```json
// 응답 200
{ "ok": true, "doneCount": 2, "memberCount": 3, "phase": "longlist" }
```

전원이 내면 응답의 `phase`가 `shortlist`로 바뀐다.

### 2.6 `GET /api/rooms/:roomId/pool` — 2차 후보 풀

```json
// 응답 200
{
  "phase": "shortlist",
  "pool": [
    { "place_id": "osaka_castle", "name_ko": "오사카성", "category": "문화", "area": "오사카성·텐마바시",
      "cost_krw": 8000, "stay_min": 90, "covered": false, "overlap_count": 3 }
  ]
}
```

`overlap_count`는 **몇 명이 올렸는지**만. 누가 올렸는지는 없다.
(윤진님 AI 문서의 `overlap_count`와 같은 이름·같은 뜻이다.)

### 2.7 `PUT /api/rooms/:roomId/members/:memberId/submission` — 2차 선택 + 조건

```json
// 요청
{
  "picks": ["osaka_castle", "dotonbori", "kuromon", "umeda_sky", "nakazaki"],
  "must": "osaka_castle",
  "veto": "usj",
  "conditions": { "daily_budget_krw": 70000, "daily_steps": 8000, "daily_activity_hours": 8 }
}
```

```json
// 응답 200
{ "ok": true, "doneCount": 3, "memberCount": 3, "phase": "done" }
```

- `picks` 5개, `must`는 `picks` 중 1개, `veto`는 0~1개
- `conditions` 세 값은 **하루 기준**이다. 전체 예산은 서버가 `daily_budget_krw × days`로 환산한다.
- 프로토타입의 `budgetPerDay` / `stepLimit` / `activeMin`에 각각 대응한다.
  (`daily_activity_hours`는 시간 단위. 서버가 분으로 환산)

### 2.8 `GET /api/rooms/:roomId/result` — 결과 조회

전원이 2.7을 마쳐야 200이 나온다. 그 전에는 `409 RESULT_NOT_READY`.

```json
// 응답 200
{
  "core": [
    { "place_id": "osaka_castle", "name_ko": "오사카성", "overlap_count": 3,
      "must_of_anonymous": true, "ai_added": false, "cost_krw": 8000 }
  ],
  "options": [
    { "place_id": "amemura", "name_ko": "아메리카무라", "participant_count": 2, "cost_krw": 25000 }
  ],
  "excluded": [
    { "place_id": "usj", "name_ko": "유니버설 스튜디오", "reason": "veto" }
  ],
  "schedule": [
    { "day": 1,
      "items": [
        { "place_id": "dotonbori", "name_ko": "도톤보리", "start_min": 540, "end_min": 600,
          "type": "core", "move_km": 0, "move_min": 0 }
      ],
      "walk_km": 3.1, "total_km": 5.2, "total_move_min": 43, "cost_krw": 73000 }
  ],
  "explanation": "다섯 분의 '꼭 가고 싶은 곳'은 모두 지켰어요. ...",
  "alternatives": [
    { "condition": "1인 하루 예산을 80,000원으로 올리면", "effect": "명소 2곳이 더 들어올 수 있지만 5명 중 2명이 부담스러워해요." }
  ],
  "budget_check": { "per_person_krw": 620000, "exceeds_limit_for_n_members": 0 },
  "stamina_check": { "total_km": 24.4, "avg_daily_km": 6.1, "exceeds_limit_for_n_members": 0 }
}
```

**`must_of_anonymous`**: 누군가의 '꼭'이라는 사실만 알리고 **누구인지는 내보내지 않는다.**
`options`도 참여자 이름 대신 `participant_count`만 낸다.
`explanation` 아래 4개 필드는 **윤진님 AI 출력 스키마를 그대로** 받는다.

### 2.9 `GET /api/rooms/:roomId/members/:memberId/submission` — 내 입력 조회

새로고침·재접속 시 본인 입력을 복원한다. **본인 것만** 돌려준다.

---

## 3. AI 연동 — 서버 안쪽

프론트는 AI를 직접 호출하지 않는다. `GET /result` 안에서 서버가 처리한다.

```
규칙 엔진(코어/옵션 확정) → AI 입력 조립 → 모델 호출 1회 → 출력 검증 → /result 응답
```

- **API 키는 서버 환경변수에만 둔다.** 프론트 번들에 들어가면 안 된다.
- AI 입력·출력 스키마와 System Prompt는 윤진님 「AI 입출력 형식 및 프롬프트 설계」를 따른다.
- `conditions`는 AI에 넘길 때 **이름 없는 숫자 배열로 셔플**해서 넘긴다(같은 문서 2.1).
- AI 출력은 **제안**이므로 서버가 재검증한다(같은 문서 5장). 검증 실패 시 코어만으로 결과를 만든다.
  **즉 AI가 죽어도 `/result`는 200을 돌려준다.**

---

## 4. 프론트가 mock으로 먼저 붙이는 방법

2장의 응답 예시를 그대로 고정 JSON으로 두고 화면을 만든다.
서버가 나오면 호출 주소만 바꾼다. 필드 이름이 같으므로 화면 코드는 고치지 않는다.

---

## 5. 미결 — 회의에서 정할 것

- [ ] `alternatives` 개수: 1개만 vs 최대 3개 (윤진님 문서 6장에도 같은 항목)
- [ ] 방장만 로그인 방식으로 갈지 (3차 회의 「방을 만드는 사람은 로그인」) — 지금 초안은 전원 로그인 없음
- [ ] 사용자 추가 장소를 그 방에서만 쓸지, 전체 장소 데이터로 승격할지
- [ ] 결과 확정 후 재조정(한 번 더 체크)을 API로 열지
- [ ] 참여 현황 실시간 반영 방식: 폴링 주기 몇 초로 할지
