"""Publish a small, source-backed visit-date overlay without rewriting historical snapshots."""
import argparse
import copy
import json
from publish_verified_catalog import ROOT, apply, read, sha

CATALOG = 'data/final/osaka_catalog_20261116.json'
PROFILES = 'data/final/osaka_profiles_20261116.json'
EVIDENCE = 'data/final/catalog_verification_20261123.json'


def review(source, fields, profile, blockers, conditions, cost_basis, kind, *, aliases=None, meal=None):
    return {'status':'eligible_for_dated_demo', 'fields':fields, 'profile':profile, 'source_urls':source,
        'conditions':conditions, 'cost_basis':cost_basis, 'resolved_blockers':blockers, 'remaining':[],
        'planning_policy':{'stay_min':fields['stay_min'], 'note':'체류 시간은 일정 계산용 추정이며 대기·이동은 별도.'},
        'field_kinds':{'stay_min':'demo_model_estimate', 'bag_load':'team_rule_estimate', 'cost':kind},
        'field_notes':{'cost':cost_basis}, 'coordinates':{'kind':'retained_reviewed_map_reference',
          'source_urls':source, 'note':'공개 지도 참조 좌표. 입구·실측 좌표가 아님.'}, 'cost_kind':kind,
        **({'aliases':aliases} if aliases else {}), **({'meal_role':meal} if meal else {})}


def build():
    catalog, profiles = read(ROOT/CATALOG), read(ROOT/PROFILES)
    by_id={r['place']['place_id']:r for r in catalog['places']}
    def blockers(id): return by_id[id]['review']['recommendation_blockers']
    updates={}
    id='osaka_draft_316598fb77c9'
    updates[id]=review(['https://www.osaka-art-museum.jp/planned_exhibition/10412'],
      {'opening_hours':'기획전 기준 09:30~17:00, 최종입장 16:30. 월요일 휴관. 11/23 개관·11/24 휴관.',
       'stay_min':120,'cost':500,'bag_load':0},
      {'window':[570,1020,990], 'closed_weekdays':[1], 'holiday_moves_closure':True,
       'exceptions':{'2026-11-23':{'closed':False},'2026-11-24':{'closed':True}}}, blockers(id),
      ['동아시아 금공품 기획전 성인 일반 500엔. 특별전 요금 별도.', '휴관 및 임시 변경 가능.'],
      '기획전 성인 일반 500엔. 특별전·할인 대상 요금 별도.', 'official_ticket_price')
    id='osaka_006'
    updates[id]=review(['https://www.shinsaibashi.or.jp/contact/faq'],
      {'opening_hours':'상점가 산책 계획 11:00~19:00. 개별 점포의 영업시간·휴무는 서로 다름.',
       'stay_min':120,'bag_load':1},
      {'window':[660,1140,1020], 'visit_scope':'shopping_street_walk',
       'window_basis':'editorial_visit_window_not_business_hours'}, blockers(id),
      ['거리 산책 기준. 11~19시는 일정 계획 범위이며 전체 점포 공통 영업시간이 아님.', '개별 쇼핑 비용 별도.'],
      '거리 산책·쇼핑. 개인 구매액 별도.', 'not_applicable_shopping')
    id='osaka_draft_73505422b2e6'
    updates[id]=review(['https://www.city.osaka.lg.jp/kensetsu/page/0000493973.html'],
      {'opening_hours':'공공 교량 외관 산책 계획 09:00~22:00. 통행 제한은 현장 확인.',
       'stay_min':30,'cost':0,'bag_load':0},
      {'window':[540,1320,1290], 'visit_scope':'public_exterior_view',
       'window_basis':'editorial_visit_window_not_business_hours'}, blockers(id),
      ['공공 교량 외관 산책. 계획 시간은 공식 개방시간이 아니며 통행 제한 가능.'],
      '공공 교량 외관 산책 무료.', 'free_exterior_view')
    id='branch_namba_walk'
    updates[id]=review(['https://walk.osaka-chikagai.jp/service','https://walk.osaka-chikagai.jp/access','https://www.openstreetmap.org/way/54039110'],
      {'latitude':34.6670705,'longitude':135.5023085,'opening_hours':'쇼핑 10:00~21:00. 2026-11-18 정기휴무. 음식점은 점포별 확인.',
       'stay_min':60,'bag_load':2,'covered':True},
      {'window':[600,1260,1200], 'exceptions':{'2026-11-18':{'closed':True}}}, blockers(id),
      ['패션·잡화 점포 기준 10~21시. 식당·카페는 별도, 일부 매장 예외 있음.',
       '2026년 11월 정기 휴무일 18일. 좌표는 OpenStreetMap 보행로 대표 참조점이며 입구 아님.',
       '개인 쇼핑 금액 별도.'], '쇼핑 구매액 별도.', 'not_applicable_shopping')
    updates[id]['coordinates']['kind']='openstreetmap_way_reference_not_entrance'
    # A restaurant budget scenario is ten verified 150-yen basic plates, not a claim of average spending.
    for id,url,menu in [('branch_sushiro_namba_amza','https://www.akindo-sushiro.co.jp/shop/detail.php?id=2225','856'),
                   ('branch_sushiro_umeda_chayamachi','https://www.akindo-sushiro.co.jp/shop/detail.php?id=2369','870')]:
      updates[id]=review([url,'https://www.akindo-sushiro.co.jp/menu/menu_detail/?s_id='+menu],
        {'opening_hours':'평일 11:00~23:00, 토·일·공휴일 10:30~23:00. 최종 주문 22:30.',
         'stay_min':60,'bag_load':0,'covered':True,'cost':1500},
        {'window':[630,1380,1350], 'weekday_window':[660,1380,1350]}, blockers(id),
        ['매장 기본 메뉴 150엔 접시 10접시를 가정한 일정 예산 추정. 실제 주문·가격·품절에 따라 달라짐.',
         '60분은 식사 계획 추정이며 대기시간 별도.'],
        '150엔 기본 접시 10접시를 가정한 1,500엔 예산 추정. 모든 메뉴 또는 평균 식사 가격이 아님.',
        'official_budget_estimate', aliases='초밥|스시|회전초밥|sushi|스시로', meal='meal')
    evidence={'checked_at':'2026-11-23','valid_from':'2026-11-16','valid_through':'2026-11-30',
      'catalog_input':CATALOG,'profiles_input':PROFILES,
      'input_sha256':{CATALOG:sha(ROOT/CATALOG),PROFILES:sha(ROOT/PROFILES)},
      'limits':['실험 기간에 대한 공식 자료 검토. 이후 영업·가격 변동 및 당일 확인 필요.',
                '시장·상점가 산책 시간은 모든 점포 공통 영업시간이 아님.',
                '예산 추정은 구매 조합 가정이며 실제 지출과 다를 수 있음.'],
      'updates':updates,'additions':[]}
    return evidence


