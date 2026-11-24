"""Publish a date-limited food review as a new snapshot; preserve prior experiments."""
import json
from publish_verified_catalog import ROOT, apply, read, sha

CATALOG = ROOT / 'data/final/osaka_catalog_character_20261123.json'
PROFILES = ROOT / 'data/final/osaka_profiles_character_20261123.json'
OUTPUT = ROOT / 'data/final/osaka_catalog_food_20261124.json'
PROFILE_OUTPUT = ROOT / 'data/final/osaka_profiles_food_20261124.json'
MANIFEST = ROOT / 'data/runtime_catalog.json'

def eligible(urls, fields, profile, blockers, conditions, basis, price_kind, *, role='meal', coordinate='openstreetmap_node_reference_not_entrance'):
    return {'status':'eligible_for_dated_demo', 'source_urls':urls, 'fields':fields,
        'field_kinds':{'cost':'official_budget_estimate', 'stay_min':'demo_model_estimate',
                       **({'latitude':'map_listing_reference','longitude':'map_listing_reference'} if coordinate=='map_listing_reference_not_entrance' else {}),
                       **({'latitude':'reviewed_building_reference','longitude':'reviewed_building_reference'} if coordinate=='reviewed_building_reference_not_entrance' else {})},
        'field_notes':{'cost':basis, **({'latitude':'외부 지도에 표시된 지점 기준점. 입구 실측 아님.', 'longitude':'외부 지도에 표시된 지점 기준점. 입구 실측 아님.'} if coordinate=='map_listing_reference_not_entrance' else {}), **({'latitude':'기존 백화점 건물 대표 좌표. 매장 입구 실측 아님.',
                      'longitude':'기존 백화점 건물 대표 좌표. 매장 입구 실측 아님.'} if coordinate=='reviewed_building_reference_not_entrance' else {})},
        'resolved_blockers':blockers, 'remaining':[],
        'conditions':conditions, 'cost_basis':basis, 'profile':profile, 'meal_role':role,
        'cost_kind':'official_budget_estimate', 'price_evidence_kind':price_kind,
        'coordinates':{'kind':coordinate,'source_urls':urls,'note':'기존 참조 좌표. 매장 출입구 실측 아님.'},
        'planning_policy':{'stay_min':fields['stay_min'],'note':'일정 시간 계획 추정; 줄 대기는 별도.'}}

