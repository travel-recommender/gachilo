# 2026-09-30 운영 정보 추가 검토

150곳 유지. 주소 148/150, 영업시간 132/150. 영업시간 5곳과 비용 2곳을 추가 확인했습니다.

한국어명·체류시간·짐 증가량은 150곳 입력되어 있습니다. 체류시간과 짐은 팀 추정 기준을 포함합니다. 모든 장소의 schedule_ready는 false이며, 실제 방문일 검증과 일정 엔진 연결은 완료되지 않았습니다.

## 이번에 반영한 근거

- **신세카이**: 2026-09-30: 신세카이 지역 Google Maps 7일 모두 24시간 표시. 점포·쓰텐카쿠의 운영시간으로 사용하지 않음. https://maps.google.com/?cid=3941168473429300987
- **오사카 텐만구**: 2026-09-30: 공식 2022년 여름 개문 시간 공지는 현재 연중 시간으로 적용하지 않음. 지도 17시 표시는 수여소와 경내 개방 구분이 필요하여 영업시간 null 유지. https://osakatemmangu.or.jp/1332
- **블룸 갤러리**: 2026-09-30: 2026-03-27 공지: 2026년 4월 일부 판매 업무 재개, 2026년 전시 계획 없음. 월별 운영일은 별도 공지. 영구 폐업으로 단정하지 않으며 전시 방문 추천은 보류. https://www.bloomgallery103.com/index.html
- **도톤보리 교**: 2026-09-30: 도톤보리바시 Google Maps 7일 모두 24시간 표시. 다리 통행과 주변 시설 운영을 구분. https://maps.google.com/?cid=7388810500975723854
- **찻집 아오이**: 2026-09-30: 공식 ACCESS와 하단 영업시간·휴무일이 서로 다름(월 휴무/화 휴무). 충돌 해소 전 영업시간 null 유지. https://kissaaoiclub.com/
- **다이코 하수도 견학시설**: 2026-09-30: 오사카시 지하 견학은 무료, 약 20분, 사전 신청 필요. 지상 관찰창과 지하 견학을 구분. 평일 09:00~17:30은 담당 부서 연락 시간으로 방문 영업시간에 입력하지 않음. 체류시간은 이동·대기 포함 기존 팀 추정값 유지. https://www.city.osaka.lg.jp/kensetsu/page/0000010446.html
- **호쇼안 다실**: 2026-09-30: 2026 공개 다도 체험 1인 1,500 JPY. 니시노마루 정원 입장료 별도이므로 전체 방문 비용이 아님. https://osaka-info.jp/special/dc/event/detail605/
- **메이윈즈**: 2026-09-30: MayWinds, 船越町2-4-1 지점의 Google Maps 요일별 7일 시간표 확인. 사용자 제공 가격 범위는 비용에 반영하지 않음. https://maps.google.com/?cid=17132172652483626966
- **가스가에 공원**: 2026-09-30: かすがえ公園, 都島本通1丁目19, 좌표와 주소 일치. Google Maps 7일 모두 24시간 표시. https://maps.google.com/?cid=3778987939280037928

## 남은 주소·영업시간

폐업·휴업은 시간을 추정해 채우지 않습니다. 예약 시설은 방문 확정 전 자동 일정에 넣지 않으며, 신원 불명 장소는 원본을 보존하고 추천을 보류합니다.

| 장소 | 미확인 필드 | 보류 사유 | 출처/확인 대상 |
|---|---|---|---|
| 오사카 텐만구 (`osaka_010`) | opening_hours | 방문일 운영시간 확인 필요 | https://osakatemmangu.or.jp/ |
| 오에이피 항구 (`osaka_draft_bdd1ec5175d0`) | opening_hours | google_maps_temporarily_closed | https://www.suito-osaka.jp/info/port/oap/ |
| 와케 다리 (`osaka_draft_f0f97440bedc`) | opening_hours | identity_unconfirmed | node/12781301802 |
| 쓰쓰미 교자 포토존 (`osaka_draft_1c4a0fd86b91`) | address, opening_hours | identity_unconfirmed, address_unconfirmed | node/14097975136 |
| 다이코 하수도 견학시설 (`osaka_draft_85b3463e84b9`) | opening_hours | reservation_required | https://www.city.osaka.lg.jp/kensetsu/page/0000010446.html |
| 게마 갑문 (`osaka_draft_84378ff5ba08`) | opening_hours | access_conditions_unconfirmed | node/9473994121 |
| 디자인 뮤지엄 (`osaka_draft_40d8be797d5b`) | opening_hours | identity_unconfirmed, website_mismatch, google_maps_permanently_closed | node/2373447958 |
| 갤러리 사사키 상점 (`osaka_draft_6eda07803129`) | opening_hours | reservation_or_exhibition_required | http://www.gallerysasaki.com/ |
| 블룸 갤러리 (`osaka_draft_43502b1cfa97`) | opening_hours | operating_status_unconfirmed, gallery_exhibitions_suspended | https://www.bloomgallery103.com/index.html |
| 일본성공회 성속주교회 예배당 (`osaka_draft_07d2c797a410`) | opening_hours | access_conditions_unconfirmed | https://www.hakuaisha-welfare.net/redeemer/ |
| 신 우메다시티 하나노 (`osaka_draft_0cf4fe2e0afe`) | opening_hours | 방문일 운영시간 확인 필요 | https://www.skybldg.co.jp/study/ |
| 호타루마치 광장 (`osaka_draft_0adb7945fbda`) | opening_hours | parent_facility_address | way/1314581362 |
| 산와 공원 (`osaka_draft_cff5e2720c53`) | opening_hours | city_boundary_unconfirmed, outside_osaka_city | way/1454586896 |
| 헬로 라이프 (`osaka_draft_2b9dd68b687a`) | opening_hours | category_mismatch | https://co.hellolife.jp/ |
| 미하 숍 (`osaka_draft_fa65b053e525`) | address, opening_hours | address_unconfirmed | way/257771954 |
| 뷰르 한큐 미쿠니 (`osaka_draft_31878d4960fc`) | opening_hours | 방문일 운영시간 확인 필요 | node/12913067534 |
| 찻집 아오이 (`osaka_draft_74dbaeea6a02`) | opening_hours | hours_conflict | https://kissaaoiclub.com/ |
| 이치란라멘 (`osm_node_2546559085`) | opening_hours | permanently_closed | http://www.ichiran.co.jp/tenpo/kin_douton.html |
