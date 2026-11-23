# 캐릭터·가챠 매장 점검 (2026-11-23)

- 신사이바시 PARCO 5층 가샤폰 공식점: [운영사 매장 안내](https://bandainamco-am.co.jp/others/gashapon-bandai-officialshop/store/shinsaibashi_P/). 정규 영업 10:00~20:00. PARCO 공지·임시휴무 확인 필요.
- HEP FIVE 9층 가샤폰의 데파토: [운영사 매장 안내](https://bandainamco-am.co.jp/others/capsule-toy-store/store/hepfive/). 구역별 마감이 달라 일정 계산은 11:00~21:00로 보수적으로 잡는다. [운영사 건물 휴관 공지](https://bandainamco-am.co.jp/chara_shop/ichibankuji-official-shop/NEWS/hepfive/news/20261102.html)에 따라 11월 19일 제외.
- 한큐산반가이 남관 B1 치이카와 랜드: [시설 공식 매장 안내](https://www.h-sanbangai.com/shop/detail/408). 정규 영업 10:00~21:00, 혼잡 시 입장 제한 가능. [시설 공지](https://www.h-sanbangai.com/service/)에 따라 11월 18일 제외.
- 기존 키디랜드 오사카 우메다점에도 같은 11월 18일 시설 휴관을 추가한다. [매장 공식 휴관 안내](https://www.kiddyland.co.jp/mu_dollymix07/)도 확인했다.
- [아메리카무라](https://osaka-info.jp/spot/america-mura-american-village/)는 거리 산책 범위로 검토해 일정 선택을 허용한다. 11~19시는 계획 시간이며 상점 전체가 영업하는 시간을 뜻하지 않는다. 개별 점포의 휴무·쇼핑 비용은 별도다.
- [쿠라스시 난바 센니치마에](https://shop.kurasushi.co.jp/detail/660)·[도톤보리](https://shop.kurasushi.co.jp/detail/567)는 지점별 시간과 145엔부터인 접시 가격을 확인했다. 145엔 접시 10개를 가정한 1,450엔은 예산 하한 추정이며 실제 주문·재고·가격은 달라질 수 있다. 60분 체류는 대기 제외 추정. 도톤보리점 공휴일 영업시간이 별도로 확인되지 않아 공휴일은 보류한다.
- 이치란 도톤보리 본관은 [운영사 영업 종료 공지](https://ichiran.com/shop/hourstable.html)와 기존에 보관한 지점 주소를 대조해 새 카탈로그에서 제외했다. 별관은 유지하고 이전 카탈로그·실험 스냅샷은 보존한다.
- 신설 장소의 좌표는 각각 기존 검토 데이터의 동일 건물 좌표를 재사용했다. 실제 출입구 좌표가 아니며, 쇼핑·캡슐 이용료는 개인별 지출로서 비용 합계에서 빠진다. 정규 영업시간은 당일 운영의 보장이 아니다.
- 기존 와나카 두 지점에 타코야키·타코야끼 검색어를 추가했다. 가격 자료가 서로 달라 일정 자동 배치는 계속 보류한다. 예: [2026년 8월 자료를 인용한 650엔](https://holiplo.com/ja/osaka/p/wanaka-sennichimae), [2026년 4월 방문기 700엔](https://tonburi7.blog.fc2.com/blog-entry-2682.html). 같은 지점 가격으로 단정하지 않는다.
- 신규 데이터는 `python3 scripts/publish_character_gacha_20261123.py`로 이전 11월 23일 검토본에서 만든다. 이전 카탈로그와 실험 스냅샷은 보존한다.
- 105곳 전체 확인은 진행 중이다. 전체 흐름 테스트에서 기존 단언은 선택 지점의 합법적인 같은 브랜드 대체를 허용하지 않아 실패했다. 교체 결과의 `branch.fromPlaceId`가 선택 지점을 가리키는 경우도 확인해 통과했다. 이 변경만으로 배포 또는 실험 준비 완료를 판단하지 않는다.
