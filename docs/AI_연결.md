# AI 연결 — 호출 예시와 fallback 경로

> 5주차 이슈 #1 「AI 연결(윤진)」 산출물
> 코드: `backend/engine/ai.ts` · 점검: `backend/engine/ai_check.mjs`, `backend/engine/ai_fallback_check.mjs`
> 이 문서의 1장은 설계 문서 「AI 입출력 형식 및 프롬프트 설계」 4.3을 대체한다.

---

## 1. 호출 예시 (4.3 대체)

### 1.1 무엇을 쓰는가

동덕여대 **솜솜AI API Gateway**를 쓴다. OpenAI 호환 형식이라 SDK나 요청 형식을 그대로 쓸 수 있고, 별도 결제가 필요 없다.

| 항목 | 값 |
| --- | --- |
| Base URL | `https://factchat-cloud.mindlogic.ai/v1/gateway` |
| 경로 | `POST /chat/completions/` |
| 인증 | `Authorization: Bearer <SOMSOM_API_KEY>` |
| 모델 | `gemini-3.5-flash-lite` (기본값) |
| 속도 제한 | 회원당 60초에 120건 |

모델 목록은 `GET /v1/gateway/models/`로 확인한다. 우리 작업은 후보 10곳 중에서 고르고 문장 두세 개를 쓰는 일이라 가벼운 모델로 충분하다. 실제로 1회 호출에 **약 1.7초**가 걸린다.

키는 **서버 환경변수에만** 둔다. 코드나 저장소에 넣지 않는다.

```
SOMSOM_API_KEY    필수. 없으면 AI를 건너뛰고 규칙 결과로 응답한다
SOMSOM_MODEL      기본 gemini-3.5-flash-lite
SOMSOM_BASE_URL   기본 https://factchat-cloud.mindlogic.ai/v1/gateway
AI_TIMEOUT_MS     기본 12000
```

### 1.2 요청

논문 2.3 구조를 그대로 따른다. ① System Role, ② 구조화된 Input, ③ JSON 강제, ④ Few-shot 1개, ⑤ `task` 필드로 의도 분기.

```ts
const r = await fetch(`${base}/chat/completions/`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.SOMSOM_API_KEY}`,
  },
  body: JSON.stringify({
    model,
    temperature: 0,
    max_tokens: 1200,
    response_format: { type: "json_object" },   // JSON만 뱉게 강제
    messages: [
      { role: "system",    content: SYSTEM_PROMPT },        // ① 역할·규칙
      { role: "user",      content: JSON.stringify(SHOT_IN) },   // ④ few-shot 입력
      { role: "assistant", content: JSON.stringify(SHOT_OUT) },  // ④ few-shot 정답
      { role: "user",      content: JSON.stringify(evidence) },  // ② 이번 근거 JSON
    ],
  }),
});
const data = await r.json();
const text = data.choices?.[0]?.message?.content ?? "";
```

few-shot은 **대화가 아니라 같은 요청 안의 예시**다. 사용자는 이 존재를 모르고, 호출은 방 하나당 1회뿐이다.

### 1.3 입출력

입력(근거 JSON)은 규칙 엔진이 만든 값만 담는다. **개인별 예산·걸음 수·이름은 넣지 않고 그룹 하한만 넣는다.** 모델이 보지 못한 정보는 문장으로 새어 나갈 수 없다(기획서 원리 1). 5인 3박4일 기준 약 4,000자다.

```json
{
  "task": "plan",
  "trip": { "city": "오사카", "days": 4, "members": 3 },
  "group_limits": { "budget_per_person_won": 280000, "remaining_budget_won": 153000,
                    "walk_km_per_day": 4.9, "active_min_per_day": 360 },
  "ai_slots": 1,
  "fixed": [ { "id": "umeda_sky", "tier": "core", "reason": "must", "votes": 2, ... } ],
  "ai_candidates": [ { "id": "shinsekai", "fit_min": 0.35, "fit_avg": 0.41, ... } ],
  "excluded": [ { "id": "usj", "reason": "veto" } ],
  "area_km": { "난바|우메다": 3.6 }
}
```

출력은 JSON 하나다.

```json
{ "ai_added": [{ "id": "shinsekai", "reason": "..." }], "summary": ["...", "..."] }
```

문장 안에서 장소는 이름 대신 `{{id}}`로 쓰게 하고, 이름은 코드가 넣는다. 없는 장소를 지어내면 치환 단계에서 바로 드러난다.

### 1.4 붙는 자리

```
POST /rooms/{id}/calculate
  → server.py → engine.py → engine/run.mjs
      buildConsensus()            규칙: 꼭·거부·겹침·예산·체력으로 코어/옵션 확정
      enrich()                    ← AI: 근거 JSON → 모델 1회 → 검증 → 병합
      buildSchedule()             규칙: 시간 배치·동선·식사 채우기
  → 결과 저장 → GET /rooms/{id}/results
