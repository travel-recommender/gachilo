# 공식 방문 조건 재확인 — 2026-11-18

이슈 #6의 조은 담당 자료 보완. **9곳의 영업시간·가격 18개 항목을 공식 페이지와 대조**했고, HEP FIVE의 **2026-11-19 휴관 1건**은 연도까지 교차 확인했다. 기존 값은 일치해 바꾸지 않고 출처 확인일과 세부 조건을 보강한다. 전체 238곳 재검증 완료는 아니다.

확인 날짜는 일 단위로 기록했다. 일반 안내의 적용 종료일이 공지되지 않은 경우 `null`이며, 오늘 확인했다고 실험 기간 전체에 적용된다는 뜻은 아니다. 원문 전체·검색 결과·메일은 저장하지 않고 사실 요약과 원문 링크를 기록한다.

| 장소 | 대조한 공식 안내 | 추가로 기록한 조건 |
| --- | --- | --- |
| 쓰텐카쿠 | [운영 안내](https://www.tsutenkaku.co.jp/annai/) | 일반 전망대와 특별 전망대 구분, 시간 지정 예약, 특별 운영일 별도 |
| 우메다 공중정원 | [시간·티켓](https://www.skybldg.co.jp/observatory/information/) | 최종 입장, 당일권/웹권, 악천후 옥상 제한 |
| HEP FIVE 관람차 | [관람차](https://www.hepfive.jp/ferriswheel) · [연도 명시 공식 입점사 공지](https://bandainamco-am.co.jp/chara_shop/ichibankuji-official-shop/NEWS/hepfive/news/20261102.html) | 11/19 휴관, 혼잡 시 탑승 마감이 앞당겨질 수 있음 |
| 오사카성 천수각 | [이용 안내](https://www.osakacastle.net/guide/) | 공원 전체와 구분, 학생 요금 증명, 연말연시 휴관 |
| 이치란 신사이바시 | [지점](https://ichiran.com/shop/kinki/shinsaibashi/) | 다음날 05:45 주문 마감, 추가 주문 별도 |
| 이치란 아베노 | [지점](https://ichiran.com/shop/kinki/abeno/) | 22:15 입장 마감 / 22:45 주문 마감 구분 |
| 이치란 우메다 시바타 | [지점](https://ichiran.com/shop/kinki/umeda-shibata/) | 지정 월 셋째 일요일·1/1·1/2 휴무, 22시 이후 별도 요금 |
| 이치란 우메다 한큐 히가시도리 | [지점](https://ichiran.com/shop/kinki/umeda-hankyu/) | 다음날 05:45 주문 마감, 혼잡 시 조기 입장 제한 |
| 이치란 난바 미도스지 | [지점](https://ichiran.com/np/shop/kinki/namba-midosuji.html) | 돼지고기 불사용 메뉴, 21:45 주문 마감. 연도 없는 8/16 특별시간은 날짜 규칙에 넣지 않음 |

## 남겨 둔 재확인

- [글리코 사인](https://www.glico.com/jp/health/contents/glicosign/): 점등 시간은 확인. 관람 장소의 통행시간·무료 여부를 같은 자료로 확인한 것처럼 처리하지 않는다.
- [신사이바시스지](https://www.shinsaibashi.or.jp/contact/faq): 점포별 시간이 다르다는 FAQ 확인. 공통 휴무·최종입장 규칙은 확정하지 않는다.
- [구로몬시장](https://kuromon.com/jp/): 직접 조회 429. 확인 성공 날짜를 기록하지 않고 재확인 대기. 지도 PDF를 영업시간 근거로 대체하지 않는다.
- [USJ 시간](https://www.usj.co.jp/web/ja/jp/park-guide/schedule/park-hour)·[티켓](https://www.usj.co.jp/web/ja/jp/tickets/lineup): 일반 조건만 확인. 날짜별 달력의 가격·시간은 이번 조회에서 확정하지 못했다. 본일 시간·최저가를 모든 방문일에 적용하지 않으며 #76의 별도 검증 자료도 덮어쓰지 않는다.
- 시바타점 심야요금의 금액과 적용 계산은 추가 확인 대상이다. 기본 라멘 가격만으로 심야 총액을 확정하지 않는다. 이번 자료팩은 캘린더·가격 계산 규칙을 바꾸지 않는다.

## 적용·검증

이 PR은 #82의 자료 관리 기능 위에 만든 **검토 자료팩**이다. 현재 runtime manifest·운영 프로필·실험 묶음·실행 서버는 변경하지 않는다. 다음 명령은 원본 값과 출처가 그대로인지 검사한 뒤 **새 폴더**에만 후보 카탈로그와 보고서를 생성한다.

```sh
python3 scripts/materialize_visit_evidence.py \
  --catalog data/final/osaka_catalog_20261112.json \
  --out .local/rag-followup-review
python3 -m unittest discover -s scripts -p test_materialize_visit_evidence.py
node --test scripts/test_official_rag_followup.mjs
```

검토자가 병합 후 사용할 최신 카탈로그를 `--catalog`로 명시한다. 지점 정보·값·기존 출처가 달라졌으면 중단하고 그 항목을 다시 대조한다. 해시를 임의 갱신해 통과시키지 않는다. 같은 자료팩 중복 적용이나 기존 출력 폴더 덮어쓰기도 거부한다.

- `catalog.json`: 기존 영업시간·가격·좌표·브랜드·선택 가능 상태는 그대로. 확인된 항목의 출처만 갱신하고 이전 출처는 `previous`에 보존.
- `review-report.json`: 입력/출력 해시, 범위, 부분 확인·조회 실패 목록. 상태는 `prepared_not_activated`.
- `review.visit_evidence`: 연도를 확인한 HEP 휴무 1건만 정확한 날짜의 근거로 추가. 엔진 프로필의 휴무는 이미 같은 값이며 수정하지 않음.

#76·#82와 최종 데이터 변경이 병합된 뒤, 새 코드·새 자료 기준으로 실험 묶음을 재생성하고 전체 일정·지도·설명 표시를 점검한다. 원래 실험 묶음에 새 파일을 덮어쓰지 않는다. 근거가 최신이어도 기간·예약·실시간 조회가 미확인이면 `확인 필요` 표시는 남는다.
