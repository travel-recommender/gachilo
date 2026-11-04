# 실제 장소 방 — AI 빈자리 채우기와 실시간 영업 확인

`dataset=osaka_review_150` 방의 세 후보 계산(`real_candidates.mjs`)에 두 단계를 더한다. 단일 전략 호환 경로 `real.mjs`는 바꾸지 않는다.

## 1. 실시간 영업 확인 (`backend/engine/live_check.mjs`)

엑셀(검토 JSON)의 운영 조건 검사를 통과한 장소·날짜마다 Google Places API(New)로 한 번 더 확인한다. **배치되는 모든 장소**(선택·My list·AI 추가)에 적용한다.

- 통과 조건: `businessStatus=OPERATIONAL`이고, 그날 영업시간이 데이터의 운영 창(시작~끝)을 모두 덮는다.
- 여행일이 오늘(일본 시간)부터 7일 안이면 특별 휴무가 반영된 `currentOpeningHours`, 그 뒤면 `regularOpeningHours`로 대조한다.
- 실패 사유: 폐업, 임시 휴업, 그날 휴무, 영업시간 변경, 영업시간 정보 없음, 지도에서 같은 장소를 찾지 못함(좌표 150m 밖), 조회 실패. **하나라도 실패하면 넣지 않는다.** 미배치 사유는 `live_*` 코드로 집계된다.
- Google ID는 `data/google_place_links.json`에서 먼저 찾는다. 없으면 이름으로 검색하고, 그래도 안 되면 이름+주소로 검색한다. 이름+주소로 검색하면 Google이 장소 대신 주소 자체(大阪城 → `大阪城１−１`)를 돌려주는 경우가 있어서 이름 검색을 먼저 한다. 주소 결과는 제외하고, 이름이 정확히 같은 결과를 거리보다 먼저 고른다. 오사카성 근처에는 오사카성 공원이 바로 붙어 있어서다. ID와 당일 조회 결과는 `backend/.local/live_places.json`(gitignore)에 저장하고, 영업 정보는 24시간 동안만 재사용한다. 키는 저장하지 않고, 리디렉트는 따라가지 않으며, 재시도하지 않는다.
- `GOOGLE_PLACES_API_KEY`가 없으면 일정을 만들지 않고 503으로 키 설정을 안내한다.
- **유료 호출**: 처음 계산할 때 장소당 Text Search 1회와 Details 1회가 나간다. 같은 날 다시 계산하면 캐시를 쓴다.
- 결과가 Google 데이터에 따라 날마다 달라질 수 있다. 요약에 조회 날짜를 적는다.

## 2. AI 빈자리 채우기 (`backend/engine/real_ai.mjs`)

구성원의 장소(선택·My list)로 pace 자리를 다 못 채운 날만, **아무도 담지 않은** 150곳 중에서 채운다.

1. 코드가 후보 10곳을 만든다. 여행일 중 하루라도 엑셀 검사를 통과하고, 하루 예산 안이며, 모든 구성원의 적합도가 0.2 이상인 곳이다. 적합도는 각자 담은 장소 유형, 예산 비중, 긴 체류에 대한 체력 부담으로 계산한다.
2. 꼭 가기로 꼽혔지만 어느 날에도 넣을 수 없는 곳(휴무·실시간 확인 실패)이 있으면, 같은 유형이고 1.5km 안인 곳을 `similar_to_must`로 먼저 둔다.
3. 후보도 실시간 확인을 통과한 곳만 남긴다.
4. 솜솜AI가 후보 중에서 순서와 이유 코드(`similar_to_must`·`group_taste`·`budget_fits`)를 고른다. 모델에는 구성원 ID·개인 한도를 보내지 않는다. 목록 밖 장소, 근거 없는 이유 코드, 자리 수 초과, 중복이 있으면 응답을 버린다.
5. 모델이 꺼져 있거나 응답이 검증에 실패하면 규칙 순서를 쓰고 `source=rule_added`로 표시한다. 모델이 고른 곳은 `ai_added`다.
6. 어느 쪽이든 날짜별 운영·예산·걸음·활동시간 검사(`validateDay`)를 통과해야 들어간다. 문장은 코드 템플릿으로 만든다.

`planning`에 `live_check`(`source`, `checked_on`, `failed_place_count`)와 `ai_fill`(`source`, `added_count`)을 추가했다.

## 검사

```sh
node --test backend/engine/*.test.mjs
cd backend && python3 -m unittest
```

기존 검사는 실시간 확인을 모두 통과로, AI 채우기는 끈 상태로 실행해 이전 동작을 그대로 확인한다(`LIVE_CHECK_MOCK=pass`, `deps.choose=null`). 새 검사는 `real_ai_live.test.mjs`에 있다. Google 응답은 가짜 fetch로 검사했고, **실제 Google 호출은 아직 하지 않았다.**
