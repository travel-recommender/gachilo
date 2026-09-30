# 장소 데이터 추가 보완 및 CSV

이번 추가 조사: 22개 장소, 빈칸 65개 추가 보완.
9월 28일 누적 보완: 빈칸 316개. 장소 수 150개 유지.

| 필드 | 이번 조사 전 빈칸 | 조사 후 빈칸 |
|---|---:|---:|
| name_ko | 110 | 110 |
| area | 42 | 31 |
| address | 42 | 33 |
| opening_hours | 26 | 23 |
| cost | 127 | 118 |
| stay_min | 147 | 147 |
| bag_load | 150 | 150 |
| covered | 127 | 116 |
| website | 12 | 11 |
| opening_hours_source | 66 | 57 |
| verified_at | 39 | 27 |

CSV의 빈 셀은 미확인(null), 숫자 0은 출처로 확인된 무료입니다. covered=true는 주요 실내/지붕 공간, false는 주요 야외 공간이며 혼합·불명확은 빈 셀입니다.
공식 번역이 없는 한국어명, 팀 규칙인 짐 증가량, 일반 방문자의 체류시간은 임의로 채우지 않았습니다. 비용·체류시간은 cost_basis와 stay_basis의 시나리오를 확인하세요.
기존 OSM 영업시간에는 공식 확인이 없는 값도 있습니다. opening_hours_source가 빈 셀이면 공식 검증 완료가 아닙니다. 모든 장소의 schedule_ready=false를 유지합니다.
추가 자료는 필드별 출처와 review_notes에 기록했습니다. 이번 CSV는 150개 전체 데이터이며 폐업·예약 조건 등도 포함합니다.