def build():
    if sha(CATALOG) != '7e59c366be1ec7853af1d040f3359d3bce050db336cfea75247c0a37896acb1d' or sha(PROFILES) != '761aa2afc9fa376bd9c9662c834f94d88ebda7e1169330d8bb69bb86428dda6f':
        raise ValueError('Reviewed input changed; reconcile the evidence before publishing')
    catalog, profiles = read(CATALOG), read(PROFILES)
    updates = {
        'osaka_draft_3d97f36846d0':eligible(
            ['https://www.endo-sushi.com/12450124631247512473.html','https://www.uoichi.co.jp/assets/2026.pdf','https://tabelog.com/osaka/A2701/A270108/27002698/dtlrvwlst/B529821964/','https://www.openstreetmap.org/node/4424700690'],
            {'opening_hours':'시장 영업일 평일 06:15~14:00 (주문마감 13:30)만 사용. 일·공휴일·토요일 제외.', 'cost':2800,'stay_min':60,'bag_load':0,'covered':True},
            {'window':[375,840,810], 'closed_weekdays':[0,6], 'closed_holidays':True}, ['final_calendar_review_required'],
            ['2026-11-25는 중앙시장 휴장 달력의 휴무일이 아니지만 업소 임시휴무와 실제 영업은 별도 확인. 토요일 표기가 출처마다 달라 제외.',
             '2026-06 방문 후기의 한 접시(5관) 1,400엔을 1인 2접시로 가정한 예산. 실가격·수량·세금 및 대기 별도.'],
            '2026-06 방문 후기 한 접시 1,400엔 × 2접시를 가정한 2,800엔 참고. 실제 주문·대기·가격 별도.', 'visitor_reported_menu_estimate'),
        'branch_viedefrance_bentencho':eligible(
            ['https://shop.viedefrance.co.jp/detail/149/','https://www.mapion.co.jp/phonebook/M01012/27107/G6712876-001/','https://map.yahoo.co.jp/v3/place/nH4t0iGcyxI/menu'],
            {'latitude':34.67010828,'longitude':135.46041742,'opening_hours':'07:00~20:30; 음료 주문마감 폐점 30분 전. 시설 휴관 확인.', 'cost':220,'stay_min':20,'bag_load':0,'covered':True},
            {'window':[420,1230,1200]}, ['branch_collection_review_required','entrance_coordinates_unconfirmed','stay_policy_unconfirmed','covered_unconfirmed','bag_load_unconfirmed','structured_date_profile_missing','area_scheme_unconfirmed','meal_role_not_full_meal','facility_relation_unconfirmed','current_menu_price_unconfirmed','map_reference_unconfirmed'],
            ['공식 지점의 베이타워 이스트 2층 주소·전화가 지도에 표시된 오크점과 동일. 점포 지도 기준점이며 출입구·층 이동은 실측 아님.',
             '지도 이용자가 올린 멜론빵 1개 220엔은 게시 시점과 타 점포 혼입 가능성이 있어 확정가 아닌 간식 예산 참고치.',
             '빵 1개 기준 간식 방문이며 식사 충족으로 취급하지 않음. 당일 재고·시설 휴관·가격은 별도 확인.'],
            '지도 이용자 게시 멜론빵 1개 220엔은 간식 예산 참고치. 당일 판매·가격·세금 별도 확인.', 'visitor_reported_menu_estimate',role='snack',coordinate='map_listing_reference_not_entrance'),
        'osaka_draft_c341bbd2440a':eligible(
            ['https://mercy-vegan-factory.owst.jp/','https://mercy-vegan-factory.owst.jp/foods','https://shop.mercy-vegan.jp/','https://www.mercy-vegan.jp/restaurants/','https://www.openstreetmap.org/node/10259462714'],
            {'address':'大阪市中央区瓦屋町2-4-15 1階西側','opening_hours':'월~금·일 점심 10:30~16:00; 토요일 휴무. 다른 영업 시간은 별도.', 'cost':1650,'stay_min':60,'bag_load':0,'covered':True},
            {'window':[630,960,960], 'closed_weekdays':[6]}, ['address_conflict','final_calendar_review_required'],
            ['공식 지점 예약·메뉴 페이지와 공식 쇼핑몰이 2-4-15를 사용. 다른 공식 소개 페이지의 2-4-5는 여전히 충돌하므로 출처와 함께 기록.',
             '식당 공식 페이지의 점심 김밥 1,650엔(세금 포함)을 예산 참고로 사용. 점포 운영·품절·임시휴무는 방문 전 확인.'],
            '공식 지점의 점심 김밥 1인 1,650엔(세금 포함) 참고. 가격·추가 주문 별도 확인.', 'restaurant_published_menu_reference'),
        'osaka_draft_7eda017e1ded':eligible(
            ['https://saijiki-syojin.com/shop/','https://tabelog.com/osaka/A2701/A270206/27135087/','https://tabelog.com/osaka/A2701/A270206/27135087/dtlrvwlst/B535794812/','https://www.openstreetmap.org/node/10755656305'],
            {'opening_hours':'수~일 11:30~14:00 점심만 사용. 월·화·공휴일은 자료 차이로 제외.', 'cost':1150,'stay_min':60,'bag_load':0,'covered':True},
            {'window':[690,840,810], 'closed_weekdays':[1,2], 'closed_holidays':True}, ['final_calendar_review_required'],
            ['기존의 난바 파크스·23시 표기는 다른 장소와 혼동된 정보로 제외. 텐노지 파크빌라 지점을 공식 주소와 OSM으로 대조.',
             '공식 페이지와 지도 정보가 다른 영업시간 중 공통 점심 구간만 사용. 공휴일 영업 여부도 충돌해 제외.',
             '2026-09 방문 기록의 볶음밥 세트 1,150엔은 참고 예산이며 세금과 현행 가격은 별도 확인.'],
            '2026-09 방문 기록의 볶음밥 세트 1인 1,150엔을 참고한 예산 추정. 현재 가격·세금 별도 확인.', 'visitor_reported_menu_estimate'),
        'branch_rikuro_namba_honten':eligible(
            ['https://www.rikuro.co.jp/shoplist/134.html','https://www.mapion.co.jp/phonebook/M02047/27128/22731170820/','https://www.nack5.co.jp/oricon/2494475/'],
            {'latitude':34.66610776,'longitude':135.50154973,'opening_hours':'1층 포장 판매 09:00~20:00. 2·3층 카페는 별도 운영.', 'cost':1165,'stay_min':20,'bag_load':1,'covered':True},
            {'window':[540,1200,1200]}, ['branch_collection_review_required','entrance_coordinates_unconfirmed','stay_policy_unconfirmed','covered_unconfirmed','bag_load_unconfirmed','structured_date_profile_missing','area_scheme_unconfirmed','meal_role_not_full_meal','visit_scope_and_cost_unconfirmed','map_reference_unconfirmed'],
            ['공식 지점 주소 3-2-28과 지도 목록을 대조한 점포 기준점. 출입구 위치 실측이 아니며 대기·매진 별도.',
             '2026-11-24부터 치즈케이크 한 판 1,165엔 보도 기준. 1인이 한 판 구매한다는 참고 가정; 나눔·구매 수량에 따라 달라짐.',
             '1층 포장 간식만 일정에 사용. 2·3층 카페 운영·가격은 적용하지 않음.'],
            '치즈케이크 한 판 1,165엔(세금 포함), 1인 1판 구매 가정. 나눔·가격 변경 별도.', 'reported_menu_price_reference',role='snack',coordinate='map_listing_reference_not_entrance'),
        'branch_coco_namba_ebisubashi':eligible(
            ['https://tenpo.ichibanya.co.jp/map/3123/','https://www.mapion.co.jp/phonebook/M01011/27128/ILSP0084917238_ipclm/','https://map.yahoo.co.jp/v3/place/GS-Kli2GRMY/menu'],
            {'latitude':34.66806523,'longitude':135.50151187,'opening_hours':'11:00 개점, 다음 날 03:00 주문마감. 일정에는 11:00~22:00만 사용.', 'cost':739,'stay_min':60,'bag_load':0,'covered':True},
            {'window':[660,1320,1320]}, ['branch_collection_review_required','entrance_coordinates_unconfirmed','stay_policy_unconfirmed','covered_unconfirmed','bag_load_unconfirmed','structured_date_profile_missing','area_scheme_unconfirmed','map_reference_unconfirmed','current_menu_price_unconfirmed'],
            ['공식 지점 주소·전화와 지도 목록이 일치. 지도 점포 기준점은 실제 입구 실측 아님.',
             '지도 이용자 게시 포크카레 739엔은 게시 시점·다른 지점 혼입 가능성이 있어 예산 참고로만 사용. 현행 가격·세금과 임시휴무 확인 필요.'],
            '지도 이용자 게시 포크카레 739엔은 구 메뉴일 수 있는 예산 참고치. 현행 지점 가격·세금·추가 토핑 별도 확인.', 'visitor_reported_menu_estimate',coordinate='map_listing_reference_not_entrance'),
        'branch_beardpapa_namba_walk':eligible(
            ['https://walk.osaka-chikagai.jp/index.php/shopguide/464','https://osakapoint.com/shop/shop-list/157/','https://www.ekiten.jp/shop_5652011/access/','https://gourmet.watch.impress.co.jp/docs/news/2156970.html'],
            {'latitude':34.668039,'longitude':135.498806,'opening_hours':'10:00~21:00. 난바워크 비정기 휴관 별도 확인.', 'cost':250,'stay_min':20,'bag_load':0,'covered':True},
            {'window':[600,1260,1260]}, ['branch_collection_review_required','entrance_coordinates_unconfirmed','stay_policy_unconfirmed','covered_unconfirmed','bag_load_unconfirmed','structured_date_profile_missing','area_scheme_unconfirmed','meal_role_not_full_meal','facility_relation_unconfirmed','current_menu_price_unconfirmed','map_reference_unconfirmed'],
            ['난바워크 공식 안내의 1번가 지점과 전화·주소를 매장 목록과 대조한 지도 기준점. 지하 출입구·층 이동은 실측 아님.',
             '2026-11 보도상 파이슈 1개 250엔은 체인 가격 참고로, 해당 지점 당일 가격·품절은 별도 확인.',
             '포장 간식만 반영하며 끼니로 취급하지 않음. 난바워크 임시휴관·대기시간 별도 확인.'],
            '2026-11 체인 보도의 파이슈 1개 250엔을 참고. 지점·가격·세금·수량은 방문 전 확인.', 'reported_menu_price_reference',role='snack',coordinate='map_listing_reference_not_entrance'),
        'branch_mizukakechaya_namba':eligible(
            ['https://www.rikimarugroup.com/brands/mizukakechaya/shops/namba/outline/','https://www.mapion.co.jp/phonebook/M01018/27128/GJ000957569-001/','https://www.openstreetmap.org/node/2332913807'],
            {'latitude':34.66810476,'longitude':135.50286065,'opening_hours':'매일 16:00~23:00, 주문마감 22:30. 임시휴무 확인.', 'cost':3000,'stay_min':90,'bag_load':0,'covered':True},
            {'window':[960,1380,1350]}, ['collected_visit_conditions_require_profile','structured_date_profile_missing','stay_policy_unconfirmed'],
            ['공식 주소·점포명과 지도 위치를 대조한 기준점. OSM 유사 명칭 점과 약 6m 차이이며 출입구 실측은 아님.',
             '식당의 공식 평균 예산 3,000엔은 주문·주류·인원에 따라 달라지는 참고치. 예약 불가 시간·대기 및 임시휴무 별도 확인.'],
            '공식 안내의 1인 평균 예산 3,000엔 참고. 특정 메뉴 확정 가격이 아니며 주류·주문에 따라 변동.', 'official_average_budget_estimate',coordinate='map_listing_reference_not_entrance'),
        'osaka_draft_3b1acd991668':eligible(
            ['https://retty.me/area/PRE27/ARE94/SUB9404/100000020105/', 'https://travel.yahoo.co.jp/kanko/spot-00017077/', 'https://www.openstreetmap.org/node/3923003857'],
            {'opening_hours':'월·목~일 10:00~15:00. 화·수는 자료 간 차이로 일정에서 제외.', 'cost':1480,'stay_min':60,'bag_load':0,'covered':True},
            {'window':[600,900,900], 'closed_weekdays':[2,3]}, ['final_calendar_review_required'],
            ['동일 주소의 2026년 방문 기록과 다수 자료에서 월·목~일 영업 확인. 수요일 휴무 정보는 자료 간 불일치하여 보수적으로 제외.',
             '후기에 기재된 중화소바 1,480엔은 현행 확정가가 아닌 예산 참고치. 임시휴무 및 줄 대기는 방문 전 확인.'],
            '2026년 방문 후기에 나온 중화소바 1,480엔을 예산 참고치로 사용. 당일 가격·세금 별도 확인.', 'visitor_reported_menu_estimate'),
        'osaka_draft_98a4211ed755':eligible(
            ['https://suzume-group.co.jp/kirinji/', 'https://blog.weblabo.jp/kirinji-osaka-aburasoba/', 'https://www.openstreetmap.org/node/6349557186'],
            {'opening_hours':'매일 11:30~16:30, 18:00~22:00. 임시휴무·재료 소진은 별도 확인.', 'cost':800,'stay_min':60,'bag_load':0,'covered':True},
            {'window':[690,990,990], 'windows':[[690,990,990],[1080,1320,1320]]},
            ['branch_unconfirmed','final_calendar_review_required'],
            ['공식 총본점 주소와 기존 OSM 점포 좌표 일치. 공식 및 OSM 공통 영업 구간만 사용.',
             '2026-09 방문 자료의 기본 아부라소바 800엔은 예산 참고치; 당일 가격과 임시휴무는 별도 확인.'],
            '2026-09 소개 자료의 아부라소바 800엔을 1인 예산 참고치로 사용. 현재 가격·세금 별도 확인.', 'visitor_reported_menu_estimate'),
        'osaka_draft_f8831852f028':eligible(
            ['https://tabelog.com/osaka/A2701/A270307/27040224/', 'https://map.yahoo.co.jp/v3/place/FYTBNJwaTtw', 'https://www.openstreetmap.org/node/7425697907'],
            {'opening_hours':'화요일 휴무; 월·수~일 영업. 일정에는 점심 11:30~14:00만 사용.', 'cost':1050,'stay_min':60,'bag_load':0,'covered':True},
            {'window':[690,840,840], 'closed_weekdays':[2]}, ['final_calendar_review_required'],
            ['동일 주소·영업시간과 2026년 방문 기록 확인. 점심 가격은 지도에 게시된 1,050엔을 예산 참고치로만 사용.',
             '점심 메뉴 판매 시간·임시휴무 및 세금은 방문 전 확인. 기존 OSM 위치는 입구 실측 아님.'],
            '지도 게시 점심 세트 1,050엔을 참고한 점심 예산 추정. 당일 메뉴·가격·세금 별도 확인.', 'reported_menu_price_reference'),
        'osaka_draft_d996a4118ab0':eligible(
            ['https://www.hotpepper.jp/strJ004612001/', 'https://tsunaguuu.com/gourmet/5525/', 'https://mrs.living.jp/osaka/town_gourmet/reporter/6774243', 'https://www.openstreetmap.org/node/6930081836'],
            {'opening_hours':'월~토 11:00~14:00 공통 시간만 사용; 일요일·공휴일 제외.', 'cost':1100,'stay_min':60,'bag_load':0,'covered':True},
            {'window':[660,840,840], 'closed_weekdays':[0], 'closed_holidays':True}, ['final_calendar_review_required'],
            ['2026년 지역 자료와 업소 안내의 공통 점심 시간만 사용. 실제 점심 메뉴·휴무는 현장 확인.',
             '2026년 방문 보도의 함박스테이크 1,100엔은 당일 확정 가격이 아닌 예산 참고치.'],
            '2026년 방문 보도의 함박스테이크 1,100엔을 식사 예산 참고치로 사용. 세금·메뉴·변동 별도 확인.', 'visitor_reported_menu_estimate'),
        'osaka_draft_f729469c78c5':eligible(
            ['https://tabelog.com/osaka/A2701/A270101/27061816/', 'https://retty.me/area/PRE27/ARE89/SUB8907/100000697442/', 'https://www.openstreetmap.org/node/3432264291'],
            {'opening_hours':'월·목~일 12:00~21:00 공통 시간만 사용; 화·수 제외.', 'cost':1800,'stay_min':60,'bag_load':0,'covered':True},
            {'window':[720,1260,1260], 'closed_weekdays':[2,3]}, ['final_calendar_review_required'],
            ['업소가 공개한 시간과 다른 자료의 차이를 피하려 화·수는 일정에서 제외.',
             '방문자가 적은 점심 세트 1,800엔은 참고 예산이며 현재 가격·메뉴·예약·임시휴무는 별도 확인.'],
            '방문 후기에 나온 점심 세트 1,800엔의 예산 참고치. 가격·세금·실제 메뉴 별도 확인.', 'visitor_reported_menu_estimate'),
        'branch_wanaka_dotonbori':eligible(
            ['https://www.takoyaki-wanaka.com/tenpo-dotonbori.html?250514','https://mahou-contents.mbs.jp/shops/35b1ba44-6731-454b-a111-d2f0e80894e2','https://www.mapple.net/spot/27015656/'],
            {'opening_hours':'11:00~21:00 공통 시간 사용. 부정기 휴무 별도 확인.', 'cost':700,'stay_min':20,'bag_load':0,'covered':False},
            {'window':[660,1260,1260]}, ['current_menu_price_unconfirmed'],
            ['MBS 2026-06 도톤보리점의 8개 700엔을 참고; 다른 보도의 가격과 달라 확정가가 아님.',
             '공식 지도 점포 기준점은 실측 출입구가 아님. 포장 간식이며 대기시간 별도.'],
            '2026-06 도톤보리점 방송 자료 8개 700엔을 1인 간식 예산 참고치로 사용. 다른 보도와 차이가 있어 실제 가격 확인.', 'reported_menu_price_reference',role='snack',coordinate='official_linked_map_poi'),
        'branch_wanaka_sennichimae':eligible(
            ['https://takoyaki-wanaka.com/tenpo-sennichimae.html','https://www.mapple.net/spot/27010533/','https://chun--blog.com/posts/namba-wanaka/'],
            {'opening_hours':'10:30~21:00 공통 시간 사용. 임시휴무 별도 확인.', 'cost':650,'stay_min':20,'bag_load':0,'covered':False},
            {'window':[630,1260,1260]}, ['current_menu_price_unconfirmed'],
            ['본점 8개 가격 자료가 500엔과 650엔으로 충돌해 650엔은 확정가가 아닌 예산 참고치.',
             '공식 지도 점포 기준점은 실측 출입구가 아님. 포장 간식이며 대기시간 별도.'],
            '본점 관광 안내의 8개 650엔을 1인 간식 예산 참고치로 사용. 다른 자료와 차이가 있어 실제 가격 확인.', 'reported_menu_price_reference',role='snack',coordinate='official_linked_map_poi'),
        'osaka_draft_1cdebcaa6534':eligible(
            ['https://www.unchi-co.com/jinrui_renewal/', 'https://www.jinrui-minamenrui.com/access/',
             'https://tabelog.com/osaka/A2701/A270301/27064584/', 'https://www.openstreetmap.org/node/6423399288'],
            {'opening_hours':'월~일 정규 영업 안내에서 공통으로 확인된 11:00~23:00만 일정에 사용. 재료 소진 시 조기 마감.',
             'cost':1060,'stay_min':60,'bag_load':0,'covered':True},
            {'window':[660,1380,1320]}, ['final_calendar_review_required'],
            ['공식 안내 둘의 공통 영업 범위만 사용. 실제 영업·재료 소진·리뉴얼 공지는 방문 전 확인.',
             '2026-11-14 실제 방문 후기의 macro 얇은 차슈 1,060엔은 메뉴별 확정 가격이 아닌 예산 참고치.',
             '2026-11-21~26 기간 한정 메뉴는 추가 요금이 있을 수 있음. 실제 주문·가격은 별도 확인.',
             '기존 OSM 점포 기준 좌표는 출입구 실측 아님. 체류 60분은 줄 대기 제외 추정.'],
            '2026-11-14 방문 후기에 나온 macro 얇은 차슈 1,060엔을 예산 참고. 세금 포함 여부·현재 가격과 한정 메뉴 추가비용 확인 필요.',
            'visitor_reported_menu_estimate'),
        'branch_rikuro_daimaru_umeda':eligible(
            ['https://www.rikuro.co.jp/shoplist/136.html',
             'https://www.daimaru.co.jp/umedamise/topics/260915rikuro.html',
             'https://www.nack5.co.jp/oricon/2494475/'],
            {'latitude':34.701731,'longitude':135.496386,'opening_hours':'판매 10:00~20:00. 백화점 휴관·품절 및 재개 일정 별도 확인.',
             'cost':1165,'stay_min':20,'bag_load':1,'covered':True},
            {'window':[600,1200,1200]},
            ['branch_collection_review_required','entrance_coordinates_unconfirmed','stay_policy_unconfirmed',
             'covered_unconfirmed','bag_load_unconfirmed','structured_date_profile_missing','area_scheme_unconfirmed',
             'meal_role_not_full_meal','facility_relation_unconfirmed','visit_scope_and_cost_unconfirmed','map_reference_unconfirmed'],
            ['공식 지점은 다이마루 우메다 지하 1층. 같은 건물의 기존 다이마루 대표 좌표를 사용해 실제 매장 입구·층 이동은 추정.',
             '치즈케이크 1개 1,165엔은 2026-11-24 전 점포 가격 변경 보도 기준. 1인 1개 구매 가정이며 나눠 먹으면 실제 개인 부담은 다름.',
             '쇼핑·포장 간식으로만 취급하며 점심·저녁 대체 식사가 아님. 대기·매진 및 백화점 휴관 별도 확인.',
             '갓 구운 판매 재개는 11/24 예정이라는 공지이며, 실제 재개·재고는 보장하지 않음.'],
            '치즈케이크 1개 1,165엔(세금 포함), 1인 1개 구매 가정. 나눔·구매 수량·가격 변경 별도.',
            'reported_menu_price_reference',role='snack',coordinate='reviewed_building_reference_not_entrance'),
        'osaka_draft_ff20bd4cf6b7':eligible(
            ['https://www.casablanca-osaka.jp/', 'https://casablancanamba.owst.jp/',
             'https://www.openstreetmap.org/node/13059162987'],
            {'opening_hours':'매일 07:00~24:00 (주문마감 23:00). 적용 메뉴는 아침 07:00~12:00.',
             'cost':1600,'stay_min':60,'bag_load':0,'covered':True},
            {'window':[420,720,720]}, ['final_calendar_review_required'],
            ['공식 점포 및 메뉴 주소·전화가 OSM 장소와 일치.',
             '아보카도 비건 베이글 1,600엔 세금 포함; 아침 메뉴 시간에만 계획.',
             'OSM 점포 기준 좌표는 출입구 실측이 아님. 대기와 임시휴무 별도 확인.'],
            '아침 아보카도 비건 베이글 1인 1,600엔(세금 포함); 추가 주문과 가격 변동 별도.',
            'restaurant_published_menu_reference'),
        'osaka_draft_89458a1abeda':eligible(
            ['https://tabelog.com/osaka/A2701/A270302/27084326/dtlmenu/lunch/',
             'https://www.openstreetmap.org/node/7461081830'],
            {'opening_hours':'월~금 점심 11:30~14:00, 주문마감 13:30; 공휴일 제외. 저녁은 별도.',
             'cost':1000,'stay_min':60,'bag_load':0,'covered':True},
            {'window':[690,840,810], 'closed_weekdays':[0,6], 'closed_holidays':True},
            ['final_calendar_review_required'],
            ['식당이 공개한 2026-08-14 점심 메뉴의 치킨 코코넛 카레 1,000엔(세금 포함).',
             '일정은 평일 점심만 사용. 매진·임시휴무·실제 대기시간은 방문 전 확인.',
             'OSM 점포 좌표 사용. 출입구 실측은 아님. 60분은 줄 대기 제외 추정.'],
            '평일 점심 치킨 코코넛 카레 1인 1,000엔(세금 포함), 추가 주문 제외. 방문 시 가격 확인.',
            'restaurant_published_menu_reference'),
        'osaka_draft_7d6ecfb032b6':eligible(
            ['https://www.aeon.jp/sc/osakadomecity/shop/store/food-185.html',
             'https://tabelog.com/osaka/A2701/A270401/27073333/dtlmenu/',
             'https://www.openstreetmap.org/node/12403674701'],
            {'opening_hours':'통상 11:00~21:00, 최종입점 20:00, 주문마감 20:30. 쇼핑몰 휴관·변경 별도 확인.',
             'cost':2120,'stay_min':60,'bag_load':0,'covered':True},
            {'window':[660,1260,1200]}, ['final_calendar_review_required'],
            ['쇼핑몰 공식 지점 안내의 통상 시간과 입점 마감. 기존 10시 개점 표기를 정정.',
             '지점 공개 메뉴(2025-12-30 갱신)의 오마카세 11종 세트 2,120엔을 예산 참고로 사용; 최신 가격 확정 아님.',
             '쇼핑몰의 비정기 휴관·매진·행사 및 실제 주문 가격은 방문 전 확인.',
             'OSM 점포 기준 좌표는 건물 출입구 실측이 아님. 60분 식사 추정, 대기 별도.'],
            '2025-12-30 지점 공개 11종 오마카세 세트 2,120엔(세금 포함)을 예산 참고치로 사용. 가격 변동·추가 주문 별도.',
            'historical_published_menu_estimate')}
    updates.update({
        'osaka_draft_35640888fa49': eligible(
            ['https://shelf-keybridge.com/jp/moto/kitahama/',
             'https://tabelog.com/osaka/A2701/A270102/27049833/',
             'https://retty.me/area/PRE27/ARE91/SUB9104/100000018854/',
             'https://www.openstreetmap.org/node/4572487891'],
            {'opening_hours':'북하마점 11:00~18:00, 주문마감 17:30. 부정기 휴무·임시 변경 확인.',
             'cost':650,'stay_min':60,'bag_load':0,'covered':True},
            {'window':[660,1080,1050]}, ['final_calendar_review_required'],
            ['공식 북하마점 및 타베로그의 주소가 일치. 11월 무휴 안내는 공지 연도를 독립 확인하지 못해 정규시간 참고로만 사용.',
             '방문 후기의 아이스커피 650엔은 1인 음료 예산 참고치이며 게시 시점·현행 가격·세금 확인 필요.',
             '실내 좌석과 야외 테라스가 함께 있어 실내 좌석 선택을 가정. 실외 이동까지 지붕이 보장되는 것은 아님.',
             '점포의 임시휴무·대기는 방문 전 별도 확인.'],
            '방문 후기의 아이스커피 1잔 650엔을 예산 참고치로 사용. 현재 가격·세금 별도 확인.',
            'visitor_reported_menu_estimate',role='snack'),
        'osm_node_2296903605': eligible(
            ['https://marufukucoffeeten.com/store/marufukucoffee-sennichimae/',
             'https://tabelog.com/osaka/A2702/A270202/27001450/',
             'https://news.livedoor.com/article/detail/30565796/',
             'https://www.mapple.net/spot/27010540/',
             'https://www.openstreetmap.org/node/2296903605'],
            {'opening_hours':'센니치마에 본점 08:00~23:00. 임시 변경 확인.',
             'cost':700,'stay_min':60,'bag_load':0,'covered':True},
            {'window':[480,1380,1350]}, [],
            ['공식 본점 08:00~23:00 및 주소를 타베로그 지점 정보와 대조.',
             '2026-02 보도 속 블렌드 700엔을 음료 예산 참고로 사용. 공식 메뉴 가격이 아니며 실제 가격·세금은 확인 필요.',
             '주문마감 22:30은 보조 안내를 기준으로 보수적으로 적용. 임시휴무와 좌석 대기는 별도 확인.'],
            '2026-02 보도상 블렌드 700엔은 1인 음료 예산 참고. 현재 가격·세금 별도 확인.',
            'reported_menu_price_reference',role='snack'),
        'osm_node_9875632529': eligible(
            ['https://ekikan.com/shops/485',
             'https://tabelog.com/osaka/A2701/A270206/27091465/',
             'https://map.yahoo.co.jp/v3/place/Y9b3pT5ihvg/menu',
             'https://www.openstreetmap.org/node/9875632529'],
            {'opening_hours':'난바 에키칸점 공통 11:00~17:00만 계획. 부정기 휴무·임시 단축 확인.',
             'cost':450,'stay_min':60,'bag_load':0,'covered':True},
            {'window':[660,1020,990]}, ['final_calendar_review_required'],
            ['공식 입점시설은 평일 09~20시·주말 08~20시, 타베로그는 11~20시와 단축 09~17시를 함께 표기. 서로 공통인 11~17시만 계획.',
             '지도 사용자 게시 드립커피 380~450엔 중 상한 450엔을 1인 음료 예산 참고로 사용. 게시 시점과 실제 가격·세금 확인.',
             '부정기 휴무와 임시 단축이 공지될 수 있으므로 방문 전 확인. 실내 좌석 기준이며 이동 경로의 지붕은 별개.'],
            '지도 사용자 게시 드립커피 380~450엔 중 450엔을 참고한 예산. 현재 지점 가격·세금 별도 확인.',
            'visitor_reported_menu_estimate',role='snack'),
        'osaka_draft_c85fa26beb80': eligible(
            ['https://www.0101.co.jp/085/index.html',
             'https://www.0101.co.jp/085/event/',
             'https://www.0101.co.jp/085/access/',
             'https://www.openstreetmap.org/node/13026741817'],
            {'opening_hours':'판매장 기본 11:00~20:00. 일부 매장 운영시간은 다름.',
             'stay_min':180,'bag_load':2,'covered':True},
            {'window':[660,1200,1200]}, [],
            ['운영사의 2026년 11월 행사 달력과 해당 월 무휴 안내를 확인. 임시 변경과 매장별 휴무는 별도 확인.',
             '판매장 방문만 계산하며 쇼핑 구매금액은 개인에 따라 달라 미산정.'],
            '입장료가 아닌 개인 쇼핑 구매비는 산정하지 않음.', 'shopping_spend_not_included',role=None),
        'spot_ebisubashi': eligible(
            ['https://www.city.osaka.lg.jp/kensetsu/page/0000021695.html',
             'https://osaka-info.jp/experience/ja/osaka/spot/551',
             'https://heritage.jsce-kansai.net/heritage/detail.html?id=236'],
            {'latitude':34.669074,'longitude':135.501290,
             'opening_hours':'공공 보행교 산책; 일정은 09:00~21:00으로 한정. 행사·공사 등 통행 제한 별도 확인.',
             'cost':0,'stay_min':20,'bag_load':0,'covered':False},
            {'window':[540,1260,1260]},
            ['collected_visit_conditions_require_profile','structured_date_profile_missing','stay_policy_unconfirmed'],
            ['오사카 관광안내는 다리를 무료 명소로 소개. 글리코 간판 건물과 다른 공공 보행교.',
             '좌표는 토목학회가 공개한 다리 대표 좌표이며 실제 사진 촬영 위치나 입구 실측이 아님.',
             '09~21시는 공식 개방시간을 확인했다는 의미가 아닌 시연용 산책 계획 범위. 행사·공사 시 통행 제한을 확인.'],
            '공공 보행교 관람 무료. 인근 상점 구매·크루즈는 별도.',
            'official_public_access_free',role=None,coordinate='map_listing_reference_not_entrance'),
        'osaka_draft_e5eb4dd70807': eligible(
            ['https://www.sotcoffee.com/pages/shop-osaka',
             'https://tabelog.com/osaka/A2701/A270104/27112223/',
             'https://retty.me/area/PRE27/ARE92/SUB9203/100001562439/',
             'https://www.openstreetmap.org/node/6886072023'],
            {'opening_hours':'오사카 덴마바시점 08:00~19:00, 주문마감 18:30. 임시휴무 확인.',
             'cost':680,'stay_min':60,'bag_load':0,'covered':True},
            {'window':[480,1140,1110]}, [],
            ['공식 덴마바시점 주소·시간을 타베로그와 대조. 북하마점이나 신사이바시점과 다른 지점.',
             '2026-09 방문 후기 아메리카노 680엔을 1인 음료 예산 참고치로 사용. 실제 지점 가격·세금은 확인 필요.',
             '점포 내 1·2층 좌석 기준, 외부 접근 경로에 지붕이 있다는 뜻은 아님. 임시휴무·대기 별도.'],
            '2026-09 방문 후기의 아메리카노 680엔을 예산 참고. 실제 가격·세금 확인.',
            'visitor_reported_menu_estimate',role='snack'),
        'osaka_draft_d52fee5c2304': eligible(
            ['https://hollys-corp.jp/shop/o_sakaisujihon/',
             'https://hollys-corp.jp/menu/',
             'https://tabelog.com/osaka/A2701/A270106/27017523/',
             'https://www.openstreetmap.org/node/2389282617'],
            {'opening_hours':'공통 07:00~21:00만 사용. 주문마감 20:30, 부정기 휴무 별도 확인.',
             'cost':300,'stay_min':60,'bag_load':0,'covered':True},
            {'window':[420,1260,1230]}, ['branch_unconfirmed','final_record_review_required','final_calendar_review_required'],
            ['공식 사카이스지혼마치점 주소와 타베로그를 대조. 공식 평일 06:30~23:00·주말 06:30~21:00과 타베로그 07:00~22:00 이상의 공통 구간만 사용.',
             '공식 체인 메뉴의 블렌드 R 300엔은 예산 참고치. 해당 지점의 현장 가격과 세금·부정기 휴무 별도 확인.'],
            '공식 체인 메뉴의 블렌드 R 300엔 참고. 지점별 가격·세금 별도 확인.',
            'chain_menu_price_reference',role='snack'),
        'osaka_draft_b0a5c9b0d460': eligible(
            ['https://www.herbis.jp/restaurant-cafe/detail/154',
             'https://tabelog.com/osaka/A2701/A270101/27002136/',
             'https://map.yahoo.co.jp/v3/place/rEl62eSvS16/menu',
             'https://www.openstreetmap.org/node/4572487893'],
            {'opening_hours':'하비스 PLAZA ENT점 공통 10:00~22:00, 주문마감 21:30. 시설 휴관·변경 확인.',
             'cost':430,'stay_min':60,'bag_load':0,'covered':True},
            {'window':[600,1320,1290]}, ['website_mismatch','branch_unconfirmed','final_calendar_review_required'],
            ['공식 입점시설과 타베로그 주소·전화가 일치. 주중·주말의 공통 10~22시와 주문마감만 사용.',
             '지도 사용자 게시 블렌드 350~430엔 중 430엔은 다른 지점 정보가 섞였을 수 있는 예산 참고치. 실제 가격·세금 별도 확인.',
             '실내 좌석 선택 기준이며 야외 테라스와 외부 접근 경로는 별도. 시설 임시휴관·대기 확인.'],
            '지도 이용자 게시 블렌드 350~430엔 중 430엔 참고. 동일 메뉴의 타 지점·옛 가격 혼입 가능.',
            'visitor_reported_menu_estimate',role='snack'),
    })
    updates['spot_ebisubashi']['cost_kind'] = 'official_free_admission'
    updates['spot_ebisubashi']['field_kinds']['cost'] = 'dated_official_review'
    evidence={'checked_at':'2026-11-24','valid_from':'2026-11-24','valid_through':'2026-11-30',
              'updates':updates,'additions':[]}
    catalog, profiles = apply(catalog, profiles, evidence)
    # Published 2026 reports and a restaurant directory identify this exact
    # branch as closed. Remove only from the new snapshot, keeping history.
    closed_id = 'osaka_draft_20aa5444aadd'
    before = len(catalog['places'])
    catalog['places'] = [r for r in catalog['places'] if r['place']['place_id'] != closed_id]
    if len(catalog['places']) != before - 1:
        raise ValueError('Closed branch identity changed; review before removing')
    profiles['places'].pop(closed_id, None)
    catalog.get('area_schemes_by_place_id', {}).pop(closed_id, None)
    catalog.setdefault('retired_records', []).append({
        'place_id':closed_id, 'checked_at':'2026-11-24', 'reason':'closure_reported_2026',
        'source_urls':['https://ameblo.jp/ramania/entry-12971473370.html',
                       'https://ramendays.jp/restaurant/QZKNUPrXcbu5WMBI',
                       'https://toyotune.blog107.fc2.com/?tag=%E9%BB%92%E9%86%A4%E6%B2%B9%E3%83%A9%E3%83%BC%E3%83%A1%E3%83%B3'],
        'note':'복수의 2026년 폐점 보도와 지점별 식당 목록을 근거로 새 서비스 목록에서 제외. 옛 실험 스냅샷은 유지. 다른 목록은 운영상태를 미확인으로 표시.'})
    ramen=next(r for r in catalog['places'] if r['place']['place_id']=='osaka_draft_1cdebcaa6534')
    collection=ramen['review'].setdefault('branch_collection',{})
    collection['aliases']='|'.join(filter(None,[collection.get('aliases',''),'라멘|라면|라멘집|ramen|らーめん']))
    bee=next(r for r in catalog['places'] if r['place']['place_id']=='osaka_draft_94d63b518da4')
    bee['review']['recommendation_blockers']=[b for b in bee['review']['recommendation_blockers']
        if b != 'google_maps_permanently_closed'] + ['official_indefinite_closure']
    bee['review']['notes'].append('2026-11-24: 공식 공지상 2026-04-25부터 무기한 휴업. 영구 폐업으로 단정하지 않고 보류 유지. https://bee9-osaka.com/')
    bee['review']['food_recheck']={'checked_at':'2026-11-24','status':'indefinitely_closed_not_permanent',
                                  'source_url':'https://bee9-osaka.com/'}
    catalog['input_provenance']['food_review_20261124']={'catalog_input_sha256':sha(CATALOG),
      'profiles_input_sha256':sha(PROFILES),'valid_from':'2026-11-24','valid_through':'2026-11-30',
      'notes':['휴무 미공고·재고·가격 변동은 보장하지 않음. 기존 실험 스냅샷 미변경.',
               '영구 폐업이 확인되지 않은 휴업 매장은 임의 삭제하지 않음.']}
    manifest=read(MANIFEST)
    manifest.update(version='2026-11-24-food-review-v1',catalog='final/'+OUTPUT.name,
                    profiles='final/'+PROFILE_OUTPUT.name,searchable_count=len(catalog['places']))
    for p,obj in ((OUTPUT,catalog),(PROFILE_OUTPUT,profiles),(MANIFEST,manifest)):
        p.write_text(json.dumps(obj,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    return len(catalog['places'])

if __name__=='__main__': print(build())
