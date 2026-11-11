# 같은 Wi-Fi에서 휴대폰 실험하기

**설문은 혜인님이 만든 Google 설문 하나만 사용한다. 앱 안에 별도 설문은 없다.**
https://docs.google.com/forms/d/e/1FAIpQLScOde1GqSlhf7F29K-rBKrb3qkI-TRqd7IWgwDlIw8Go4F7aQ/viewform

팀원(혜인·윤진·조은) 실험 예정일: **2026-11-16 월요일**. 친구 그룹 진행일은 별도다.
가상 오사카 여행일: **2026-11-16~19, 4일**. 실제 진행일과 구분한다.

## 참가자 안내

1. **자기 그룹 서버 노트북과 같은 Wi-Fi**에 연결한다. 네 그룹 전체가 같은 Wi-Fi일 필요는 없다.
2. 자기 그룹 QR을 열고, 아이폰은 Safari / 안드로이드는 Chrome을 사용한다. 기종별로 다른 QR은 필요 없다.
3. 진행자가 배정한 번호로 입장한다. 팀 `T-01~03`, 조은 친구 `J-01~03`, 혜인 친구 `H-01~03`, 윤진 친구 `Y-01~03`이다.
4. 01번은 진행자가 따로 전달한 PIN으로 다시 들어간다. 02·03번은 첫 입장 때 본인 PIN 4자리를 정한다. 번호를 추가하지 않는다.
5. 가고 싶은 곳 6곳 이상 → 꼭 가기 5곳 → 예산·체력 등 조건을 입력한다. 먼저 고른 곳이 1순위다.
6. 전원이 입력하면 일정 A·B·C가 나온다. 각각 전체 여행일을 살펴본다. 방장 확정은 하지 않는다.
7. 앱의 **Google 설문 열기**를 누른다. 화면에 표시되는 본인 참가자 번호를 설문에도 동일하게 입력한다. 다른 사람과 상의하지 않고 답한다.
8. Google 설문의 제출 완료 화면을 진행자에게 보여 준다. 앱은 Google 설문 제출 여부를 확인하지 못한다.

새로고침은 가능하다. 탭을 닫거나 브라우저를 바꾸면 QR·본인 번호·PIN으로 재접속한다. 연결이 끊기면 새 번호를 만들지 말고 진행자에게 알린다. 개인 계정 비밀번호나 연락처는 입력하지 않는다.

## 진행자 준비

참가자에게는 휴대폰 브라우저만 필요하다. 서버 노트북에는 Node 24 이상, Python 3.10 이상이 필요하다. Mac/Linux 실행기를 제공하며 Windows WSL은 별도 LAN·방화벽 확인이 필요하다.

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

01번 PIN은 `groups/<그룹>/room-private.json`의 `participant1Pin`만 진행자가 확인해 01번 본인에게 전달한다. 파일 전체에는 토큰이 있으므로 공유하지 않는다.

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