```

결과 JSON 스키마(`strategy` / `days` / `summary`)는 바꾸지 않았다. AI 설명은 `summary`에, AI가 추가한 장소는 `days[].placeIds`에 들어간다. 그래서 서버의 저장 검증 코드를 건드리지 않는다.

이번 주 AI는 **장소 추가와 설명**만 맡는다. 날짜별 배열·시간·동선은 기존 `schedule.ts`가 그대로 계산한다.

---

## 2. Fallback 경로

### 2.1 원칙

**AI가 어떤 식으로 실패해도 `/results`는 결과를 돌려준다.** AI 출력은 확정이 아니라 제안이고, 채택은 규칙이 이미 끝냈기 때문에 AI 없이도 일정은 완성되어 있다.

`enrich()`는 **예외를 밖으로 던지지 않는다.** 실패하면 규칙 결과와 규칙 문장을 그대로 반환한다.

```
모델 호출
  ├ 실패(네트워크·타임아웃·인증·속도제한) ─┐
  ├ JSON 파싱 실패 ───────────────────────┤
  ├ 스키마 불일치 ────────────────────────┼→ AI 출력 버림 → 규칙 결과로 응답
  ├ 검증 실패(없는 장소·지어낸 숫자 등) ──┘
  └ 통과 → AI가 고른 장소를 selections에 병합, summary를 AI 문장으로 교체
```

재시도는 하지 않는다. `temperature: 0`이라 같은 입력에 같은 실패가 반복될 가능성이 높고, 사용자를 기다리게 하는 비용이 더 크다.

### 2.2 검증에서 잡는 것

| 구분 | 내용 |
| --- | --- |
| 후보 밖 장소 | `ai_candidates`에 없는 id, 중복 추가, `ai_slots` 초과 |
| 예산 | 추가한 곳들의 비용 합이 남은 예산을 넘음 |
| 없는 장소·지역 | 문장 속 `{{id}}`가 입력에 없음, 입력에 없는 장소 이름·지역명 |
| 지어낸 숫자 | 입력에 없는 숫자 (`68,000원`, `5만 7천원` 형태까지 환산해서 비교) |
| 근거 없는 정보 | 평점·리뷰·미슐랭·웨이팅·날씨, `미도스지선으로 이동` 같은 교통 노선 |
| 개인 지칭 | `빠듯한 분`, `체력이 약한` 등 (원리 1 위반) |
| 내부 용어 노출 | `ai_slots`처럼 입력 JSON 필드 이름이 문장에 그대로 나옴 |

### 2.3 실패 상황별 확인 결과

`node ai_fallback_check.mjs` — 키 없이 돌아간다.

```
결과 나옴 · 정상 응답          · AI 사용 (ok)
결과 나옴 · JSON이 깨져서 옴    · AI 건너뜀 (Unexpected end of JSON input)
결과 나옴 · 없는 장소를 지어냄  · AI 건너뜀 (검증 실패) — 후보 밖 장소: kyoto_tower
결과 나옴 · 응답이 없어 시간 초과 · AI 건너뜀
결과 나옴 · 키가 없음           · AI 건너뜀 (SOMSOM_API_KEY 없음)
결과 나옴 · 주소가 틀림         · AI 건너뜀 (fetch failed)
결과 나옴 · 키가 틀림           · AI 건너뜀
```

모든 줄이 "결과 나옴"이어야 통과다. 실패 사유 문구는 환경에 따라 조금씩 다르게 나온다.

운영 중에는 `AI_DEBUG=1`을 켜면 매 호출의 사용 여부·사유·소요 시간이 서버 로그에 한 줄 남는다.

```
{"used":true,"reason":"ok","added":["shinsekai"],"errors":[],"ms":1704}
```

---

## 3. 같은 입력 3회 — 사실 오류 0건

`node ai_check.mjs`, 모델 `gemini-3.5-flash-lite`, 3인 3박4일 입력.

| 회차 | 소요 | 사실 오류 | AI 추가 |
| --- | --- | --- | --- |
| 1 | 1704ms | 0건 | shinsekai |
| 2 | 1778ms | 0건 | shinsekai |
| 3 | 1733ms | 0건 | shinsekai |

세 번 모두 같은 장소를 골랐다. 6주차에는 모델을 바꿔가며(가벼운 모델 / 무거운 모델) 같은 검사를 돌려, 프롬프트가 모델에 의존하지 않는지 확인한다.

---

## 4. 남은 일

- 장소 데이터가 150곳으로 바뀌면 `popularity`가 없어 AI 후보 점수(`fit_avg`)가 무너진다 → `docs/검토_알고리즘_결과형식.md` 참고
- AI가 날짜 배열까지 맡을지 (지금은 규칙이 배열)
- `alternatives`(예산을 올리면 무엇이 들어오는지) 출력 추가 — API 계약 5장 미결 항목
