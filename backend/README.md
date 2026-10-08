# 5주차 백엔드와 추천 연결 초안

6주차 P7/P8 연결용 후보 묶음 계산·방장 확정 API와 프론트 클라이언트를 추가했습니다. 새 요청·응답, 지표 단위, 3대 기기 시험 순서는 [공용 결과 API 문서](../docs/week6_shared_results_api.md)를 참조하세요. 기존 단일 전략 요청은 유지합니다.

[5주차 이슈](https://github.com/travel-recommender/travel-recommender/issues/1)를 기준으로 만든 로컬 통합 초안입니다. 방 생성 → 참여자별 입력 저장 → 기존 프로토타입 계산 → 결과 저장·조회가 연결되어 있습니다. `backend/public`에 로컬 연결 확인 화면을 제공합니다. 기존 두 단계 Next.js 화면은 팀의 별도 작업입니다. 2026-09-30부터 아래의 실제 장소 모드를 추가했습니다.

## 실행

Python 3.10 이상과 Node.js 24 이상이 필요합니다. 별도 Python/npm 패키지는 필요 없습니다. Node가 PATH에 없으면 `NODE_BINARY`로 실행 파일을 지정하세요. 시작할 때 버전을 확인하며, Node 24 미만이면 필요한 버전을 안내하고 종료합니다.

```sh
cd backend
python3 server.py
```

브라우저에서 `http://127.0.0.1:8000`을 열면 연결 확인 화면이 나옵니다.

1. 날짜와 동행자 2~6명을 입력해 여행방을 만듭니다.
2. 생성 직후 개인별 초대 링크와 방장 복구 링크를 보관합니다. 각 참여자는 자기 링크를 열어 가고 싶은 곳과 예산·걸음 수·활동시간을 저장합니다.
3. 전원 입력 후 추천 기준을 선택하고 ‘일정 계산하기’를 누릅니다.
4. 참여 현황·저장된 결과가 자동 갱신됩니다. ‘현황 다시 확인’으로 바로 읽을 수도 있습니다.
5. 한 사람의 입력을 수정하면 이전 결과는 무효화되며 재계산할 수 있습니다.

6주차 초대·재접속 초안에서는 개인 링크로 각자 입력하며, 새로고침 후 서버에 저장한 본인 입력을 복원합니다. 서버 기록은 `.local/trips.sqlite3`에 보존됩니다. 방장은 별도 관리 화면에서 계산합니다. 실행·초대·복구·검사 범위는 [6주차 초대 문서](../docs/week6_invites.md)를 참고하세요. 실제 휴대폰 리허설과 Next.js 화면 통합은 별도로 남아 있습니다.

## 이번에 연결한 계산

`engine/`은 `web/src/lib/`의 `consensus.ts`, `schedule.ts`, `places.ts`, `types.ts` 복사본입니다. 상대 import에 `.ts`를 붙인 것 외에 알고리즘은 바꾸지 않았습니다. 원본과 해시는 `source_manifest.json`에 기록했습니다. 팀원의 새 알고리즘이 있는지는 별도 확인이 필요합니다.

서버가 DB에서 전원 입력을 읽고 별도 Node 프로세스에 전달합니다. 동시에 여러 방을 계산해도 전역 참여자 목록을 공유하지 않습니다. 계산 중 입력이 바뀌면 이전 revision의 결과 저장을 거절합니다. 실패하면 503으로 알리고 결과를 만들어내지 않습니다. 공개 응답에는 개인 입력 원문과 개인 만족도를 넣지 않습니다.

## API 계약

| 기능 | 경로 | 인증 |
|---|---|---|
| 장소 목록 | GET /places | 없음 |
| 방 만들기 | POST /rooms | 없음 |
| 공용 초대 링크 — 이름 목록 | GET /rooms/{roomId}/join | 초대 토큰 |
| 공용 초대 링크 — 이름 고르기·직접 추가 | POST /rooms/{roomId}/join | 초대 토큰 |
| 내 입력 저장·수정 | PUT /rooms/{roomId}/submissions/{memberId} | 참여자 토큰 |
| 실제 계산 후 저장 | POST /rooms/{roomId}/calculate | 방장 토큰 |
| 저장 결과 조회 | GET /rooms/{roomId}/results | 해당 방 참여자/방장 토큰 |
| 외부 계산 결과 저장(연결용) | POST /rooms/{roomId}/results | 방장 토큰 |

방을 만들면 응답에 방 공용 `inviteToken`이 함께 옵니다. 단체방에는 `/join/?room={roomId}&k={inviteToken}` 링크 하나만 보내고, 들어온 사람이 이름을 고릅니다.
- `GET /rooms/{id}/join` → `{roomId,startDate,endDate,members:[{id,name,claimed}]}`. 토큰·입력은 주지 않습니다. 첫 이름(방장)은 처음부터 `claimed`입니다.
- `POST /rooms/{id}/join` 본문은 `{"memberId":"..."}`(목록에서 고르기) 또는 `{"name":"..."}`(목록에 없는 이름 추가, 6명까지) 중 하나입니다. 응답 `{memberId,name,submissionToken}`의 토큰은 **새로 발급**되므로 방장이 가진 그 자리의 예전 토큰은 더 쓰이지 않습니다. 이미 고른 이름·같은 이름은 409, 이름을 더하면 결과가 무효화됩니다(revision +1).
- 같은 방에 이름이 겹치면 방 만들기도 400입니다.

토큰은 `Authorization: Bearer ...`로 전달합니다. 같은 서버의 연결 화면과 기본 `http://localhost:3000`을 허용하며, 다른 로컬 프론트 주소는 `--origin`으로 지정합니다.

방 생성 본문:

```json
{"startDate":"2026-10-01","endDate":"2026-10-02","memberNames":["조은","윤진","혜인"]}
```

응답은 `roomId`, 날짜, `ownerToken`, `members[{id,name,submissionToken}]`, `revision`입니다.

참여자 입력은 기존 Submission 필드에 맞췄습니다. 예산은 원/하루이며 여행 날짜는 양 끝을 포함합니다. 알려지지 않은 장소 ID는 400입니다.

```json
{"longlist":["glico","umeda_sky"],"picks":["glico"],"must":"glico","veto":null,"budgetPerDay":75000,"stepLimit":10000,"activeMin":480}
```

`must`는 picks 안에 있어야 하고 veto는 picks와 겹칠 수 없습니다. picks는 그룹 후보에서 고르므로 개인 longlist의 부분집합일 필요는 없습니다. 이번 연결 화면은 1·2차 선택을 한 번에 제출하는 간소화 화면이며, 기존 두 단계 선택 화면을 대체한 것은 아닙니다.

계산 요청:

```json
{"strategy":"fairness"}
```

`average`, `least_misery`, `fairness`를 지원합니다. 계산은 서버가 저장된 입력으로 수행합니다. 클라이언트가 다른 사람 입력을 보내지 않습니다.

결과 응답:

```json
{"roomId":"…","status":"ready","submittedCount":3,"memberCount":3,"revision":3,"result":{"strategy":"fairness","days":[{"date":"2026-10-01","placeIds":["glico"]}],"summary":"…"}}
```

예시는 응답 형식을 보여주는 것이며 실제 계산 내용은 입력에 따라 달라집니다. `collecting`은 전원 입력 전, `awaiting_result`는 입력 완료·계산 전, `ready`는 현재 입력 버전 결과 저장을 뜻합니다. 잘못된 입력400, 인증 실패403, 없는 방404, 미제출·버전 충돌409, 큰 본문413, 계산 실패503을 반환합니다.

`client.js`는 프레임워크에 독립적인 fetch 모듈입니다. 같은 서버에서는 `createTripClient()`, 별도 프론트에서는 `createTripClient('http://127.0.0.1:8000')`으로 사용합니다.

## 검증과 남은 범위

```sh
python3 test_server.py
```

HTTP 통합검사로 저장·조회, 권한·출처 제한, 동시 입력, 재조회, 미등록 장소 거부, 실제 계산, 거부 장소를 바꾼 뒤 재계산, 오래된 결과 저장 방지를 확인합니다. 화면 JS 구문도 검사했습니다. 새 실제 장소 모드는 Chrome에서 방 생성·2명 선택 저장·계산·결과 재조회까지 확인합니다. 모바일 실기기와 배포 환경 검증은 별도입니다.

중요한 한계:

- 기본 API 방은 **시연용 36곳**입니다. `dataset=osaka_review_150`을 지정한 방은 실제 150곳 ID로 선택·저장·계산하며, 검증 조건을 통과한 일부 장소만 초안에 배치합니다.
- 원본 계산의 비용·운영시간·이동시간은 시연값/추정값입니다. 여행 날짜별 휴무·폐업 여부와 개인별 예산·걷기·활동시간의 완전한 충족을 보장하지 않습니다. 실제 여행용 일정으로 표시하지 않습니다.
- 새로운 연결 확인 화면만 추가했습니다. 혜인의 실제 Next.js 화면/store, 두 단계 선택, 초대 링크 전환은 남아 있습니다.
- 6주차 확인 화면은 개인별 초대·본인 입력 복원·참여 현황 갱신을 지원합니다. 방 생성자는 초대 링크를 배부하며, 링크 소지자가 해당 권한을 갖습니다. 계정 기반 본인 인증·토큰 만료·회수는 미구현입니다. [초대·재접속 문서](../docs/week6_invites.md)의 로컬 시험 범위를 확인하세요.
- AI API 호출과 백엔드 외부 배포는 포함하지 않습니다. GitHub Pages는 정적 화면만 제공하므로 로컬 서버 연결 화면은 로컬에서 실행하세요.

## Next.js 연결 범위

#26 반영으로 예전 `/server-check` 화면은 현재 main에서 제거되었습니다. 이 PR은 `backend/public` 확인 화면만 변경합니다. 혜인의 초대·두 단계 선택 흐름은 별도 프론트 PR로 연결해야 합니다.

## 2026-09-29 데이터 계약 (기존 모드)

`GET /api/places?q=검색어&category=카페&limit=20`은 검토용 실제 150곳을 반환합니다. `/places`와 기본 모드 `/rooms/.../calculate`는 KRW 시연용 36곳입니다. 아래 opt-in 모드와 장소 ID를 혼합하지 않습니다. API 계약 PR #22 전체가 구현된 것은 아닙니다.

실제 150곳의 원본 `cost`는 JPY 그대로입니다. `JPY_TO_KRW`에 **1 JPY당 KRW** 환율을 설정하면 `cost_krw = ROUND_HALF_UP(cost × rate)`로 원 단위 반올림합니다. 미설정 시 유료 장소는 `cost_krw=null`, `cost_status=exchange_rate_required`입니다. 100엔당 환율을 그대로 넣으면 안 됩니다. 예: 테스트용 9.5 설정은 1엔=9.5원이라는 뜻이며 최신 시장환율이 아닙니다. 운영자가 `JPY_TO_KRW_AS_OF=YYYY-MM-DD`와 `JPY_TO_KRW_SOURCE`(환율 출처 또는 팀 고정값 근거)를 함께 설정하면 응답 `exchange_rate.as_of/source`에 그대로 표시합니다. 미설정 항목은 null이고 `provenance_status=incomplete`입니다. 환율 자체가 없으면 `unconfigured`, 환율·기준일·출처가 모두 있으면 `documented`입니다. `live_quote=false`이므로 현재 시세로 표시하지 마세요. 잘못된 기준일은 서버 시작 시 오류로 알립니다. 2026-09-30 사용자 결정으로 출처는 하나은행 고시환율입니다. 실제 숫자와 기준일은 운영자가 설정해야 하며, 테스트 값을 운영 환율로 저장하지 않습니다.

`cost_status=unknown`은 미확인 가격, `not_applicable_shopping`은 개인 구매액 제외입니다. 둘 다 무료를 뜻하지 않습니다. 쇼핑 예산은 입장권·카페·식당 예산과 별도입니다. 금액을 합산하기 전에 이 상태를 확인해야 합니다. 실제 데이터의 `area`는 행정구역이며 관광 권역으로 해석하면 안 됩니다.

체류시간은 사용자가 제공한 유형별 범위의 상한을 기본값으로 사용합니다. 기존 공식 체류시간은 보존하고 새 값은 `team_rule_estimate`로 표시합니다. 분류 범위는 각 장소의 `review.stay_policy`에 있습니다. 짐 점수는 기존 `scripts/recommend_itinerary.py:get_luggage_score`와 동일하게 쇼핑 2, 구로몬시장·신사이바시스지 상점가·아메리카무라·신세카이 1, 그 외 0입니다. 스냅샷 엔진의 0~1 `bagLoad`와 직접 혼합하지 않습니다.

한국어 이름·체류시간·짐 점수는 150/150, 주소는 148/150입니다. 2026-10-03 보완분 검사 기준 주소 미확인 2곳과 영업시간 미확인 17곳은 그대로 남깁니다. 상충된 재즈 시설 영업시간 1곳은 미확인으로 돌렸습니다. Google Maps 폐업·임시휴업 표시, 시설 대표주소, 이전 위치 충돌을 `planning.review_required`로 내보냅니다. 모든 실제 장소는 방문일별 운영시간 확인이 필요하며 `planning.schedule_ready=false`입니다. 이 150곳을 그대로 자동 일정 생성에 넣으면 안 됩니다.

검증: `python3 -m unittest discover -s backend -p 'test_*.py'` 및 `python3 -m unittest discover -s scripts -p 'test_*.py'`.


## 2026-09-30 실제 장소 여행방 (검토용 확장)

기본 계약과 기본 DB 방은 변경하지 않습니다. 방 생성 때 아래 `dataset`을 넣어 실제 장소 모드를 명시적으로 선택합니다. `backend/public` 화면도 이 모드를 선택할 수 있습니다.

```json
{"dataset":"osaka_review_150","startDate":"2026-10-01","endDate":"2026-10-02","memberNames":["A","B"]}
```

- 생성 응답에 `dataset`이 추가됩니다. 이 모드의 입력은 `/api/places`의 `place_id`를 사용합니다. 150개 ID 모두 저장 가능하며 `glico` 같은 데모 ID는 400입니다. 데모 방에 실제 ID를 보내는 것도 400입니다.
- 같은 제출 경로로 전원 입력을 저장한 뒤 `POST /rooms/{id}/calculate`에 `{"strategy":"average"}`를 보냅니다. 이 모드는 **must → 선택 수 → ID 순서**로 배치를 시도하며 average는 선택 여부 0/1의 집계입니다. 데모의 인기도 기반 만족도와 같은 모델이 아닙니다. 다른 전략은 400입니다.
- 거부 장소를 제외하고 사용자가 선택한 후보만 계산합니다. 인기도·자동 식당·미선택 후보를 추가하지 않습니다. 꼭 갈 곳도 운영시간·금액·한도 조건을 통과해야 합니다. 실패하면 `must_satisfied=false`입니다.
- 각 날짜를 검토해 일일 예산·걸음 수·활동시간은 그룹의 최솟값을 상한으로 적용합니다. 알려지지 않은 가격·시간·예약은 미배치합니다. 쇼핑은 검증된 일반 판매장·상점가 구역에 한해 배치하며 `cost_krw=null`, `cost_status=not_applicable_shopping`으로 표시합니다. 개인 구매액은 예산 합계에 넣지 않습니다.
- 결과의 기존 `strategy/days/summary`를 유지하고, 응답 바깥에 `planning`을 추가합니다. 실제 모드의 저장 후 상태는 항상 `status=draft`입니다. `planning.status`는 `model_checks_passed` 또는 `needs_review`, `schedule_ready`는 항상 false입니다. 배치 수, 미배치 수, 이유별 개수, 날짜별 시간·확인된 비용 합계, 환율 출처를 저장합니다. 개인 이름·토큰·개별 선택·개인 조건·거부 장소 ID는 응답에 포함하지 않습니다.
- `planning.exclusion_reason_counts`는 미배치 장소별로 **모든 여행일에 공통인 사유**만 셉니다. 공통 사유가 없고 날짜마다 실패 조건이 다르면 `date_conditions_vary`로 한 번 집계합니다. 일부 날짜의 휴무나 검증 범위 초과를 여행 전체의 원인으로 표시하지 않습니다. 여러 공통 사유가 있으면 같은 장소가 중복 집계될 수 있어 합계는 미배치 장소 수와 다릅니다. 화면은 시간·마감·하루 장소 수 한도를 각각 안내하고, 나머지 미매핑 사유는 장소 수가 아닌 중복 포함 사유 건수로 한 줄에 표시합니다. 기존 저장 결과는 재계산해야 새 집계가 적용됩니다.
- 실제 모드의 수동 `POST /results`는 거부합니다. 검증된 `calculate` 결과만 저장합니다. 입력 변경 시 결과와 planning을 함께 폐기하고 이전 revision 계산은 409입니다.
- 기존 SQLite에 dataset과 planning 열을 추가하는 비파괴 마이그레이션입니다. 기존 방·결과·토큰은 유지됩니다. 별도 프로세스가 스키마를 직접 쓴다면 열 이름을 명시해야 합니다.

### 하나은행 환율 설정

[하나은행 현재환율](https://kebhana.com/cont/mall/mall15/mall1501/index.jsp)의 JPY 고시를 사용합니다. JPY는 100엔 기준으로 표시되므로, **1엔당 원화 = 100엔당 고시값 ÷ 100**으로 변환해 `JPY_TO_KRW`에 설정합니다. 현재 서버는 자동 조회하지 않습니다.

필수 환경변수는 `JPY_TO_KRW`(양수·소수 6자리 이내), `JPY_TO_KRW_AS_OF`(YYYY-MM-DD), `JPY_TO_KRW_SOURCE`(하나은행 고시환율 출처)입니다. 어느 하나가 없으면 실제 계산은 503을 반환하고 결과를 저장하지 않습니다. 기존 36곳 데모는 계속 동작합니다. 응답 `live_quote=false`는 서버 설정값이라는 뜻이며 최신 고시를 보장하지 않습니다. 환율은 계산 당시 값을 결과에 보존합니다.

테스트의 9.5는 명시적인 가상값입니다. 공식 고시로 오인하거나 서버 운영 설정에 복사하지 마세요. 확인된 날짜의 공개 설정은 아래 하나은행 스냅샷을 참고하며, 현재 환율 자동 조회값은 아닙니다.

### 검증 범위

`python3 -m unittest discover -s backend -v`와 `node --test scripts/test_real_schedule.mjs scripts/test_real_rooms.mjs scripts/test_planning_reasons.mjs`로 재현합니다. Node 24 이상이 필요합니다. 테스트는 로컬 HTTP 포트를 엽니다.

150개 ID를 여섯 명의 합성 입력으로 모두 저장·계산하는 검사, 모드 간 ID 혼합 차단, 같은 방 권한, 환율 누락, 쇼핑 null, hard limit, 날짜 변경, 결과 재조회·무효화·동시 수정, 기존 DB 이관을 검증합니다. `../data/week5/real_catalog_integration_20260930.json`은 150곳 전체 투입 실험의 재현 가능한 결과입니다. 보완분으로 재생성한 2026-10-01~07 기준 결과는 31곳 배치·119곳 미배치입니다. 장소별 단독 검사에서는 52곳 통과·98곳 보류이며, 21곳은 단독 검사 통과 후 전체 일정 제약으로 미배치됐습니다. **모든 ID의 서버 연결 완료와 모든 장소의 여행 가능 검증은 다릅니다.** 최신 카테고리별 현황은 [6주차 구성 점검](../docs/week6_catalog.md)을 확인하세요.

2026-09-30 실제 확인값: 하나은행 매매기준율 337회차(14:04 KST), 100 JPY=862.53 KRW → 1 JPY=8.6253 KRW. 저장소 루트에서 `source config/hana_20260930.sh` 후 서버를 실행하면 기존 환경변수 설정을 사용합니다. 자동 최신값이 아닌 날짜가 명시된 공개 설정이며, 자세한 출처·제한은 [일정 검증 문서](../docs/week5_schedule_validation.md#하나은행-확인값과-실행-설정)를 확인하세요.
