# 6주차 공용 결과 API — 프론트 연결용

2026-10-07 구현안. 조은 서버 담당 / 혜인 P7·P8 연결 검토 / 윤진 AI 근거 검토.
사용자 결정: 방장이 후보를 확정하고 전원이 같은 결과를 본다. 우선 데모 36곳으로 연결을 검증한다.
실제 150곳의 세 전략·데이터 검증 완료를 뜻하지 않는다. 이 문서의 추가 계약은 PR 리뷰에서 팀이 확인한다.

## 연결 순서

1. 기존 경로로 참여자가 각자 입력을 제출한다. 전원은 `GET /rooms/{id}/results`를 3초 간격으로 조회한다.
2. `status=awaiting_result`이고 방장인 경우에만 현재 `revision`으로 아래 후보 묶음 계산을 호출한다.
3. `calculating` 또는 HTTP 202이면 조회를 계속한다. 결과는 후보 3개가 모두 완성된 뒤 한 번에 저장된다.
4. `awaiting_selection`이면 P7이 서버 `candidates`를 표시한다. 기기에서 다시 `buildConsensus/buildSchedule`을 실행하거나 예시 동행자 입력을 합치지 않는다.
5. 방장이 `PUT /selection`으로 확정하면 `ready`가 된다. 전원 P8은 `selectedStrategy`에 해당하는 **서버 candidate**의 `days/items`만 표시한다.
6. 참여자가 다시 제출하면 `revision` 증가, 후보·확정 결과가 모두 무효화된다. 이전 버전 화면·늦게 도착한 응답을 버리고 다시 조회한다.

계산 실패 503일 때는 오류와 재시도 버튼을 표시한다. 자동 계산은 방장 화면에서 **revision당 한 번만** 시도하고 실패를 매 폴링마다 재호출하지 않는다. 같은 revision의 중복 요청은 서버에서도 실행 중 202 / 완료 후 캐시 200으로 처리한다.

## 계산 (방장 토큰)

```http
POST /rooms/{id}/calculate
Authorization: Bearer <ownerToken>
Content-Type: application/json

{"strategies":["average","least_misery","fairness"],"revision":3}
```

전략 배열은 위 순서·3개 그대로. 전원 제출 전이나 낡은 revision은 409, 참여자 토큰은 403이다.
현재 `prototype_demo_36`만 지원한다. `osaka_review_150` 방은 400으로 명확히 거절하며 기존 `{ "strategy":"average" }` 경로를 계속 쓴다. 같은 결과를 세 전략으로 복사하지 않는다.

## 현황·결과 (해당 방 참여자 또는 방장 토큰)

```http
GET /rooms/{id}/results
Authorization: Bearer <submissionToken 또는 ownerToken>
```

아래 숫자는 **형식 설명용 예시**다. 서버는 세 전략을 모두 반환한다.

```json
{
  "dataset": "prototype_demo_36",
  "roomId": "example",
  "status": "awaiting_selection",
  "submittedCount": 3,
  "memberCount": 3,
  "revision": 3,
  "selectionVersion": 0,
  "selectedStrategy": null,
  "result": null,
  "candidates": [
    {
      "strategy": "average",
      "metrics": {"walkStepsPerDay": 2000, "costKrwPerDay": 20000, "totalKmPerDay": 4.5},
      "days": [{
        "date": "2026-10-07",
        "placeIds": ["glico"],
        "items": [{"placeId":"glico","aiAdded":false,"filled":false,"source":"selected","reasonCode":null,"reason":null}],
        "metrics": {"walkSteps": 2000, "costKrw": 20000, "totalKm": 4.5}
      }],
      "summary": "평균 전략의 시연용 후보입니다.",
      "explanationSource": "rules"
    }
  ]
}
```

실제 응답 `candidates`는 0개 또는 3개다. 예시에서는 반복을 생략했다.

| 상태 | 화면 동작 |
|---|---|
| collecting | 참여 현황 표시 |
| awaiting_result | 방장만 해당 revision 계산, 참여자는 기다림 |
| calculating | 전원 조회만 계속 |
| awaiting_selection | P7 후보 3개, 방장만 확정 |
| ready | 전원 동일한 확정 후보를 P8에 표시 |
| draft | 기존 실제 150곳 모드의 검토용 결과, 이번 3후보 흐름과 분리 |

`result`는 호환을 위해 기존 `{strategy,days:[{date,placeIds}],summary}` 형태를 유지한다. 묶음 계산 후 확정 전에는 null이다. P8의 배지·근거·지표는 `candidates`의 확정 후보에서 읽는다.

## 후보 확정·변경 (방장 토큰)

