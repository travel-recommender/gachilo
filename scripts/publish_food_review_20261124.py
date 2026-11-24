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
        'field_kinds':{'cost':price_kind, 'stay_min':'demo_model_estimate',
                       **({'latitude':'reviewed_building_reference','longitude':'reviewed_building_reference'} if coordinate=='reviewed_building_reference_not_entrance' else {})},
        'field_notes':{'cost':basis, **({'latitude':'기존 백화점 건물 대표 좌표. 매장 입구 실측 아님.',
                      'longitude':'기존 백화점 건물 대표 좌표. 매장 입구 실측 아님.'} if coordinate=='reviewed_building_reference_not_entrance' else {})},
        'resolved_blockers':blockers, 'remaining':[],
        'conditions':conditions, 'cost_basis':basis, 'profile':profile, 'meal_role':role,
        'cost_kind':'official_budget_estimate',
        'coordinates':{'kind':coordinate,'source_urls':urls,'note':'기존 참조 좌표. 매장 출입구 실측 아님.'},
        'planning_policy':{'stay_min':fields['stay_min'],'note':'일정 시간 계획 추정; 줄 대기는 별도.'}}

def build():
    if sha(CATALOG) != '7e59c366be1ec7853af1d040f3359d3bce050db336cfea75247c0a37896acb1d' or sha(PROFILES) != '761aa2afc9fa376bd9c9662c834f94d88ebda7e1169330d8bb69bb86428dda6f':
        raise ValueError('Reviewed input changed; reconcile the evidence before publishing')
    catalog, profiles = read(CATALOG), read(PROFILES)
    updates = {
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
