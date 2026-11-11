# 같은 Wi-Fi에서 휴대폰 실험하기

**설문은 혜인님이 만든 Google 설문 하나만 사용한다. 앱 안에 별도 설문은 없다.**
https://docs.google.com/forms/d/e/1FAIpQLScOde1GqSlhf7F29K-rBKrb3qkI-TRqd7IWgwDlIw8Go4F7aQ/viewform

팀원(혜인·윤진·조은) 실험 예정일: **2026-11-16 월요일**. 친구 그룹 진행일은 별도다.
가상 오사카 여행일: **2026-11-16~19, 4일**. 실제 진행일과 구분한다.

## 참가자 안내

1. **자기 그룹 서버 노트북과 같은 Wi-Fi**에 연결한다. 네 그룹 전체가 같은 Wi-Fi일 필요는 없다.
2. QR은 참가자에게만 직접 보여 주고 단체방·공개 채널에 올리지 않는다. 자기 그룹 QR을 열고, 아이폰은 Safari / 안드로이드는 Chrome을 사용한다. 기종별로 다른 QR은 필요 없다.
3. 진행자가 배정한 번호로 입장한다. 팀 `T-01~03`, 조은 친구 `J-01~03`, 혜인 친구 `H-01~03`, 윤진 친구 `Y-01~03`이다.
4. 01번은 진행자가 따로 전달한 PIN으로 다시 들어간다. 02·03번은 첫 입장 때 본인 PIN 4자리를 정한다. 번호를 추가하지 않는다.
5. 가고 싶은 곳 6곳 이상 → 꼭 가기 5곳 → 예산·체력 등 조건을 입력한다. 먼저 고른 곳이 1순위다.
6. 전원이 입력하면 일정 A·B·C가 나온다. 각각 전체 여행일을 살펴본다. 방장 확정은 하지 않는다.
7. 앱의 **Google 설문 열기**를 누른다. 화면에 표시되는 본인 참가자 번호를 설문에도 동일하게 입력한다. 다른 사람과 상의하지 않고 답한다.
8. Google 설문의 제출 완료 화면을 진행자에게 보여 준다. 앱은 Google 설문 제출 여부를 확인하지 못한다.

새로고침은 가능하다. 탭을 닫거나 브라우저를 바꾸면 QR·본인 번호·PIN으로 재접속한다. 연결이 끊기면 새 번호를 만들지 말고 진행자에게 알린다. 개인 계정 비밀번호나 연락처는 입력하지 않는다.

## 진행자 준비

참가자에게는 휴대폰 브라우저만 필요하다. 서버 노트북에는 Node 24 이상, Python 3.10 이상과 Git 또는 GitHub Desktop이 필요하다. **윤진은 Windows 네이티브 실행기, 혜인·조은은 Mac 실행기**를 사용한다. WSL은 필요 없다.

### 다른 노트북에서 처음 실행

1. GitHub Desktop에서 `travel-recommender/gachilo`를 **실험 전용 새 폴더**에 Clone한다. 작업 중인 폴더를 덮어쓰거나 강제로 브랜치를 바꾸지 않는다.
2. PR #72가 병합되기 전에는 `feat/experiment-server-qr` 브랜치를 선택하고 최신 커밋을 받는다. ZIP 다운로드에는 Git 버전 정보가 없어 실행기가 거부한다.
3. Node.js 24 이상과 Python 3.10 이상을 설치한다. Mac은 터미널에서 `python3 --version`을 확인한다. Xcode 도구만 설치된 Mac의 기본 Python은 3.9일 수 있다. 3.10 이상 설치 후 터미널을 다시 열어 같은 명령으로 확인한다. Windows는 `py -3 --version`으로 확인하며 `py` 명령이나 PATH 등록이 필요하다. 두 운영체제 모두 `node --version`이 24 이상인지 확인한다.
4. 윤진은 루트의 **Start-Experiment-Windows.cmd**, 혜인·조은은 **Start-Experiment-Mac.command**를 실행한다.
5. 자기 그룹과 `연결 연습`/`실제 실험`을 고른다. 처음에는 연결 연습으로 휴대폰 접속을 확인한다.
6. 실행기가 Python 가상환경·웹 패키지·실험 화면을 준비한다. 첫 실행은 인터넷이 필요하고 몇 분 걸린다.
7. 네트워크 주소는 현재 노트북에서 찾는다. 여러 개면 **휴대폰과 같은 Wi-Fi 어댑터**를 고른다. VPN·가상 어댑터를 고르지 않는다.
8. 준비되면 해당 노트북용 QR 안내가 열린다. **자기 노트북이 만든 새 QR**을 참가자에게 전달하고 터미널 창은 유지한다.

