"""Add source-reviewed Osaka character/capsule shops without touching prior snapshots."""
import copy
import json
from pathlib import Path
from publish_verified_catalog import ROOT, read, sha

INPUT = ROOT / 'data/final/osaka_catalog_20261123.json'
PROFILE_INPUT = ROOT / 'data/final/osaka_profiles_20261123.json'
OUT = ROOT / 'data/final/osaka_catalog_character_20261123.json'
PROFILE_OUT = ROOT / 'data/final/osaka_profiles_character_20261123.json'
MANIFEST = ROOT / 'data/runtime_catalog.json'

def build():
    data, profiles = read(INPUT), read(PROFILE_INPUT)
    by_id = {r['place']['place_id']: r for r in data['places']}
    # Facility and tenant operator each independently announce closure on this date.
    closure_url = 'https://www.h-sanbangai.com/service/'
    kiddy = by_id['branch_kiddyland_umeda']
    profile = profiles['places']['branch_kiddyland_umeda']
    profile.setdefault('exceptions', {})['2026-11-18'] = {'closed': True}
    profile['source_urls'] = list(dict.fromkeys(profile['source_urls'] + [closure_url]))
    profile['checked_at'] = '2026-11-23'
    kiddy['review']['notes'].append('2026-11-18 阪急三番街 휴관. 쇼핑몰 및 키디랜드의 휴관 안내 확인.')
    # Cuisine searches should find existing branches even while their price is held.
    for pid in ('branch_wanaka_sennichimae','branch_wanaka_dotonbori'):
        branch = by_id[pid]['review']['branch_collection']
        branch['aliases'] += '|타코야키|타코야끼|타코야키집|takoyaki|たこ焼き'
    # Building coordinates are already present in the reviewed catalog; not shop entrances.
    specs = [
      {'id':'gacha_shinsaibashi_parco', 'ko':'가샤폰 반다이 공식샵 신사이바시 PARCO점',
       'ja':'ガシャポンバンダイオフィシャルショップ心斎橋PARCO店', 'area':'신사이바시',
       'address':'大阪府大阪市中央区心斎橋筋1-8-3 心斎橋PARCO 5F', 'coord':'osaka_024',
       'url':'https://bandainamco-am.co.jp/others/gashapon-bandai-officialshop/store/shinsaibashi_P/',
       'extra':['https://www.parco.co.jp/pdf/jp/store/storage/cname_20261030113101.pdf'],
       'hours':'10:00~20:00. PARCO 휴관 및 매장 공지에 따름.', 'window':[600,1200,1200],
       'aliases':'가챠|가차|가샤폰|캡슐토이|gacha|ガチャガチャ|ガシャポン|반다이|신사이바시',
       'building':'shinsaibashi_parco','exception':{}},
      {'id':'gacha_hep_five', 'ko':'가샤폰의 데파토 HEP FIVE점',
       'ja':'ガシャポンのデパートHEP FIVE店', 'area':'우메다',
       'address':'大阪府大阪市北区角田町5-15 HEP FIVE 9F', 'coord':'osaka_008',
       'url':'https://bandainamco-am.co.jp/others/capsule-toy-store/store/hepfive/',
       'extra':['https://bandainamco-am.co.jp/chara_shop/ichibankuji-official-shop/NEWS/hepfive/news/20261102.html'],
       'hours':'11:00~22:30 (구역별 상이). 계획상 21:00까지. 11/19 건물 휴관.', 'window':[660,1260,1260],
       'aliases':'가챠|가차|가샤폰|캡슐토이|gacha|ガチャガチャ|ガシャポン|우메다|헵파이브',
       'building':'hep_five','exception':{'2026-11-19':{'closed':True}}},
      {'id':'chiikawa_land_umeda', 'ko':'치이카와 랜드 오사카 우메다점',
       'ja':'ちいかわらんど大阪梅田店', 'area':'우메다',
       'address':'大阪府大阪市北区芝田1-1-3 阪急三番街 南館B1F', 'coord':'branch_kiddyland_umeda',
       'url':'https://www.h-sanbangai.com/shop/detail/408',
       'extra':['https://chiikawa-info.jp/p21/tenpo/index.html',closure_url],
       'hours':'10:00~21:00. 11/18 한큐산반가이 휴관.', 'window':[600,1260,1260],
       'aliases':'치이카와|치이카와랜드|치이카와 랜드|캐릭터샵|캐릭터 굿즈|chiikawa|ちいかわ|키디랜드',
       'building':'hankyu_sanbangai_south','exception':{'2026-11-18':{'closed':True}}},
    ]
    for s in specs:
        assert s['id'] not in by_id
        ref = by_id[s['coord']]['place']
        urls = [s['url'], *s['extra']]
        cost_note = '상품·가챠 이용료는 개인 구매액으로 일정 예산에서 제외. 무료라는 뜻이 아님.'
        coord_note = '검토된 해당 건물 기준점 재사용. 매장 출입구 실측 좌표 아님; 건물 내 이동 별도.'
        place = {'place_id':s['id'],'name':s['ja'],'name_ko':s['ko'],'category':'쇼핑',
          'area':s['area'],'address':s['address'],'latitude':ref['latitude'],'longitude':ref['longitude'],
          'opening_hours':s['hours'],'cost':None,'stay_min':30,'bag_load':2,'covered':True,
          'website':s['url'],'opening_hours_source':'; '.join(urls),'verified_at':'2026-11-23',
          'brand_id':None,'branch_group_id':None}
        fs = {key:{'kind':'official_web_review','urls':urls,'checked_at':'2026-11-23'}
              for key in ('name','address','opening_hours','opening_hours_source')}
        fs.update({key:{'kind':'building_reference','urls':urls,'checked_at':'2026-11-23','note':coord_note}
                   for key in ('latitude','longitude')})
        fs['cost']={'kind':'shopping_excluded','urls':urls,'checked_at':'2026-11-23','note':cost_note}
        fs['stay_min']={'kind':'demo_model_estimate','note':'쇼핑 방문 30분 추정. 대기시간 별도.'}
        conditions=['개별 매장·건물 휴관 및 임시 영업변경을 방문 전 확인.', cost_note, coord_note]
        if s['id']=='gacha_hep_five': conditions.append('2026-11-19 HEP FIVE 건물 휴관. 구역별 영업종료 차이가 있어 21시까지 보수적으로 계획.')
        if s['id']=='chiikawa_land_umeda': conditions.append('2026-11-18 한큐산반가이 휴관. 혼잡 시 입장 정리권 가능.')
        verification={'status':'eligible_for_dated_demo','conditions':conditions,'cost_kind':'shopping_excluded',
          'coordinates':{'kind':'reviewed_building_reference_not_entrance','source_urls':urls},'source_urls':urls}
        record={'place':place,'field_sources':fs,
          'source':{'kind':'official_web_review','urls':urls,'checked_at':'2026-11-23','osm_ref':None,'coordinate_method':'reviewed_building_reference_not_entrance','tags':{}},
          'review':{'status':'eligible_for_dated_demo','schedule_ready':False,'official_checks':[],
            'recommendation_blockers':[],'missing_fields':['cost'],'notes':conditions,
            'stay_policy':{'type':'시연 추정','min':30,'max':30,'representative':30,'method':'쇼핑 30분 추정, 대기시간 별도.'},
            'area_scheme':'tourism_editorial_v1','area_basis':'official_address_editorial_area',
            'engine_category_id':'shopping','meal_role':None,'building_id':s['building'],
            'branch_collection':{'brand':'가샤폰' if s['id'].startswith('gacha_') else '치이카와',
              'official_name':s['ja'],'aliases':s['aliases'],'remaining':''},
            'dated_verification':verification}}
        data['places'].append(record)
        data['area_schemes_by_place_id'][s['id']]='tourism_editorial_v1'
        profiles['places'][s['id']]={'valid_from':'2026-11-16','valid_through':'2026-11-30',
          'window':s['window'],'exceptions':s['exception'],'source_urls':urls,'checked_at':'2026-11-23',
          'cost_basis':cost_note,'window_basis':'official_regular_hours_with_event_period_context'}
    data['input_provenance']['character_gacha_20261123']={
      'catalog_input_sha256':sha(INPUT),'profiles_input_sha256':sha(PROFILE_INPUT),
      'notes':['기존 카탈로그·실험 스냅샷은 변경하지 않음. 신규 매장은 건물 대표좌표 사용.',
               '확인 가능한 정규 영업시간과 공지된 휴관을 반영. 비공고 임시휴무·입장제한은 보장하지 않음.']}
    manifest = read(MANIFEST)
    manifest.update(version='2026-11-23-character-gacha-v1',catalog='final/'+OUT.name,
                    profiles='final/'+PROFILE_OUT.name,searchable_count=len(data['places']))
    for path,obj in [(OUT,data),(PROFILE_OUT,profiles),(MANIFEST,manifest)]:
        path.write_text(json.dumps(obj,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    return len(data['places'])

if __name__ == '__main__':
    print(build())