def publish(check=False):
    evidence=build(); data,profiles=apply(read(ROOT/CATALOG),read(ROOT/PROFILES),evidence)
    # Search aliases describe cuisine and retain each branch as a separate ID.
    for r in data['places']:
        e=evidence['updates'].get(r['place']['place_id'],{})
        if e.get('aliases'):
            collection=r['review'].setdefault('branch_collection',{})
            collection['aliases']='|'.join(dict.fromkeys((collection.get('aliases','')+'|'+e['aliases']).split('|'))).strip('|')
    profiles['checked_at']=evidence['checked_at']
    data['input_provenance']['week13_verification']={'path':EVIDENCE,'input_sha256':evidence['input_sha256']}
    manifest=read(ROOT/'data/runtime_catalog.json')
    manifest.update(version='2026-11-23-week13-v1',catalog='final/osaka_catalog_20261123.json',
      profiles='final/osaka_profiles_20261123.json',dated_verification='final/catalog_verification_20261123.json')
    for path,obj in [(ROOT/EVIDENCE,evidence),(ROOT/'data'/manifest['catalog'],data),
                     (ROOT/'data'/manifest['profiles'],profiles),(ROOT/'data/runtime_catalog.json',manifest)]:
        text=json.dumps(obj,ensure_ascii=False,indent=2,allow_nan=False)+'\n'
        if check:
            if path.read_text()!=text: raise ValueError('Output changed: '+str(path))
        else: path.write_text(text)
    return data['dated_verification_summary']


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true')
    print(json.dumps(publish(parser.parse_args().check),ensure_ascii=False))