```http
PUT /rooms/{id}/selection
Authorization: Bearer <ownerToken>
Content-Type: application/json

{"revision":3,"selectionVersion":0,"strategy":"fairness"}
```

응답은 위 현황 형식이며 `selectedStrategy=fairness`, `selectionVersion=1`, `status=ready`와 `result`가 들어간다.
같은 후보 재전송은 버전을 늘리지 않는다. 다른 후보로 변경하려면 최신 `selectionVersion`이 필요하다(충돌 409 → 재조회). 참여자 확정은 403.
이번 계약은 **후보 선택·재선택만 공유**한다. P8 장소 삭제·추가·드래그 순서를 기기마다 따로 저장해 확정 결과처럼 보이면 다시 달라지므로, 서버 연결 화면에서는 그 편집 기능을 잠그거나 별도 편집 API 합의 전까지 미리보기로 명시한다.

## 지표·근거 의미

- `walkStepsPerDay`: 최종 각 날짜의 추정 도보 km를 0.7m 보폭으로 환산한 걸음 수의 일평균. 기기 걸음 센서 값이 아니다.
- `costKrwPerDay`: 최종 일정의 장소 비용(식사 보완 포함) **1인·1일 평균 KRW**. 데모 가격이며 교통·숙박·개인 쇼핑비는 포함하지 않는다. 실제 150곳 JPY를 여기 섞지 않는다.
- `totalKmPerDay`: 도보·대중교통을 합친 장소 간 추정 이동 거리의 일평균 km. 출발·귀가·숙소 동선은 포함하지 않는다.
- 날짜별 지표는 `days[].metrics`. 비어 있는 날도 여행 일수에 포함한다. 평균값은 모든 날의 개인 한도 충족을 뜻하지 않는다.
- 장소 순서는 `days[].items` 및 동일 순서의 `placeIds`. `aiAdded`는 합의 단계 자동 보완, `filled`는 식사 시간 보완이다.
- **규칙 보완을 실제 AI 호출로 표시하지 않는다.** `source=rule_added/meal_fill`은 규칙 추천, `source=ai_added`만 AI 추천이다. `selected`는 선택 장소이며 개인 선택자 정보는 공개하지 않는다.
- `reasonCode/reason`은 최종 장소의 공개 근거다. `participants`, `mustOf`, 개인 점수·입력·예산은 응답에서 제외한다.
- `explanationSource=ai`이면 #37의 검증된 설명, `rules`이면 규칙 설명이다. #37 미병합·키 없음·AI 실패 시에도 규칙 후보 3개가 나온다. AI 내부 오류와 키는 응답에 넣지 않는다.

## 프론트에서 바로 사용할 모듈

`web/src/lib/shared-results-api.ts`의 `createSharedResultClient`와 `selectedCandidate`를 사용한다.
기존 `room-api.ts`와 P7/P8/store는 혜인 작업과 충돌하지 않도록 이 PR에서 바꾸지 않았다.

```ts
const api = createSharedResultClient(process.env.NEXT_PUBLIC_API_BASE_URL!);
const snapshot = await api.get(roomId, myToken);
// 전원 제출 후 방장, revision당 한 번
const candidates = await api.calculateAll(roomId, ownerToken, snapshot.revision);
// 방장 확정 버튼
const selected = await api.select(roomId, ownerToken, candidates, "fairness");
const finalPlan = selectedCandidate(selected);
```

## 검사 및 3대 기기 리허설

자동 검사: 독립 참여자 토큰 3개로 저장된 후보·확정 결과 일치, 재조회/DB 재연결, 권한, 동시 계산 1회, 입력 변경·오래된 계산·후보 변경 충돌, AI 오류 fallback, 응답 비공개 필드 제외.

실기기 완료 조건(팀이 직접 확인):

1. 세 기기가 같은 서버와 같은 방에 접속한다. 휴대폰에서 `127.0.0.1`은 노트북 주소가 아니므로 API 주소·서버 origin을 실제 프론트에 맞춘다.
2. 각자 서로 다른 장소·조건을 제출하고 3/3 표시를 확인한다.
3. 세 기기의 revision과 세 후보가 같고, 방장만 확정할 수 있는지 확인한다.
4. 방장이 공정성 확정 → 세 기기 모두 같은 날짜·장소 순서·근거 표시.
5. 한 기기 새로고침·재접속 후 동일 결과 복원. 다른 사람이 수정 제출하면 전부 이전 결과 무효화.
6. 네트워크 오류·중복 클릭 시 다른 결과가 생기지 않는지 확인한다.

이 체크리스트는 아직 수행 완료가 아니다. #36 초대 오류 수정, 실제 서비스 화면 연결, 실제 데이터 검증은 별도 남은 작업이다.
