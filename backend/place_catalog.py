"""Read-only adapter: source JPY and explicit planning estimates stay separate."""
import json, os
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from datetime import date
from pathlib import Path

DATA=Path(__file__).resolve().parents[1]/'data/week5/live_20260923/processed/osaka_places_150_fresh.json'
LIGHT_SHOPPING_PLACES={'구로몬시장','신사이바시스지 상점가','아메리카무라','신세카이'}

def get_luggage_score(place):
    if place['category']=='쇼핑':return 2
    return 1 if place['name_ko'] in LIGHT_SHOPPING_PLACES else 0

def stay_policy(record):
    p=record['place'];t=record['source']['tags']
    if t.get('tourism')=='theme_park':kind,lo,hi='테마파크',360,480
    elif t.get('shop') in ('mall','department_store'):kind,lo,hi='쇼핑몰·백화점',90,180
    elif p['category']=='쇼핑' or t.get('shop')=='convenience':kind,lo,hi='간단한 쇼핑',15,30
    elif p['category']=='카페':kind,lo,hi='카페',45,60
    elif p['category']=='식사':kind,lo,hi='식당',60,90
    elif t.get('amenity')=='place_of_worship':kind,lo,hi='신사·사찰·종교시설',45,90
    elif t.get('tourism')=='viewpoint':kind,lo,hi='전망대',60,90
    else:kind,lo,hi='관광 명소(문화·자연 포함)',90,120
    # Conservative representative at the upper end of the user-provided range.
    return {'type':kind,'min':lo,'max':hi,'representative':hi,'method':'사용자 제공 범위의 상한; 이동·대기시간 별도'}

def exchange_rate(value=None):
    value=os.environ.get('JPY_TO_KRW') if value is None else value
    if value is None or value=='':return None
    try:r=Decimal(str(value))
    except InvalidOperation:raise ValueError('JPY_TO_KRW must be positive KRW per 1 JPY')
    if not r.is_finite() or r<=0:raise ValueError('JPY_TO_KRW must be positive KRW per 1 JPY')
    exchange_rate_metadata(r) # Validate optional provenance at server startup, too.
    return r

def exchange_rate_metadata(rate):
    # Missing provenance remains explicit; a server setting is not a live quote.
    raw_date=os.environ.get('JPY_TO_KRW_AS_OF')
    source=os.environ.get('JPY_TO_KRW_SOURCE','').strip() or None
    as_of=None
    if rate is not None and raw_date:
        try:
            as_of=date.fromisoformat(raw_date).isoformat()
            if as_of!=raw_date:raise ValueError()
        except ValueError:raise ValueError('JPY_TO_KRW_AS_OF must be YYYY-MM-DD')
    return {'krw_per_jpy':str(rate) if rate is not None else None,
      'rounding':'ROUND_HALF_UP to integer KRW',
      'as_of':as_of,'source':source if rate is not None else None,
      'provenance_status':'unconfigured' if rate is None else 'documented' if as_of and source else 'incomplete',
      'live_quote':False}

def cost_krw(cost,rate):
    if cost is None:return None
    if isinstance(cost,bool) or not isinstance(cost,(int,float)) or cost<0:raise ValueError('invalid source JPY')
    n=Decimal(str(cost))
    if not n.is_finite():raise ValueError('invalid source JPY')
    if n==0:return 0
    if rate is None:return None
    return int((n*rate).quantize(Decimal('1'),rounding=ROUND_HALF_UP))

def project(record,rate):
    p=record['place'];out={k:v for k,v in p.items() if k not in ('cost','opening_hours_source','verified_at')}
    shopping=p['category']=='쇼핑' or p['name_ko'] in LIGHT_SHOPPING_PLACES
    out['cost_krw']=None if shopping else cost_krw(p['cost'],rate)
    out['cost_status']='not_applicable_shopping' if shopping else 'unknown' if p['cost'] is None else 'exchange_rate_required' if p['cost']>0 and rate is None else 'known'
    out['cost_basis']=record['field_sources'].get('cost',{}).get('note')
    out['stay_basis']=record['field_sources'].get('stay_min',{}).get('note')
    reasons=list(record['review']['recommendation_blockers'])
    for key in ('address','opening_hours'):
        if p[key] is None:reasons.append(key+'_missing')
    if out['cost_status'] in ('unknown','exchange_rate_required'):reasons.append(out['cost_status'])
    if not p['opening_hours_source']:reasons.append('hours_not_verified')
    # A human-readable opening-hours string is not a travel-date calendar.
    reasons.append('visit_date_hours_review_required')
    out['planning']={'schedule_ready':False,'review_required':list(dict.fromkeys(reasons)),
      'shopping_spend_excluded':shopping,'stay_range':record['review'].get('stay_policy'),
      'source_currency':'JPY','api_currency':'KRW'}
    return out

def catalog(query='',category=None,limit=150,path=DATA,rate=None):
    rate=exchange_rate(rate);raw=json.loads(Path(path).read_text(encoding='utf-8'))['places']
    matches=[r for r in raw if (not category or r['place']['category']==category) and
      (not query or query.casefold() in (' '.join(str(r['place'].get(k) or '') for k in ('name','name_ko','area'))).casefold())]
    return {'dataset':'osaka_review_150','total':len(matches),'currency':'KRW',
      'exchange_rate':exchange_rate_metadata(rate),
      'places':[project(r,rate) for r in matches[:limit]]}
