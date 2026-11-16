# 조은 노트북 하나로 친구 3그룹 접속

참가자는 혜인 친구(H-01~03), 조은 친구(J-01~03), 윤진 친구(Y-01~03) 그룹별 링크를 연다. 각 그룹은 별도 방·DB를 사용하며 다른 그룹의 일정과 입력이 섞이지 않는다. iPhone Safari와 Android Chrome 모두 같은 링크를 쓴다. 같은 Wi-Fi일 필요가 없다.

조은 노트북에서 웹·API를 실행하고 Cloudflare 임시 HTTPS 터널 하나로 연결한다. 다른 팀원 노트북에는 설치할 것이 없다. 노트북 전원·인터넷·실행 창을 유지해야 한다. 종료 후 터널을 다시 만들면 주소가 바뀌므로 새 링크를 전달한다. 이 방식은 임시 실험용이며 상시 운영 서비스가 아니다.

## 현재 준비와 실제 실험 구분

- `setup`: 그룹별 준비 안내만 공개한다. 참가자 선택·입력·계산은 차단한다. 기존 팀 실험 데이터에는 접근하지 않는다.
- `rehearsal`: 새 모의 방 3개를 만들어 접속·저장·방 분리를 검사한다. 영업정보는 모의값이므로 이 응답을 본 실험에 사용하지 않는다.
- `live`: 기존 Google Places 키와 솜솜AI 키, 현재 커밋의 지도 키 포함 빌드가 필요하다. 실제 API 사용은 비용 및 사용 권한을 확인한 뒤에만 진행한다. 키 존재 검사는 인증·지도 도메인 제한·추천 결과 품질의 확인을 대신하지 않는다.

2026-11-16 팀 모의 실험에서 A/B/C 저장 일정 동일, AI 미설정, 브라우저 지도 키 누락이 확인되었다. 본 실험은 해당 문제의 원인 검증과 최신 엔진/설명 통합을 끝낸 뒤 새 방으로 진행한다. 전략 이름과 설명 배정은 실험 설계대로 유지한다. 결과를 다르게 보이게 하기 위해 인위적으로 장소를 바꾸지 않는다.

## 준비

Node 24+, Python 3.10+, 기존 `scripts/requirements-experiment.txt` 패키지, 공식 `cloudflared`가 필요하다. Cloudflare 계정·도메인·공유기 포트 개방 없이 임시 URL을 만들 수 있다. 도구를 `.local/tools/cloudflared`에 두어도 된다.

```sh
# 준비 안내만 외부 접속 가능. 아직 친구 입력을 받지 않는다.
python3 scripts/experiment_share.py --bundle .local/friends-public --mode setup --cloudflared .local/tools/cloudflared
```

그룹별 링크는 묶음의 `친구에게_보낼_링크.txt`에 저장된다. 각 팀원에게 본인 그룹 링크만 전달한다. PIN·API 키·room-private.json·DB는 함께 보내지 않는다. 링크를 열면 해당 그룹의 번호 선택 화면으로 이동한다(setup에서는 준비 안내만 표시).

```sh
# 모의 연결 검사: 먼저 현재 커밋을 실험 모드로 빌드한다.
python3 scripts/experiment_lan.py build
python3 scripts/experiment_share.py --bundle .local/friends-public --mode rehearsal --cloudflared .local/tools/cloudflared
```

지도 포함 빌드는 `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`를 환경으로 제공하고 `python3 scripts/experiment_share.py --build`를 실행한다. 이 키는 브라우저에 보이는 지도 전용 키이며 서버의 `GOOGLE_PLACES_API_KEY`를 대신 넣지 않는다. Google Cloud의 웹사이트 제한에 실제 외부 HTTPS 주소를 허용해야 한다. 터널 주소 변경 시 제한도 확인한다. 서버용 `GOOGLE_PLACES_API_KEY`·`SOMSOM_API_KEY`는 프로세스 환경에만 제공한다.

```sh
# 실제 설정과 사용 승인을 확인한 다음 새 본 실험 방으로 시작한다.
python3 scripts/experiment_share.py --bundle .local/friends-public --mode live --cloudflared .local/tools/cloudflared
```

가상 여행일 기본값은 기존 합의인 2026-11-16~19이다. 바꾸려면 `--start`·`--end`를 명시하고 새 묶음을 사용한다. 실제 실험 날짜와 구분한다. 기본 웹/내부 API 포트는 3180 / 3185~3187 / 8185~8187이며 모두 loopback이다. 이 포트가 이미 사용 중이면 다른 포트를 지정한다. 실행기는 기존 서버를 종료하지 않는다.

## 실험 시작 전 확인

1. 세 그룹이 같은 코드·데이터·AI·이동 설정을 사용하는지 확인한다.
2. 테스트 휴대폰의 Wi-Fi를 끄고 모바일 데이터로 링크를 열어 다른 망에서 접속되는지 확인한다.
3. 각각 올바른 참가자 번호 3개만 나오는지 확인한다. 01번 PIN은 `session-live/운영자_01번_PIN.txt`에서 해당 사람에게만 전달한다. 02·03번은 본인 PIN을 정한다.
4. 별도 모의 묶음에서 9명 입력·3개 후보·재접속·서버 재시작 기록 보존을 검사한다. 실제 실험방에 테스트 입력을 넣지 않는다.
5. 지도 표시, AI와 규칙 추천의 정확한 표시, A/B/C 계산·설명 배정을 확인한다. 세 후보가 같을 때도 있는지 원인을 검증한다.
6. Google 설문은 기존 혜인님의 폼을 사용한다. 앱은 제출 여부를 확인하지 않는다.

## 기록 내보내기

기존 도구를 그대로 사용한다. 공유 서버의 본 실험 묶음은 바깥 폴더 아래 `session-live`이다.

```sh
python3 scripts/experiment_export.py --bundle .local/friends-public/session-live --group hyein --out .local/exports/hyein-01
python3 scripts/experiment_export.py --bundle .local/friends-public/session-live --group joeun --out .local/exports/joeun-01
python3 scripts/experiment_export.py --bundle .local/friends-public/session-live --group yunjin --out .local/exports/yunjin-01
```

자동 수치는 설문 응답과 구분한다. 백업에는 기존 `experiment_support.py backup`을 사용한다. 재시작은 같은 커밋·설정·묶음으로 하면 방과 PIN을 유지한다. 새 코드/실험 조건은 새 묶음으로 시작한다.

공식 참고: https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/
