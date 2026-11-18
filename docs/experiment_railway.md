# Railway 공용 실험 서버

노트북·같은 Wi-Fi 없이 그룹별 링크로 접속한다. 서버 한 서비스 안에서 팀원 / 조은 친구 / 혜인 친구 / 윤진 친구의 방·SQLite·접속키를 분리한다. 각 그룹은 3명이다. 기존 노트북 실험 기록을 가져오거나 덮어쓰지 않는다.

## 배포 설정

- Dockerfile: `Dockerfile.experiment`, 시작: `python3 scripts/experiment_cloud.py`. 신규 Railway 환경에서는 서비스 설정에 직접 지정한다(`railway.json`은 구형 설정 예시).
- Node 24 + Python, 포트 8080, `/healthz`, 한 replica. `/data`에 영구 volume을 연결한다.
- GitHub의 검증한 전체 commit SHA에 고정하고 자동 배포를 끈다. 실험 중 코드 변경 금지.
- `PUBLIC_ORIGIN`: 발급한 HTTPS 도메인. 브라우저 지도 키의 허용 웹사이트에도 이 도메인을 등록한다.
- 비밀 변수: `SOMSOM_API_KEY`, `GOOGLE_PLACES_API_KEY`, 임의의 32자 이상 `EXPERIMENT_ADMIN_TOKEN`. 값은 저장소·문서·실험자에게 공유하지 않는다.
- 공개 지도 키: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`(빌드 때 필요). `NEXT_PUBLIC_EXPERIMENT_MODE=1`, `NEXT_PUBLIC_API_BASE_URL=/backend`.
- `EXPERIMENT_CODE_VERSION`: 전체 commit SHA (`RAILWAY_GIT_COMMIT_SHA`가 있으면 그것을 우선).
- `EXPERIMENT_SESSION`: 새 묶음 이름. `/data/<묶음>`에 자료·설정·방별 DB를 보존한다.
- 날짜: `EXPERIMENT_START_DATE`, `EXPERIMENT_END_DATE`, 3박 4일. 현재 가상 여행은 2026-11-16~19.
- `EXPERIMENT_MODE=setup`은 준비 안내만, `rehearsal`은 유료 API 없는 모의 점검, `live`는 실제 Places·Somsom 조회다. live는 두 키가 필수이며 mock을 금지한다.
- `EXPERIMENT_ACTIVE_GROUPS=team`: 팀원만 입력 가능. 친구 그룹 활성화는 운영·API 사용 승인과 사전 점검 후 설정한다. 비활성 그룹은 준비 안내만 보인다.

## 접속 링크와 진행

운영자만 HTTPS `/admin/status`를 `Authorization: Bearer <관리자 토큰>`으로 조회한다. 응답에는 그룹별 링크와 01번 PIN이 있으므로 로그·공개 문서에 붙이지 않는다. 각 그룹에 해당 링크만 전달하고 01번 PIN은 그 참가자에게 별도로 전달한다. 02·03번은 첫 접속 때 PIN을 정한다.

아이폰 Safari / 안드로이드 Chrome으로 접속한다. 장소 6곳 이상 → 꼭 가기 5곳 → 나머지 입력 → 전원 제출 → A·B·C 확인 → 결과 화면의 Google Form에 응답한다. 실험은 설명 유무를 비교하므로 전략명과 배정 원리를 참가자에게 미리 설명하지 않는다. 앱 안에서 최종 확정하지 않으며 평가 중 서로 상의하지 않는다. 새로고침·재접속은 본인 번호와 PIN을 쓴다. 계산 뒤 입력 수정은 잠긴다.

## 보존·재시작·내보내기

같은 세션의 재시작은 기존 방·PIN·초대키·DB를 재사용한다. 코드·날짜·실험 조건이 달라지면 시작을 거부하므로 새로운 세션 이름을 사용한다. 이전 세션을 삭제하지 않는다. 중간 초기화가 실패해도 기록을 지우지 말고 원인을 확인한다.

Railway volume의 묶음을 안전하게 내려받은 뒤 `python3 scripts/experiment_export.py --bundle <묶음> --group team --out <새폴더> --node node`로 지정 방만 내보낸다. 그룹명은 `team`, `joeun`, `hyein`, `yunjin`이다. Google Form 응답은 별도이며 참가자 코드와 일정 글자로 결합한다.

## 완료로 구분할 기준

서버 배포 성공과 정식 실험 시작 가능은 별개다. HTTPS·휴대폰·지도·AI·영업정보·공동 후보·설문·저장·재접속을 확인한 뒤 실험을 시작한다. 최종 통합 기준은 병합된 #74·#75·#77~79와 참가자별 설명 배정·공용 서버(#76)이다. 실행한 커밋과 배포 커밋을 대조하고, #76의 main 병합 및 실제 기기 점검까지 확인해야 완료다.

현재 알려진 통합 점검 항목:
- #75의 긴 지점명은 고른 곳/배치 두 줄과 가변 높이로 수정됐다. 최신 모바일 화면을 통합하여 예비 점검한다.
- 개인 설명과 내보내기 만족도는 같은 `branch_group_id`의 방문을 반영한다. 포장/식당처럼 교체 그룹이 다르면 반영하지 않으며 제외는 정확한 지점 ID로 평가한다. 내보내기는 실험 시작 때 고정한 카탈로그를 사용하고 CSV의 `metric_basis`에 계산 버전을 남긴다. 배포 버전의 실제 화면·기록 최종 대조는 여전히 필요하다.
- 클라우드 OSRM은 아직 별도 연결하지 않았다. 이동 수치는 추정식이며 실제 도보 경로로 설명하면 안 된다.
- A·B·C는 입력에 따라 같을 수 있다. 결과를 임의로 다르게 만들지 않는다.

## 2026-11-16 장소 선택 보완

실험 날짜 11/16~19 기준, 238곳 중 선택 가능한 장소가 115→118곳이다. 글리코 사인(에비스바시 공공 관람 지점), 구로몬시장(시장 산책·쇼핑), USJ를 날짜 프로필에 연결했다. USJ는 공식 티켓 달력의 성인 1일권 9,900엔과 운영시간을 확인한 11/17~19에만 사용한다. 11/16·20 이후 가격을 추정해 넣지 않았다. 입장권은 별도 구매하며 잔여 티켓·특정 구역 입장을 보장하지 않는다.

글리코 09~22시·구로몬 10~17시는 일정 계획 범위이며 공식 공통 영업시간이 아니다. 글리코 점등은 일몰 후~24시(단축 가능), 구로몬 개별 점포의 운영일·품절·구매액은 별도다. 공개 지도 참고 좌표이며 현장 실측·게이트 대기열 검증이 아니다. 근거와 날짜: `data/final/catalog_verification_20261116.json`. 재생성: `python3 scripts/publish_landmark_catalog.py`, 확인: `--check`.

`/rooms/:id/schedulable`의 기존 `placeIds`와 함께 `unavailableReasons`(장소 ID→안내 문장)를 전달한다. 검색과 장소 카드에 좌표·입장료·예약·휴무·검토 기간 등 실제 사유를 표시한다. 과거 카탈로그, 미검증 장소의 제한, 실시간 Google 재확인, 예산·활동 시간 검사는 유지했다. 이번 검사는 유료 API를 호출하지 않았으므로 실제 Google 영업정보 통과를 보장하지 않는다. 특히 시장·공공 공간의 영업시간 부재는 별도 live-check 검토가 필요하다.

검증: Python API/카탈로그 48개 + Node 데이터/세 전략/UI 변환 30개, 실험 모드 정적 빌드 통과. 격리된 임시 방의 P3에서 세 곳을 검색해 My list에 담고, 쓰텐카쿠는 예약 조건 때문에 선택 불가한 사유를 표시함을 브라우저에서 확인했다. 실제 참가자 방은 변경하지 않았다.


## 최종 묶음 및 장애 대응 (2026-11-18)

확정한 운영 환경은 **Railway 한 서비스, 영구 /data volume, replica 1개**다. 가상 여행은 **2026-11-16~19**이고 실제 참가 날짜와 구분한다. 4개 그룹(team/joeun/hyein/yunjin), 그룹당 3명이며 서로 같은 Wi-Fi일 필요가 없다. 진행자는 조은, 참가자는 iPhone Safari 또는 Android Chrome을 사용한다.

- P3 함께 담기 추천 카드는 실험에서 비활성화한다. 검색·My list·엔진의 빈자리 채우기는 별개다.
- `participant-fixed-v2`: 각 그룹 01번은 A/B/C 전부 설명 없음, 02·03번은 전부 설명 있음. 같은 방 재접속에도 유지하며 예전 세션의 배정은 소급 수정하지 않는다.
- 데이터·프로필·코드·날짜·설명 정책을 새 묶음에 고정한다. 실제용 묶음과 모의 입력용 묶음을 분리한다. 모의 묶음을 live로 바꾸지 않는다.
- Cloud OSRM은 아직 미연결이므로 이동 수치는 추정값이다. 실제 영업정보/AI 호출 실패를 성공이나 실제 경로로 기록하지 않는다.
- 장소의 날짜 적격 검사와 실제 Google 조회 통과는 별개다. 238곳 전부가 자동 일정에 들어가는 것이 아니고 USJ의 현재 검증 날짜는 11/17~19다. 공공 관람 공간에 Google 영업시간이 없는 경우에도 검사를 임의로 우회하지 않는다.

### 재현 가능한 서버 예비 점검

깨끗한 검증 커밋에서 의존성 설치 후 실행한다. 첫 명령은 지도 키를 빌드 환경변수로 받아야 한다. 키 값은 명령 기록·Git에 넣지 않는다.

```sh
python3 scripts/experiment_lan.py build --node node
python3 scripts/experiment_preflight.py --node node --out .local/preflight-새이름
```

두 번째 명령은 macOS/Linux에서만 실행하는 운영 점검 도구다. 참가자 기기 OS 제한은 아니다. 지정한 폴더가 이미 있으면 거부하며 실제 서버 주소·DB를 입력받지 않는다. 새 로컬 서버에 4그룹·합성 12명을 만들어 유료 호출 없이 검사하고, 자기 서버만 종료한다. 내부 자료는 비공개로 유지한다.

검사 범위: 날짜별 적격 수, 설명 배정 내보내기, 그룹 접근 분리, 세 후보 공동 조회, 계산 응답 소실 후 결과 조회(계산 재전송 없음), 결과 이후 입력 잠금, 실행 중 SQLite 백업, 백엔드 종료 감지, 재시작 후 방·링크·PIN·결과 유지, 12명 PIN 재접속, 새 그룹으로 복원 및 근거 비교, 코드·날짜 변경 재시작 거부. 보고서는 `<out>/verification.json`, 날짜별 상세는 `date-audit.json`이다. 실제 AI/Google 성공, 외부 인터넷, 휴대폰 3대 완료를 뜻하지 않는다.

### 장애가 발생했을 때

| 증상 | 참가자에게 안내 | 진행자 확인·복구 |
| --- | --- | --- |
| 한 사람만 연결 끊김 | 같은 그룹 링크로 다시 열고 본인 번호·PIN 사용. 새 번호를 만들지 않음 | 인터넷 연결을 확인하고 입력/결과 저장 상태를 조회한 뒤 재개 |
| 제출·계산 중 응답이 사라짐 | 버튼 연타·다른 방 생성 없이 대기 | 먼저 기존 결과 조회. 이미 저장됐다면 그대로 사용. 저장 여부를 모르면 계산을 무조건 다시 보내지 않음 |
| 모두 접속 불가 / 서버 종료 | 4그룹 모두 실험을 일시 중단하고 화면·시각만 기록 | 백엔드 하나가 종료돼도 공용 게이트웨이가 모든 그룹을 종료함. 배포 상태·healthz·volume 확인 후 아래 같은 배포 Restart 절차 사용 |
| Google·AI 오류 / 오래 걸림 | 진행자에게 오류 문구 전달 | 키를 공유하지 말고 로그에서 서비스 상태 확인. AI 규칙 대체/실시간 확인 실패 여부를 기록. live→mock 전환으로 진행하지 않음 |
| 지도만 안 보임 | 사용하는 브라우저와 오류 화면 전달 | 해당 배포의 지도 키 포함·허용 도메인·Maps API 오류 확인. 장소 목록이 보인다고 지도 성공으로 기록하지 않음 |
| PIN 또는 그룹 오류 | 원래 배정한 번호와 링크 확인 | 다른 그룹 링크·이중 접속 확인. DB의 PIN을 임의 변경하거나 다른 참가자 번호를 주지 않음 |
| SQLite 손상 | 해당 그룹 진행 중지 | 원본을 보존하고 정상 백업을 **새 복구 그룹**에 복원. 결과·행수·설명 정책 확인 후 별도 복구 판단. 실제 그룹 경로로 자동 교체하지 않음 |

재시작 전후에는 동일 session/commit, DB `quick_check`, 참가자 수, 제출 수, 후보 수, 그룹 링크·PIN 보존, 저장 결과를 확인한다. 코드나 날짜가 바뀌었다고 실행이 거부되면 고정 파일을 직접 편집하지 않는다. 데이터 손실·조건 변화가 있으면 중단 시점부터 새 실험으로 진행할지 팀과 결정한다.

서버의 `/app`에서 백업할 때(세션·그룹·시각은 실제 값으로 바꿈):

```sh
python3 scripts/experiment_support.py --bundle /data/세션 backup --group team --output /data/backups/세션-team-시각.sqlite3
python3 scripts/experiment_support.py --bundle /data/세션 restore --input /data/backups/세션-team-시각.sqlite3 --new-group recovery-team-시각
python3 scripts/experiment_export.py --bundle /data/세션 --group recovery-team-시각 --out /data/exports/recovery-team-시각 --node node
```

실행 중 DB는 파일 복사가 아니라 위 SQLite backup 명령을 사용한다. `.sqlite3.json`에는 복원에 필요한 비공개 정보가 있으므로 DB와 함께 제한된 보관소에 보관한다. 시작 전·그룹 완료 후 백업하고, 실험 중에는 10분 간격 또는 주요 단계 완료 때 진행자가 백업한다. 이 간격은 운영 절차이며 자동 스케줄러가 설치된 것은 아니다. volume과 같은 디스크의 백업만으로 volume 자체 손실을 복구할 수 없으므로, 실제 운영 전 별도 비공개 보관소에 내려받는 절차도 확인한다.

장애 기록 항목: 발생/복구 시각(KST), 그룹 코드, 화면·동작, 오류 문구(비밀값 제거), 영향 인원, 중단 여부, 데이터 손실 여부, 재개/재실험 결정, 코드/세션. 원문 입력·PIN·초대키·API 키는 이슈에 올리지 않는다.

### 실제 실험 시작 직전 남는 점검

1. #76 main 병합 및 배포 SHA 일치, 새 live 세션/그룹 분리와 영구 volume 확인.
2. 실제 영업정보·AI·지도 조회 확인(비용 발생 범위는 운영 승인에 따름). 모의 성공으로 대체하지 않음.
3. 휴대폰 3대 동시 접속·입력·A/B/C·번호별 설명·지점 두 줄·지도·설문 링크·재접속. 모의 입력용 방에서 진행한 뒤 실제 방에는 응답을 남기지 않음.
4. 완료 증거가 있을 때만 최종 예비 점검을 체크한다. 장애 대응 **준비·훈련**과 실제 실험 중 대응 완료는 구분한다.


### 자동 재시작 한도 이후

저장소 `railway.json` 예시는 `ON_FAILURE`, 최대 3회다. 실제 서비스는 대시보드 설정으로 배포했으므로 **Service Settings의 적용된 Restart Policy와 재시도 수를 먼저 확인**한다. 반복 실패하면 자동 재시작이 멈출 수 있다.

1. 네 그룹 모두 중단을 안내하고 장애 시각·고정 SHA·세션을 기록한다.
2. Railway의 해당 서비스 → **Deployments → 기존 배포 → Restart**를 사용한다. 최신 커밋 Deploy나 환경변수 변경으로 대체하지 않는다.
3. 같은 이미지·SHA·세션인지, `/healthz`, 관리자 상태, 기존 그룹 링크·PIN·저장 결과를 확인한 뒤 재개한다. 동일 오류가 반복되면 재시작을 반복하지 말고 원인을 확인한다.

근거: [Railway 배포 작업](https://docs.railway.com/deployments/deployment-actions), [재시작 정책](https://docs.railway.com/deployments/restart-policy). 이번 리뷰 보완에서 실제 서버를 중단해 수동 재시작한 것은 아니다.

### volume 밖으로 백업 내려받기

진행자 Mac에서 비공개 새 폴더를 만들고, Railway 대시보드의 **Copy SSH Command**로 연결한다. SSH 키 등록이 필요할 수 있다. `railway run`은 로컬에서 실행하는 명령이므로 원격 `/data`를 내려받는 수단으로 쓰지 않는다.

1. 원격 `/app`에서 위 `experiment_support.py backup`으로 **새 이름의 SQLite 백업과 `.sqlite3.json` 메타데이터**를 만든다. 실행 중 원본 `trips.sqlite3`를 scp로 직접 복사하지 않는다.
2. [Railway SSH/SFTP 공식 안내](https://docs.railway.com/cli/ssh)에 따라 해당 서비스 도메인 또는 **Service Instance ID**로 접속한다. 진행자 Mac의 새 비공개 폴더에서 아래 두 파일을 함께 받는다(예시 이름을 실제 백업으로 바꿈).

```sh
scp 서비스도메인@ssh.railway.com:/data/backups/세션-team-시각.sqlite3 ./
scp 서비스도메인@ssh.railway.com:/data/backups/세션-team-시각.sqlite3.json ./
chmod 600 세션-team-시각.sqlite3 세션-team-시각.sqlite3.json
```

3. 원격의 동결 묶음에서 `catalog.json`, `profiles.json`, `manifest.json`, `experiment-config.json`도 같은 비공개 보관소에 보존한다. 기존 실험 폴더와 별개로 보관하고 키·PIN이 들어 있는 메타데이터를 Git·이슈에 올리지 않는다.
4. 내려받은 DB의 SHA256이 메타데이터 `db_sha256`과 같고 `PRAGMA quick_check`가 `ok`인지 확인한다. 같은 코드와 동결 데이터 복사본에서 `restore --input <내려받은DB> --new-group <새이름>`을 실행해 복원도 확인한다. live 서버나 기존 그룹에 덮어쓰지 않는다.
5. 다운로드·해시·복원 성공 여부를 진행자 기록에 남긴다. **실제 Railway 반출과 복원 연습은 아직 대기**다. 문서 작성과 로컬 모의 검사를 실제 반출 완료로 기록하지 않는다.
