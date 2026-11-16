# Railway 공용 실험 서버

노트북·같은 Wi-Fi 없이 그룹별 링크로 접속한다. 서버 한 서비스 안에서 팀원 / 조은 친구 / 혜인 친구 / 윤진 친구의 방·SQLite·접속키를 분리한다. 각 그룹은 3명이다. 기존 노트북 실험 기록을 가져오거나 덮어쓰지 않는다.

## 배포 설정

- Dockerfile: `Dockerfile.experiment`, Railway 설정: `railway.json`, 시작: `python3 scripts/experiment_cloud.py`
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

서버 배포 성공과 정식 실험 시작 가능은 별개다. HTTPS·휴대폰·지도·AI·영업정보·공동 후보·설문·저장·재접속을 확인한 뒤 실험을 시작한다. 현재 통합 브랜치는 미병합 PR #74·#75도 포함하므로 본 실험 전 리뷰 완료와 버전 고정이 필요하다.

현재 알려진 통합 점검 항목:
- #75 긴 지점명이 모바일에서 잘림: 리뷰에서 수정 요청.
- 지점 교체 후 개인 설명·내보내기 만족도는 아직 원래 장소 ID 비교를 사용한다. 윤진의 지점 설명 후속과 기록 계산을 함께 맞추기 전 정식 실험에 사용하지 않는다.
- 클라우드 OSRM은 아직 별도 연결하지 않았다. 이동 수치는 추정식이며 실제 도보 경로로 설명하면 안 된다.
- A·B·C는 입력에 따라 같을 수 있다. 결과를 임의로 다르게 만들지 않는다.
