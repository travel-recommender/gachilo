# Google 장소 ID 연결

`data/google_place_links.json`은 로컬 장소 ID와 OSM 객체 ID를 Google Place ID에 연결한다. 2026-09-24 사용자가 전달한 카페 2곳의 API 테스트 결과를 바탕으로 연결했다.

| 로컬 ID | 대상 지점 |
| --- | --- |
| osm_node_2296903605 | 마루후쿠 커피 센니치마에 본점 |
| osm_node_9875632529 | 브루클린 로스팅 컴퍼니 난바 |

지점 명칭은 기존 로컬 데이터의 표기다. 과거 osaka_029와 osaka_030은 다른 위치의 ID이므로 연결하지 않는다.

사용할 때는 `place_id`로 연결 정보를 찾고 `google_place_id`로 Place Details (New)를 조회한다. Google 응답의 주소·영업시간·영업 상태를 기존 OSM 기반 데이터에 자동 저장하거나 공식 검증값으로 덮어쓰지 않는다. 연결일은 장소의 모든 정보가 검증된 날짜가 아니다.

이번 변경에서는 API 키와 Google 응답 상세정보를 저장하지 않았다. 실제 API 추가 호출이나 앱 화면 연결도 수행하지 않았다. API 키는 실행 환경변수로 전달한다.

관련 정책: https://developers.google.com/maps/documentation/places/web-service/policies
