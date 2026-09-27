# 5주차 백엔드와 추천 연결 초안

[5주차 이슈](https://github.com/travel-recommender/travel-recommender/issues/1)를 기준으로 만든 로컬 통합 초안입니다. 방 생성 → 참여자별 입력 저장 → 기존 프로토타입 계산 → 결과 저장·조회가 연결되어 있습니다. 프로토타입의 `/server-check` 화면에 API 연결 예제를 추가했습니다. 기존 두 단계 데모 화면은 그대로 유지합니다.

## 실행

Python 3.10 이상과 Node.js 24 이상이 필요합니다. 별도 Python/npm 패키지는 필요 없습니다. Node가 PATH에 없으면 `NODE_BINARY`로 실행 파일을 지정하세요. 현재 작업 컴퓨터에서는 Codex 번들 Node도 자동 감지합니다.

```sh
cd backend
python3 server.py
```

브라우저에서 `http://127.0.0.1:8000`을 열면 연결 확인 화면이 나옵니다.

1. 날짜와 동행자 2~6명을 입력해 여행방을 만듭니다.
2. 참여자를 바꿔 가며 가고 싶은 곳, 꼭 갈 곳, 제외할 곳, 예산·걸음 수·활동시간을 저장합니다.
3. 전원 입력 후 추천 기준을 선택하고 ‘일정 계산하기’를 누릅니다.
4. ‘저장된 결과 확인’으로 서버 결과를 다시 읽습니다.
5. 한 사람의 입력을 수정하면 이전 결과는 무효화되며 재계산할 수 있습니다.

화면 새로고침은 메모리에 있던 토큰을 지웁니다. 서버 기록은 `.local/trips.sqlite3`에 보존됩니다. 아직 새로고침 후 방 재접속 기능은 없습니다. 로컬 개발 서버이며 외부 배포용이 아닙니다.

## 이번에 연결한 계산

`engine/`은 `web/src/lib/`의 `consensus.ts`, `schedule.ts`, `places.ts`, `types.ts` 복사본입니다. 상대 import에 `.ts`를 붙인 것 외에 알고리즘은 바꾸지 않았습니다. 원본과 해시는 `source_manifest.json`에 기록했습니다. 팀원의 새 알고리즘이 있는지는 별도 확인이 필요합니다.

서버가 DB에서 전원 입력을 읽고 별도 Node 프로세스에 전달합니다. 동시에 여러 방을 계산해도 전역 참여자 목록을 공유하지 않습니다. 계산 중 입력이 바뀌면 이전 revision의 결과 저장을 거절합니다. 실패하면 503으로 알리고 결과를 만들어내지 않습니다. 공개 응답에는 개인 입력 원문과 개인 만족도를 넣지 않습니다.

## API 계약

| 기능 | 경로 | 인증 |
|---|---|---|
| 장소 목록 | GET /places | 없음 |
| 방 만들기 | POST /rooms | 없음 |
| 내 입력 저장·수정 | PUT /rooms/{roomId}/submissions/{memberId} | 참여자 토큰 |
| 실제 계산 후 저장 | POST /rooms/{roomId}/calculate | 방장 토큰 |
| 저장 결과 조회 | GET /rooms/{roomId}/results | 해당 방 참여자/방장 토큰 |
| 외부 계산 결과 저장(연결용) | POST /rooms/{roomId}/results | 방장 토큰 |

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

HTTP 통합검사로 저장·조회, 권한·출처 제한, 동시 입력, 재조회, 미등록 장소 거부, 실제 계산, 거부 장소를 바꾼 뒤 재계산, 오래된 결과 저장 방지를 확인합니다. 화면 JS 구문도 검사했습니다. 앱의 브라우저 보안 정책 확인 실패로 실제 브라우저 클릭·모바일 표시 검사는 아직 못 했습니다.

중요한 한계:

- 계산은 기존 **시연용 36곳** 데이터입니다. 공식 검토 중인 150곳은 아직 연결하지 않았습니다.
- 원본 계산의 비용·운영시간·이동시간은 시연값/추정값입니다. 여행 날짜별 휴무·폐업 여부와 개인별 예산·걷기·활동시간의 완전한 충족을 보장하지 않습니다. 실제 여행용 일정으로 표시하지 않습니다.
- 새로운 연결 확인 화면만 추가했습니다. 혜인의 실제 Next.js 화면/store, 두 단계 선택, 초대 링크 전환은 남아 있습니다.
- 방 생성자가 참여자 토큰을 모두 받는 테스트 방식이라 실제 본인 인증·입력 비공개 보호는 완성되지 않았습니다. 실제 개인정보를 넣지 말고 6주차 초대/참여 인증으로 교체해야 합니다.
- AI API 호출과 백엔드 외부 배포는 포함하지 않습니다. GitHub Pages는 정적 화면만 제공하므로 로컬 서버 연결 화면은 로컬에서 실행하세요.

## Next.js 연결 화면

백엔드를 실행한 뒤 다른 터미널에서 `cd web && npm install && npm run dev`로 화면을 실행합니다. `http://localhost:3000/server-check`에서 연결을 확인합니다. 서버 주소 변경 시 `NEXT_PUBLIC_API_BASE_URL`을 설정하고 백엔드 `--origin`과 일치시키세요.

OSM 수집 데이터 비용은 JPY, 기존 시연 계산 예산은 KRW이므로 두 데이터를 직접 합치지 않습니다.
