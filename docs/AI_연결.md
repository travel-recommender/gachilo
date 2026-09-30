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
| 모델 | `gemini-3.5-flash-lite` (`ai.ts` 기본값과 동일) |
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

입력(근거 JSON)은 규칙 엔진이 만든 값만 담는다. **개인별 예산·걸음 수·이름은 넣지 않고
그룹 하한만 넣는다.** 모델이 보지 못한 정보는 새어 나갈 수 없다(기획서 원리 1).

출력은 **자유 문장이 없다.** 모델은 두 가지만 고른다.

```json
{ "ai_added": [{ "id": "shinsekai", "reason_code": "no_one_dislikes" }],
  "summary": ["must_kept", "ai_filled", "options_free"] }
```

- `id` 는 `ai_candidates` 안에서만
- `reason_code` 는 4개 중 하나 — `budget_fits` `no_one_dislikes` `near_fixed` `category_gap`
- `summary` 는 7개 중에서 해당되는 것만 — `must_kept` `ai_filled` `no_room` `budget_limited`
  `options_free` `veto_excluded` `walk_limited`

문장·장소 이름·숫자는 **코드가 템플릿으로 만든다.** 모델이 글자를 쓰지 않으므로
"없는 장소를 말한다", "없는 숫자를 만든다"가 구조적으로 불가능하다.

설명 코드는 근거가 있을 때만 쓸 수 있다. 예를 들어 `ai_filled` 는 실제로 장소를 추가했을
때만, `veto_excluded` 는 거부된 곳이 실제로 있을 때만 통과한다. 모델이 해당되지 않는 코드를
고르면 검증에서 걸러진다.

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
| 후보 밖 장소 | `ai_candidates` 에 없는 id, 중복 추가, `ai_slots` 초과 |
| 예산 | 추가한 곳들의 비용 합이 남은 예산을 넘음 |
| 모르는 코드 | 정의되지 않은 `reason_code` · 설명 코드 (자유 문장은 전부 여기서 걸린다) |
| 근거 없는 설명 | 코드 자체는 맞지만 이번 결과에 해당하지 않음 (`ai_filled` 인데 추가한 곳이 없는 등) |
| 빈 출력 | `summary` 가 비어 있음 |

### 2.3 실패 상황별 확인 결과

`node ai_fallback_check.mjs` — 키 없이 돌아간다.

```
결과 나옴(옵션 없음) · 정상 응답          · AI 사용 (ok)
결과 나옴(옵션 없음) · JSON이 깨져서 옴    · AI 건너뜀
결과 나옴(옵션 없음) · 없는 장소를 지어냄  · AI 건너뜀 (검증 실패)
결과 나옴(옵션 없음) · 자유 문장을 씀      · AI 건너뜀 (검증 실패)
결과 나옴(옵션 없음) · 응답이 없어 시간 초과 · AI 건너뜀
결과 나옴(옵션 없음) · 키가 없음           · AI 건너뜀
결과 나옴(옵션 없음) · 주소가 틀림         · AI 건너뜀
결과 나옴(옵션 없음) · 키가 틀림           · AI 건너뜀
```

모든 줄에서 결과가 나오고, **옵션 장소가 그룹 일정에 섞이지 않는 것**까지 함께 본다.
`enrich()` 는 `core` 만 돌려주고, 실패하면 규칙의 `res.core` 를 그대로 쓴다.

운영 중에는 `AI_DEBUG=1` 로 매 호출의 사용 여부·사유·소요 시간이 로그에 한 줄 남는다.

---

## 3. 검사 스크립트

`node ai_check.mjs` — 키가 없으면 근거 JSON과 검사기만, 키가 있으면 같은 입력으로 3회 호출한다.

검사기가 거부해야 하는 출력 5종을 함께 확인한다.

```
거부함 · 없는 장소            — 후보 밖 장소: kyoto_tower
거부함 · 자유 문장(없는 장소)  — 알 수 없는 설명 코드
거부함 · 자유 문장(지어낸 가격) — 알 수 없는 설명 코드
거부함 · 근거 없는 설명        — 근거가 없는 설명 (ai_filled)
거부함 · 모르는 이유 코드      — 알 수 없는 이유 코드
```

3회 호출 결과는 키를 가진 사람이 돌려서 PR에 붙인다. 6주차에는 모델을 바꿔가며
같은 검사를 돌려 프롬프트가 모델에 의존하지 않는지 확인한다.

## 4. 남은 일

- 장소 데이터가 150곳으로 바뀌면 `popularity`가 없어 AI 후보 점수(`fit_avg`)가 무너진다 → `docs/검토_알고리즘_결과형식.md` 참고
- AI가 날짜 배열까지 맡을지 (지금은 규칙이 배열)
- `alternatives`(예산을 올리면 무엇이 들어오는지) 출력 추가 — API 계약 5장 미결 항목