그룹을 미리 지정하려면 저장소에서 아래 한 줄을 실행해도 된다.

```powershell
# 윤진 Windows
py -3 -X utf8 scripts/experiment_start.py --group yunjin
```

```sh
# 혜인 Mac
python3 -X utf8 scripts/experiment_start.py --group hyein
# 조은 Mac
python3 -X utf8 scripts/experiment_start.py --group joeun
```

각 그룹의 노트북과 휴대폰 3대만 같은 Wi-Fi에 연결한다. **그룹 간에는 다른 노트북·다른 장소·다른 Wi-Fi를 사용해도 된다. 조은 노트북이 켜져 있을 필요도 없다.** 서버 노트북은 인터넷에 연결되어야 Google 영업정보와 Google 설문을 사용할 수 있다.

실제 실험은 각 노트북에 사용 권한이 있는 Google Places 키를 준비한다. 환경변수가 없으면 실행기가 가려진 입력창으로 묻고, 그 실행 중에만 사용하며 파일에 저장하지 않는다. 조은의 키·DB·PIN을 실행 패키지에 포함하지 않는다. 기본 간편 실행기는 네 그룹 모두 Places 실조회 / 규칙 기반 설명 / 추정 이동이라는 같은 조건으로 시작한다. AI·OSRM을 변경하려면 팀 전체 조건을 먼저 맞추고 아래 수동 실행 방법을 사용한다.

### 재시작·Wi-Fi 변경

- 종료는 터미널에서 Ctrl+C. 같은 코드로 다시 실행하면 `같은 방 이어서` 또는 `새 실험방`을 고른다.
- 같은 방을 선택하면 여행 입력·PIN은 유지하고 **현재 IP로 QR을 다시 만든다**. Wi-Fi가 바뀌면 종료 후 다시 실행하고 이전 QR을 배포하지 않는다.
- 새 실험방은 이전 DB를 지우지 않고 별도 폴더에 만든다. 모의 점검과 실제 실험도 분리한다.
- 실행기가 알려주는 `운영자_01번_PIN.txt`에서 01번 PIN만 본인에게 전달한다. 이 파일은 공유 QR 폴더 밖에 있다.
- Windows에서 방화벽 안내가 나오면 진행자가 사용하는 **신뢰할 수 있는 개인 네트워크** 범위에서 Python 허용 여부를 확인한다. 실행기는 방화벽을 끄거나 규칙을 자동 변경하지 않는다. 학교·공공 Wi-Fi의 기기 간 통신 차단은 다른 공유기에서 확인한다.
- 파일을 OneDrive/iCloud로 동기화해 다른 노트북과 같은 DB를 동시에 사용하지 않는다. 각 노트북의 그룹 DB는 독립적으로 보관한다.

### 설문 변경·빌드 백업 관리

- 설문 주소는 `config/experiment.json`의 `surveyUrl` 한 곳에서 관리한다. 서버 안내와 웹 결과 화면이 함께 읽는다. 폼을 바꾼 뒤에는 변경을 커밋하고 실행기를 다시 실행해 화면을 다시 빌드한다. 기존 실험 기록은 유지하고 새 실험방을 사용한다.
- Mac의 한글 경로에서 다시 빌드하면 이전 `web/out`·`web/.next`를 `.local/build-backups/<시각>/`에 보관한다. 이전 화면 복구를 위해 자동으로 삭제하지 않으므로 빌드 횟수만큼 용량이 늘 수 있다.
- 용량 정리는 실험 서버를 종료하고 새 빌드가 정상인지 확인한 뒤 진행한다. Finder에서 **`.local/build-backups` 안의 예전 빌드 폴더만** 확인해 휴지통으로 옮긴다. 복구가 필요하면 최근 빌드는 남긴다. `.local` 전체나 `experiments`·`groups`·DB·PIN·키 파일은 지우지 않는다.

