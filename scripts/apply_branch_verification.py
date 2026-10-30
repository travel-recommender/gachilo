"""Apply independently evidenced branch facts to the demo, preserving raw collection."""
import copy, hashlib, json, math
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / 'data/final/branch_verification_20261026.json'
RESOLVED = {'branch_collection_review_required', 'entrance_coordinates_unconfirmed',
    'stay_policy_unconfirmed', 'covered_unconfirmed', 'bag_load_unconfirmed',
    'structured_date_profile_missing', 'area_scheme_unconfirmed',
    'meal_role_not_full_meal', 'facility_relation_unconfirmed'}

def apply_verification(catalog, calendars, collection_bytes, verification=None):
    v = json.loads(PATH.read_text(encoding='utf-8')) if verification is None else verification
    if hashlib.sha256(collection_bytes).hexdigest() != v['collection_sha256']:
        raise ValueError('Branch collection changed: recheck verification mapping')
    result, profiles = copy.deepcopy(catalog), copy.deepcopy(calendars)
    branches = {r['place']['place_id']: r for r in result['places'] if 'branch_collection' in r['review']}
    if set(branches) != set(v['places']):
        raise ValueError('Verification IDs must exactly match new branch IDs')
    eligible = 0
    for pid, e in v['places'].items():
        record = branches[pid]; p, review = record['place'], record['review']
        if e['place_id'] != pid or e['status'] not in ('held','eligible_for_dated_demo'):
            raise ValueError('Invalid verification identity/status')
        sources = e['source_urls']
        if not sources or any(not u.startswith('https://') or 'key=' in u for u in sources):
            raise ValueError('Expected public source links without credentials')
        c, policy = e['coordinates'], e['planning_policy']
        if e['status'] == 'eligible_for_dated_demo':
            if e['remaining'] or not e['profile'].get('window') or not e['opening_hours']:
                raise ValueError('Unresolved branch cannot be enabled')
            if any(type(c[k]) not in (int,float) or not math.isfinite(c[k]) for k in ('latitude','longitude')):
                raise ValueError('Missing finite map reference')
            if not 34 < c['latitude'] < 35 or not 135 < c['longitude'] < 136:
                raise ValueError('Map reference outside Osaka review area')
            if p['category'] != '쇼핑' and (type(e['cost_jpy']) is not int or e['cost_jpy'] < 0):
                raise ValueError('Food/experience cost cannot be invented or omitted')
            if type(policy['stay_min']) is not int or policy['stay_min'] <= 0 or policy['bag_load'] not in (0,1,2):
                raise ValueError('Invalid explicit planning policy')
            review['recommendation_blockers'] = [b for b in review['recommendation_blockers'] if b not in RESOLVED]
            eligible += 1
        else:
            # Retain pending decisions but replace the generic hold with concrete remaining facts.
            review['recommendation_blockers'] = list(dict.fromkeys(e['remaining']))
        for key in ('latitude','longitude'): p[key] = c[key]
        p.update(opening_hours=e['opening_hours'], opening_hours_source='; '.join(sources),
                 cost=e['cost_jpy'], stay_min=policy['stay_min'], bag_load=policy['bag_load'],
                 covered=e['covered'], verified_at=e['checked_at'], website=sources[0])
        for key in ('latitude','longitude'):
            record['field_sources'][key] = {'kind':c['kind'],'urls':sources,'checked_at':e['checked_at'],'note':c['note']}
        for key in ('opening_hours','opening_hours_source','covered'):
            record['field_sources'][key] = {'kind':'dated_branch_review','urls':sources,'checked_at':e['checked_at'],'note':e['space_type'] if key=='covered' else '; '.join(e['conditions'])}
        record['field_sources']['cost'] = {'kind':e['cost_kind'],'urls':sources,'checked_at':e['checked_at'],'note':e['cost_basis']}
        for key in ('stay_min','bag_load'):
            record['field_sources'][key] = {'kind':'demo_model_estimate','note':policy['note']}
        review.update(status=e['status'], schedule_ready=False, branch_verification=copy.deepcopy(e),
            stay_policy={'type':'지점별 시연 추정','representative':policy['stay_min'],'min':policy['stay_min'],
                         'max':policy['stay_min'],'method':policy['note']},
            area_basis='editorial_demo_grouping_by_verified_branch_location',
            notes=e['conditions'], missing_fields=[k for k,x in p.items() if x is None or x==''])
        # Keep raw collection, original within evidence and proposals as history.
        if e.get('within'): review['within'] = copy.deepcopy(e['within'])
        if e.get('building_id'): review['building_id'] = e['building_id']
        if e['profile'].get('window'): profiles['places'][pid] = copy.deepcopy(e['profile'])
    result['branch_verification_summary'] = {'reviewed':len(branches),'eligible_for_dated_demo':eligible,
        'held':len(branches)-eligible,'checked_at':v['checked_at'],'production_schedule_ready':False}
    result['collection_summary']['new_dated_demo_eligible_count'] = eligible
    result['scope'] = 'Complete search catalog with separately verified dated demo branches; check every visit date.'
    profiles['notes'].append('2026-10-26 branch review: map reference coordinates, explicit model estimates and dated restrictions; raw collection unchanged.')
    return result, profiles
