"""Publish reviewed visit conditions in a new snapshot; retain older experiments."""
import json
from publish_verified_catalog import ROOT, read, sha, apply
from publish_food_review_20261124 import eligible

CATALOG=ROOT/'data/final/osaka_catalog_food_20261124.json'
PROFILES=ROOT/'data/final/osaka_profiles_food_20261124.json'
MANIFEST=ROOT/'data/runtime_catalog.json'
OUT=ROOT/'data/final/osaka_catalog_remaining_20261124.json'
OUT_PROFILES=ROOT/'data/final/osaka_profiles_remaining_20261124.json'

def build():
    if sha(CATALOG)!='e0c3ef273beebb18136231f2bce60a732e278e62e3281007216567f3b3b3a8f7' or sha(PROFILES)!='b45957210681c9546b57b6e23f8c2d355295a4c43001be97a6f5a097153861f3':
        raise ValueError('Input snapshot changed; review and reconcile first')
    catalog, profiles=read(CATALOG),read(PROFILES)
    tea='osaka_draft_a270504b6cd8'
    e=eligible(['https://www.osakacastle.jp/news/hoshoan2026'],
        {'opening_hours':'2026-11-26 10:00~16:00, 최종 입장 15:30. 행사·연회로 임시휴업 가능.',
         'cost':1800,'stay_min':60,'bag_load':0,'covered':True},
        {'valid_from':'2026-11-26','valid_through':'2026-11-26','window':[600,960,930]},
        ['event_access_required','seasonal_event_date_confirmation_required','final_calendar_review_required'],
        ['운영자 공지상 2026년 11월 26일 목요일 10~16시 특별 공개. 11월 27일은 공지된 제외일.',
         '말차·과자 1,500엔과 니시노마루 정원 입장료 300엔을 합산한 1,800엔. 현금 결제.',
         '실내 다실 기준 60분은 일정 계획 추정. 야외 접근 동선·행사 취소·대기 시간은 별도.'],
        '운영자의 말차·과자 1,500엔 + 정원 입장 300엔. 임시휴무·별도 주문 확인.',
        'official_dated_price',role=None)
    e['field_kinds']['cost']='dated_official_review'
    museum='osaka_draft_50b7a6cc608f'
    m=eligible(['https://www.zojirushi.co.jp/corp/kinenkan/index.html'],
        {'opening_hours':'평일 10·11·13·14·15시 50분씩. 토·일·일본 공휴일·회사 휴일 휴관. 2일 전 예약 필요.',
         'cost':0,'stay_min':50,'bag_load':0,'covered':True},
        {'window':[600,950,900], 'windows':[[600,650,600],[660,710,660],[780,830,780],[840,890,840],[900,950,900]],
         'closed_weekdays':[0,6], 'closed_holidays':True, 'entry_time_reservation':True,'provisional_reservation':True},
        ['reservation_required','final_calendar_review_required'],
        ['공식 안내는 방문 2일 전까지 사전 예약, 평일 10·11·13·14·15시부터 약 50분, 무료라고 안내.',
         '회사 휴일·관내 작업일 및 해당 회차 예약 가능 여부 미확인. 일정 가안이며 예약은 이용자가 직접 진행.'],
        '공식 시설 이용 안내의 무료 견학 기준. 부대 비용은 별도.', 'official_free_reservation',role=None)
    m['field_kinds']['cost']='dated_official_review'
    catalog, profiles=apply(catalog,profiles,{'checked_at':'2026-11-24','valid_from':'2026-11-24','valid_through':'2026-11-30','updates':{tea:e,museum:m},'additions':[]})
    records={r['place']['place_id']:r for r in catalog['places']}
    records[tea]['review']['visit_notice']='11월 26일 특별 공개 기준 가안 · 연회 등 임시휴업 여부와 현금 결제를 확인하세요.'
    records[museum]['review']['recommendation_blockers'].append('entry_time_reservation_required')
    records[museum]['review']['reservation_notice']='방문 2일 전까지 예약 필요 · 일정은 가안이며 예약 시간과 가능 여부를 직접 확인해 주세요.'
    records[museum]['review']['visit_notice']='평일 정해진 회차에만 견학 가능 · 회사 휴일과 관내 작업일은 확인해 주세요.'
    # Floor admission uses a time slot; actual tickets must be acquired by the traveller.
    # Preserve prior closures and pre-24 lottery dates. Restrict tentative use to reviewed dates.
    for pid in ('branch_pokemon_osaka','branch_nintendo_osaka'):
        p=profiles['places'][pid]
        p['entry_time_reservation']=True
        p['provisional_reservation']=True
        p.pop('confirmation_weekdays',None)
        p.pop('confirmation_holidays',None)
        for day in range(24,31):
            key=f'2026-11-{day:02d}'
            p.setdefault('exceptions',{}).pop(key,None)
        url='https://shop.pokemon.co.jp/ja/shop/pokemoncenter-osaka/news/202611/000730.html'
        p['source_urls']=list(dict.fromkeys(p.get('source_urls',[])+[url,'https://www.lucua.jp/special/south-open/']))
        r=records[pid]
        r['review']['recommendation_blockers']=list(dict.fromkeys(r['review'].get('recommendation_blockers',[])+['entry_time_reservation_required']))
        r['review']['reservation_notice']='입장 정리권 확인 필요 · 일정은 가안이며 직접 정리권을 확보해 주세요.'
        r['review']['visit_notice']='루쿠아 캐릭터즈 월드 입장 제한이 있을 수 있어요. 현장 상황과 정리권을 확인하세요.'
        r['review']['notes'].append('2026-11-24: 11/24~30 입장 정리권 확보를 전제로 가안 선택 허용. 사용자에게 직접 확보 안내; 잔여·입장 가능을 보장하거나 예약하지 않음.')
        r['review']['entry_ticket_recheck']={'checked_at':'2026-11-24','status':'provisional_ticket_required',
            'valid_from':'2026-11-24','valid_through':'2026-11-30','source_urls':[url,'https://www.lucua.jp/special/south-open/'],
            'note':'포켓몬 공지는 층 WEB 정리권 및 별도 매장 정리권 가능성을 안내. 루쿠아 운영사는 혼잡에 따른 입장 제한 가능성을 안내. 실제 시간·수량·확보 여부는 미검증.'}
    # Explicitly record the changed published holiday, preserving held status.
    national=records['osaka_draft_ce3b8d452a0e']
    national['review']['notes'].append('2026-11-24: 공식 행사표는 전시 교체 휴관을 안내. 11/25~28 개관 여부는 해당 날짜를 공식 달력에서 재확인할 때까지 보류.')
    catalog.setdefault('input_provenance',{})['remaining_review_20261124']={'catalog_input_sha256':sha(CATALOG),'profiles_input_sha256':sha(PROFILES),
        'note':'전시·시간·입장 조건이 확인된 가안만 반영. 실제 입장권과 휴무는 방문 전 확인. 기존 스냅샷 보존.'}
    manifest=read(MANIFEST)
    manifest.update(version='2026-11-24-remaining-review-v1',catalog='final/'+OUT.name,profiles='final/'+OUT_PROFILES.name)
    for path,obj in ((OUT,catalog),(OUT_PROFILES,profiles),(MANIFEST,manifest)):
        path.write_text(json.dumps(obj,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    return len(catalog['places'])

if __name__=='__main__': print(build())