### 수동 설치·실행

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r scripts/requirements-experiment.txt
cd web
npm ci
cd ..
python scripts/experiment_lan.py build
```

코드 변경이 없는 커밋에서 빌드한다. 서버 노트북과 폰을 같은 Wi-Fi에 연결하고 노트북의 사설 IPv4 주소를 확인한다. 아래 주소는 예시다.

```sh
python scripts/experiment_lan.py start --host 192.168.0.10 --group hyein --mode rehearsal
```

`team`, `joeun`, `hyein`, `yunjin`, `all` 중 선택한다. 모의 점검은 실제 응답과 분리된다. `GOOGLE_PLACES_API_KEY`를 서버 환경변수로 준비한 뒤 실제 실행은 다음과 같다. 키는 Git·채팅·QR에 넣지 않는다.

```sh
python scripts/experiment_lan.py start --host 192.168.0.10 --group hyein --mode live
```

기본 웹 포트 3140~3143, API 8140~8143(loopback). 필요하면 `--port`/`--api-port`로 바꾼다. Google 영업정보 조회는 비용이 발생할 수 있다. 모의 설정은 live에서 금지한다. 현재 실험 설명은 #68의 규칙 기반 개인별 설명을 사용한다. 솜솜AI·OSRM을 사용할 경우 모든 그룹에서 동일한 환경으로 준비하고 확인한다. 환율은 2026-09-30 하나은행 8.6253원/엔이라는 실험 고정값으로 현재 환율이 아니다.

각 그룹의 `.local/.../qr-share/QR_접속안내.html`을 열어 QR을 배포한다. **다른 노트북·Wi-Fi에서는 그 노트북에서 새로 생성한 QR을 사용한다.** 학교·공공 Wi-Fi는 기기 사이 통신을 막을 수 있으므로 실제 휴대폰 접속을 먼저 확인한다. 인터넷도 연결돼 있어야 Google 조회와 Google 설문이 열린다.

노트북은 전원에 연결하고 실험 중 잠들지 않게 한다. 참가자는 정확히 3명이며 진행자용 네 번째 자리는 없다. 팀 실험 결과와 친구 실험 결과는 구분한다. 기존 방을 다시 쓰면 이전 기록이 이어지므로 새 실험에는 새 `--bundle .local/새이름`을 사용한다.

01번 PIN은 실행 시 안내하는 `운영자_01번_PIN.txt`에서 확인해 본인에게만 전달한다. `groups/<그룹>/room-private.json` 전체에는 토큰도 있으므로 공유하지 않는다.

## 저장·백업·분석

여행 입력과 후보 일정은 그룹별 SQLite에 저장하고, 설문 답은 Google Forms에만 저장한다. 앱은 설문 제출 여부를 수집하지 않는다. 데이터·날짜·설명 조건·코드 버전은 묶음 생성 시 고정한다.

```sh
python scripts/experiment_support.py --bundle .local/experiment-live backup --group hyein --output .local/backups/hyein-01.sqlite3
python scripts/experiment_export.py --bundle .local/experiment-live --group hyein --out .local/exports/hyein-01
```

`candidate_metrics.csv`는 참가자 번호·일정 글자·전략·설명 배정·자동 점수를 담는다. Google 설문 답과 **참가자 번호 + 일정 A/B/C**로 연결하며 자동 점수를 응답 점수라고 부르지 않는다. 토큰·PIN은 분석 내보내기에 없다. 번호·방을 바꾸거나 입력을 수정해 재계산한 실험은 따로 구분한다.

SQLite 백업은 실행 중에도 일관된 스냅샷을 만든다. `.sqlite3.json`에는 복구용 방 정보/PIN이 있으므로 진행자만 보관한다. 복구는 `experiment_support.py restore --help`에 따라 새 그룹으로 진행한다. 기존 데이터·백업을 덮어쓰지 않는다.

## 완료 기준

코드/API 점검과 휴대폰 크기의 브라우저 점검은 실제 휴대폰 3대 동시 접속 검증을 대신하지 않는다. 당일 노트북 1대와 폰 3대로 입장 → 개별 입력 → 공통 후보 확인 → 외부 설문 열기를 확인한 뒤 실제 실험을 시작한다.

현재 자동 검사는 Mac에서 수행하며 Windows 분기 검사를 포함한다. 실제 윤진 Windows의 방화벽·Wi-Fi 접속은 그 노트북에서 연결 연습을 실행해 확인해야 한다.
