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
