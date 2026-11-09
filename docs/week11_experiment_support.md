# 11주차 조은: 실험 데이터·서버 준비와 장애 대응

관련: [이슈 #6](https://github.com/travel-recommender/gachilo/issues/6), [실험 설계](실험설계_10주차.md).

이 도구는 **로컬 준비 시험**을 위한 것이다. 실제 참가자 실험·공개 배포를 시작하지 않는다.
2026-11-09 사용자 확인: 가상 여행 날짜는 미정이고, P3 추천 카드 운영 방식도 팀 합의 전이다.
윤진의 후속 PR과 실험 화면을 통합한 후 실제 실험 조건을 확정한다.

## 이번에 준비한 범위

- 카탈로그·요일별 운영 정보 사본과 SHA-256, 코드 커밋을 한 묶음으로 고정한다.
- 여행 날짜가 정해지면 날짜별 일정 적격 수와 보류 사유를 출력한다. 원본 데이터를 수정하거나 승격하지 않는다.
- 그룹마다 별도 SQLite를 사용한다. 준비 시험 기록을 참가자 기록과 섞지 않는다.
- 실행 중인 DB는 SQLite backup API로 백업한다. 단순 파일 복사와 달리 커밋된 WAL 기록도 포함한다.
- 복원은 항상 새로운 그룹 폴더에 한다. 원본 DB·이전 백업을 덮어쓰지 않는다.
- API는 `127.0.0.1`에만 열린다. 솜솜AI·날씨 API·OSRM 호출은 이 준비 시험에서 끈다.
  이동은 기존 추정값이다. 실제 OSRM·날씨·실시간 영업 확인의 통합 시험을 대신하지 않는다.

현 카탈로그는 **API 목록 238곳 = 선택 가능 229곳 + 제외 표시 9곳**이다.
제외 장소도 API 목록에 남아 있지만 선택할 수 없다. 선택 가능한 229곳도 여행 날짜·휴무·가격·예약 조건에 따라 자동 일정에 쓰지 못할 수 있다.
준비 성공이나 `/health` 성공만으로 최종 실험 완료를 판단하지 않는다.

## 1. 데이터 버전 고정

Node.js 24 이상, Python 3.10 이상, Git, macOS/Linux가 필요하다. Windows에서는 WSL을 사용한다.
그룹별 중복 실행 방지에 `fcntl`을 사용하므로 Windows 기본 Python에서는 실행하지 않는다.
별도 checkout에서 시작한다. 기존 3048/8048 시연 서버와 DB에는 이 명령을 실행하지 않는다.

저장소 루트에서:

```sh
python3 scripts/experiment_support.py --bundle .local/experiment-prep prepare
python3 scripts/experiment_support.py --bundle .local/experiment-prep check
```

수정·미추적 코드가 있으면 준비가 중단된다. 커밋하거나 별도 checkout을 사용한다.
같은 폴더에 `prepare`를 재실행하면 중단한다. 데이터나 코드가 바뀌면 새 이름의 묶음을 준비한다.
코드 커밋이 달라지면 기존 묶음으로 서버를 실행할 수 없다. 백업·복원은 계속 가능하다.

아래는 **가상의 검사 날짜 예시**이며 합의된 실험 날짜가 아니다. 실제 여행 날짜가 정해지면 바꾼다.

```sh
python3 scripts/experiment_support.py --bundle .local/experiment-prep audit \
  --start 2026-11-16 --end 2026-11-19 > .local/date-audit.json
```

감사 출력의 수는 다음처럼 구분한다. 이전 `searchable` 필드는 오해를 피하기 위해 `selectable`로 바꿨다.

| 필드 | 의미 | 현재 데이터 |
| --- | --- | --- |
| `catalog_total` | 제외 장소를 포함한 API 목록 수 | 238 |
| `excluded` | 제외 표시가 있어 선택할 수 없는 수 | 9 |
| `selectable` | 제외 표시가 없는 선택 가능 수 | 229 |
| `per_day[].eligible` | 해당 날짜에 저장된 운영 조건 검사를 통과한 수 | 날짜별로 다름 |

`rows`는 선택 가능한 장소의 날짜별 적격 여부와 보류 이유다.
`reviewed_date_range`는 고정한 운영 프로필의 검증 범위이며, 범위 밖 요청 날짜는 `outside_reviewed_dates`에 표시된다.
현재 전역 검증 범위의 마지막 날은 **2026-11-30(포함)**이다. 현재 데이터를 그대로 사용하는 실험은 가상 여행 종료일을 이 날까지로 정하고, 정한 기간 전체를 `audit`로 확인한다.
장소마다 더 좁은 검증 기간과 휴무 조건이 있으므로 11월 30일 이전이라고 모든 곳이 적격인 것은 아니다.
**2026-12-01 이후를 여행일로 쓰려면** 공식 운영 조건·예외 휴무·요금의 적용 기간을 재검증하고 날짜 프로필을 갱신한 뒤 새 묶음을 준비한다. 날짜 제한만 늘려 통과시키지 않는다.
가상 여행 날짜는 아직 팀 합의 전이며, 이 날짜 범위는 실제 참가자 실험을 진행하는 날짜와 별개다.
`outside_reviewed_date_range`가 나오면 검증 기간을 연장한 데이터를 준비해야 한다.
이 결과는 저장된 정보의 모델 검사이며, 실시간 영업·예약 가능·최종 일정 완성을 보장하지 않는다.
Node가 PATH에 없으면 `--node /전체/경로/node` 또는 `NODE_BINARY`를 지정한다.

## 2. 별도 준비 서버

터미널 1에서 아래를 실행하고 그대로 둔다. 환율은 과거 시연에 사용한 **고정값 예시**다.
실제 실험에서는 팀이 정한 동일한 기준일·환율·출처를 모든 그룹에 사용한다.

```sh
python3 scripts/experiment_support.py --bundle .local/experiment-prep serve-rehearsal \
  --group rehearsal --port 8111 --origin http://localhost:3111 \
  --rate 8.6253 --rate-date 2026-09-30 \
  --rate-source '하나은행 2026-09-30 14:04 337회차; 100JPY=862.53KRW; https://kebhana.com/cont/mall/mall15/mall1501/index.jsp'
```

터미널 2:

```sh
curl --fail http://localhost:8111/health
curl --fail 'http://localhost:8111/api/places?limit=1'
```

`health.ok=true`, 장소 응답의 `total` 및 환율 출처를 확인한다. API 목록은 한 번에 최대 150곳이므로
직접 API를 읽는 화면은 `next_offset`으로 다음 페이지까지 읽어야 한다.

웹까지 연결하려면 **별도 checkout의 web**에서 의존성을 설치한 뒤 다음처럼 실행한다.
기존 `.env.local`의 지도 키는 이 명령에서 빈 값으로 덮어써 유료 지도 기능을 사용하지 않는다.

```sh
cd web
npm ci
NEXT_PUBLIC_API_BASE_URL=http://localhost:8111 \
NEXT_PUBLIC_DATASET=osaka_review_150 NEXT_PUBLIC_BASE_PATH='' \
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY='' NEXT_TELEMETRY_DISABLED=1 npm run dev -- --port 3111
```

접속 주소는 `http://localhost:3111`이다. 이 명령은 일반 서비스 흐름 확인용이며 H4 실험용 화면이 아니다.
새 탭·시크릿 창에서 처음부터 시작한다. 다른 포트에서 만들었던 방 링크나 토큰을 옮겨 쓰지 않는다.
`rehearsal` 폴더에만 시험 기록이 저장된다. 초기화하려고 DB를 삭제할 필요 없이 다음에는 `rehearsal2` 등 새 이름을 쓴다.

Ctrl+C로 API를 종료한 뒤 같은 그룹으로 재시작할 때는 위 명령에 `--resume`을 추가한다.
기존 그룹은 `--resume` 없이 열리지 않으며, 포트·origin·환율은 기존 설정과 같아야 한다.
같은 그룹을 동시에 두 번 실행하는 것도 막는다. 사용 중인 다른 포트나 서버를 자동 종료하지 않는다.

## 3. 백업과 복원 연습

서버를 켠 채로 백업할 수 있다. 출력에는 건수만 있고 참여자 이름·입력·토큰은 없다.
**DB와 백업 자체에는 개인정보·접속 관련 기록이 있으므로 공유·Git 커밋하지 않는다.**
`.local/`은 Git에서 제외되어 있다. 웹의 `public/`·`out/`에는 저장하지 않는다.

```sh
python3 scripts/experiment_support.py --bundle .local/experiment-prep backup \
  --group rehearsal --output .local/backups/rehearsal-before-stop.sqlite3
```

`.sqlite3`와 같은 이름의 `.sqlite3.json`을 함께 보관한다. JSON에는 데이터 버전·DB 해시·그룹·환율 설정이 들어간다.
기존 파일명은 재사용할 수 없다. 새 백업마다 다른 이름을 쓴다.

API를 Ctrl+C로 종료한 뒤:

```sh
python3 scripts/experiment_support.py --bundle .local/experiment-prep restore \
  --input .local/backups/rehearsal-before-stop.sqlite3 --new-group rehearsal-recovered
python3 scripts/experiment_support.py --bundle .local/experiment-prep check --group rehearsal-recovered
```

원본 그룹은 남아 있다. 새 그룹으로 같은 `serve-rehearsal` 명령에 `--resume`을 붙여 실행한다.
백업 이후 입력은 복원본에 없으므로 반드시 원본과 백업 시각을 확인한다.
복원본을 원본과 동시에 사용해 서로 다른 기록이 쌓이지 않도록, 기존 API 종료를 먼저 확인한다.

## 장애 대응 순서

| 상황 | 확인과 조치 |
| --- | --- |
| 웹만 안 열림 | 웹 터미널과 3111 포트를 확인한다. API DB를 삭제하지 않는다. |
| API 응답 없음 | API 터미널 오류와 `curl /health`를 확인한다. 해당 준비 서버만 중지·`--resume`으로 재시작한다. |
| 다른 그룹 기록이 보임 | 웹의 API 주소와 실행 명령의 `--group`을 대조한다. 임의로 입력을 지우지 않는다. |
| 장소가 적거나 후보 계산 실패 | 검색 수와 날짜별 적격 수를 구분하고 `audit` 결과·선택 장소·입력 조건을 확인한다. |
| 데이터 해시/코드 버전 불일치 | 기록을 보존하고 새 묶음에서 재준비한다. 이전 DB를 다른 버전으로 강제로 열지 않는다. |
| DB 무결성 오류 | 원본을 보존하고 정상 백업을 새 그룹에 복원한다. 백업이 없으면 실험을 중지하고 조은에게 전달한다. |
| 네트워크/외부 기능 장애 | 이 준비 도구는 외부 호출 없이 동작한다. 실험용 외부 기능 실패는 성공으로 취급하지 말고 별도 기록한다. |

장애 기록에는 시각·그룹 코드·화면·동작·오류·중단/재개 시각·데이터 손실 여부를 남긴다.
참여자 실명·PIN·토큰·개인 예산 본문은 이슈 댓글에 올리지 않는다.

## 실제 실험 전에 남은 결정과 통합

- 가상 여행 날짜, 참여 그룹 및 실험용 데이터·환율 버전 확정.
- [PR #67](https://github.com/travel-recommender/gachilo/pull/67)은 실험 중 P3 추천 카드를 끄고 평소 서비스·시연에서는 유지하자는 **제안**이다. 그룹별 DB로 기록 혼입은 막지만, 카드의 근거 문장이 H4 설명 유무 조건과 섞이는 문제는 별도로 합의해야 한다.
- 합의 전에는 manifest의 `recommendation_card_policy=pending_team_decision`과 현재 화면 동작을 유지한다. 합의 후에는 확정한 정책과 실험 화면 구현을 함께 반영하고 새 코드 커밋에서 새 묶음을 준비한다. 고정된 기존 manifest를 직접 고치지 않는다. 백업은 해당 manifest 해시에 연결되어 있다.
- 혜인의 H4 화면: 후보 A/B/C·순서·설명 배정·응답 저장 연동. 일반 방장 확정 화면으로 대체하지 않는다.
- 응답 저장은 설계 문서의 담당 제안이다. 필드·API 계약을 합의한 후 구현한다.
- 실시간 영업 확인 및 추천 카드 PR을 최종 통합한 커밋에서 재준비·전체 흐름 검사.
- 실제 참가자 실험 배포는 사용자 보류 상태 유지. 이 문서로 이슈 #6 전체 완료 체크를 하지 않는다.

실험 당일 실행할 컴퓨터·담당자는 아직 확정하지 않았다. 데이터·서버 준비 및 장애 대응은 이슈 #6의 조은 담당 범위이며, 실제 운영자는 팀에서 확인한다.

| 확인할 항목 | 현재 상태 |
| --- | --- |
| 실행 담당자·부재 시 연락할 사람 | 팀 확인 전 |
| 사용할 컴퓨터와 OS | 팀 확인 전. macOS/Linux 또는 Windows의 WSL 필요 |
| 사전 점검 | 확정한 컴퓨터에서 버전 확인 → prepare/check/audit → 실행 → 백업·복원·재시작까지 시험 |
| 확정 기록 | 담당자·OS·코드/데이터 버전·여행 날짜·추천 카드 정책을 실험 운영 기록에 남김 |

준비 도구 검사:

```sh
python3 -m unittest discover -s scripts -p test_experiment_support.py -v
node --test scripts/test_experiment_catalog_audit.mjs
```
