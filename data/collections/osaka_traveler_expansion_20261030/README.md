# 오사카 여행자 선택지 보완 · 2026-10-30

공식 매장·시설 안내를 검색하고 지점별로 정리한 12곳이다. 별도 카페 8곳과 함께 서비스 검색 목록을 **205 → 225곳**으로 확장한다. 신규 20곳은 날짜별 일정 검증이 남아 있어 자동 배치하지 않는다.

| 구분 | 추가 지점 | 운영 정보 근거 |
|---|---|---|
| 식사 | 스시로 난바 암자 / 우메다 차야마치 | [난바](https://www.akindo-sushiro.co.jp/shop/detail.php?id=2225), [우메다](https://www.akindo-sushiro.co.jp/shop/detail.php?id=2369) |
| 식사 | 코코이치방야 난바 에비스바시 | [공식 매장](https://tenpo.ichibanya.co.jp/map/3123/) |
| 식사 | 마츠야 난카이 난바 | [공식 매장](https://pkg.navitime.co.jp/matsuyafoods/spot/detail?code=0000000260) |
| 식사 | 야요이켄 닛폰바시 | [공식 매장](https://store.yayoiken.com/b/yayoiken/info/1083/) |
| 식사 | 마루가메 제면 우메다 | [공식 매장](https://stores.marugame.com/111094) |
| 간식 | 리쿠로 오지상 난바 본점 / 다이마루 우메다 | [난바](https://www.rikuro.co.jp/shoplist/134.html), [우메다](https://www.rikuro.co.jp/shoplist/136.html) |
| 간식 | 비어드파파 난바워크 | [공식 상가](https://walk.osaka-chikagai.jp/index.php/shopguide/464) |
| 빵 | 비드프랑스 벤텐초 | [공식 시설](https://baytower.jp/omise/viedefrance/) |
| 체험 | 유니버셜 스튜디오 재팬 | [운영 일정](https://www.usj.co.jp/web/ja/jp/park-guide/schedule/park-hour), [입장권](https://www.usj.co.jp/web/ja/jp/tickets/lineup) |
| 체험 | 가이유칸 | [운영 일정](https://www.kaiyukan.com/info/hours/), [입장권](https://www.kaiyukan.com/info/ticket/kaiyukan/) |

## 비용·시간의 의미

- 스시로 150엔부터는 **한 접시**, USJ 8,400엔부터는 **성인 1일 입장권 최저 표시가**다. 각각 식사 전체 예산·특정 방문일 확정가로 사용하지 않는다.
- 마츠야 심야 가산(22:00–05:00 약 7%), 코코이치방야 익일 03:00 주문 마감, 마루가메의 10/29 정비 휴업 공지를 보존한다.
- 리쿠로 난바 1층 판매점과 위층 카페 시간을 구분한다. 4개 디저트·빵 지점은 `meal_role=snack`으로, 점심·저녁 한 끼 대체를 승인하지 않는다.
- 가이유칸은 방문일 변동 요금제다. OSM의 과거 요금 및 공식 페이지 HTML의 2024년 예시 값을 현재 값으로 쓰지 않는다.
- 체류시간·예산·입장권·방문일 예외가 미확정이면 null과 검토 사유를 유지한다.

## 지도·OSRM 대조

`location_route_evidence.json`에 카페를 포함한 **11곳의 공식 지도 좌표 후보**와 자체 도보 OSRM(포트 5001)의 실제 응답 요약을 기록했다. 전부 `Ok`, 도로 연결점까지의 스냅 거리는 각 끝점 100m 이내였다. 도보 서버 구성 근거는 [OSRM 실행 기록](../../../docs/osrm.md)의 foot.lua 전처리 기록이다.

- 경로가 나온다고 영업 중이거나 입구가 맞다는 뜻은 아니다. 실내 층간 이동·엘리베이터·개찰구·대기열은 이 조회로 검증하지 않는다. 장소 좌표 필드는 아직 null이며 후보 좌표는 검토 기록에만 있다.
- OSRM 거리·시간은 지도/프로필의 모델 결과다. 1.2km 이상 조회도 조사 목적으로 남겼으며, 서비스의 장거리 이동 처리 규칙을 바꾸지 않았다.
- 야요이켄은 공식 지도 링크와 schema 좌표가 다르다. 지도 링크는 기존 OSM 지점에서 약 13m 떨어져 있지만 입구 확정은 보류한다.
- 스시로 난바는 공식 핀과 지점명이 같은 OSM 노드를 대조했다. OSM 자료 시점은 **2026-09-23**으로 당일 최신 지도라고 표현하지 않는다.
- USJ의 OSM 다각형 중심을 입구로 쓰지 않는다. 실제 입구 확인을 남겼다.
- OSM 출처: © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright). 공개 공식 페이지와 자체 OSRM만 사용했으며 유료 지도 API를 호출하지 않았다.

## 여행 편의 참고 5건

`travel_support.json`: n・e・s・t 난바 짐 보관, 야마토 난바역 앞 보관, 난카이 난바역 출입/엘리베이터 안내, 오사카역 시공의 광장, 가이유칸 보관함. 각 기록에 공식 출처·확인일·요금 단위·미확인 조건이 있다.

이 5건은 **225곳 집계와 관광/식당 추천 풀에서 제외**한다. 자료 파일 및 manifest 경로만 제공하며 화면에 별도 보조 정보 패널을 연결한 상태는 아니다.

## 재현

저장소 루트에서 `python3 scripts/build_expanded_catalog.py`. 원래 CSV·55곳 수집표·205곳 검증본을 보존하고 `osaka_catalog_20261030.json`과 runtime manifest를 만든다. 네트워크 재조회 없이 같은 입력으로 재현한다.
