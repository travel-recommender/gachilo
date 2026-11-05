"""Apply the November evidence overlay without editing raw manual research.

This offline build pins the reviewed input bytes. Unknown facts stay unknown;
date eligibility is evaluated by validate_real_schedule, never schedule_ready.
"""
import copy
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'data/final/catalog_verification_20261104.json'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def apply(catalog, profiles, evidence):
    catalog, profiles = copy.deepcopy(catalog), copy.deepcopy(profiles)
    records = {r['place']['place_id']: r for r in catalog['places']}
    for pid, e in evidence['updates'].items():
        if pid not in records:
            raise ValueError('Unknown existing ID: ' + pid)
        r = records[pid]
        original = copy.deepcopy(r)
        if r['review'].get('final_csv', {}).get('record_status') == '제외' and e['status'] != 'held':
            raise ValueError('Excluded manual record needs a separate identity review: ' + pid)
        if not e['source_urls'] or any(not u.startswith('https://') or 'key=' in u for u in e['source_urls']):
            raise ValueError('Public evidence URLs required: ' + pid)
        if e['status'] not in ('held', 'eligible_for_dated_demo'):
            raise ValueError('Invalid verification status')
        r['place'].update(e['fields'])
        r['place']['verified_at'] = evidence['checked_at']
        r['place']['opening_hours_source'] = '; '.join(e['source_urls'])
        if not r['place']['website']:
            r['place']['website'] = e['source_urls'][0]
        for key in e['fields']:
            r['field_sources'][key] = {
                'kind': e.get('field_kinds', {}).get(key, 'dated_official_review'),
                'urls': e['source_urls'], 'checked_at': evidence['checked_at'],
                'note': e['field_notes'].get(key, '; '.join(e['conditions'])),
                'previous': {'value': original['place'].get(key), 'source': original['field_sources'].get(key)},
            }
        existing = r['review']['recommendation_blockers']
        if not set(e['resolved_blockers']) <= set(existing):
            raise ValueError('Review no longer matches prior blockers: ' + pid)
        blockers = [b for b in existing if b not in e['resolved_blockers']]
        r['review']['recommendation_blockers'] = list(dict.fromkeys(blockers + e['remaining']))
        r['review']['status'] = e['status']
        r['review']['schedule_ready'] = False
        r['review']['dated_verification'] = copy.deepcopy(e)
        if e.get('planning_policy'):
            p = e['planning_policy']
            r['review']['stay_policy'] = {'type': '시연 추정', 'min': p['stay_min'], 'max': p['stay_min'],
                'representative': p['stay_min'], 'method': p['note']}
        if e.get('meal_role'):
            r['review']['meal_role'] = e['meal_role']
        if e.get('building_id'):
            r['review']['building_id'] = e['building_id']
            if r['review'].get('within'):
                r['review']['within']['building_id'] = e['building_id']
                r['review']['within']['scheduling_policy'] = 'separate_requested_visits_same_building_transfer_estimate'
        if e.get('profile'):
            profile = copy.deepcopy(e['profile'])
            profile.update(valid_from=evidence['valid_from'], valid_through=evidence['valid_through'],
                checked_at=evidence['checked_at'], source_urls=e['source_urls'], cost_basis=e['cost_basis'])
            profiles['places'][pid] = profile
        if e['status'] == 'eligible_for_dated_demo':
            p = r['place']
            if r['review']['recommendation_blockers'] or not e.get('profile') or not e['profile'].get('window'):
                raise ValueError('Unresolved place cannot be promoted: ' + pid)
            if any(type(p[k]) not in (int, float) or not math.isfinite(p[k]) for k in ('latitude', 'longitude')):
                raise ValueError('Finite coordinate references required: ' + pid)
            if not 34 < p['latitude'] < 35 or not 135 < p['longitude'] < 136:
                raise ValueError('Coordinates outside Osaka review area: ' + pid)
            if p['category'] != '쇼핑' and (type(p['cost']) is not int or p['cost'] < 0):
                raise ValueError('Price required: ' + pid)
        r['review']['notes'].append('2026-11-04: ' + '; '.join(e['conditions']))
        r['review']['missing_fields'] = [k for k, v in r['place'].items() if v is None or v == '']
    for r in evidence['additions']:
        pid = r['place']['place_id']
        if pid in records or r['review']['schedule_ready'] is not False or not r['review']['recommendation_blockers']:
            raise ValueError('New collection must remain held until date-profile review: ' + pid)
        records[pid] = copy.deepcopy(r)
        catalog['places'].append(records[pid])
        catalog['area_schemes_by_place_id'][pid] = 'tourism_editorial_v1'
    catalog['dataset_status'] = 'dated_verification_with_separate_research_holds'
    catalog['scope'] = 'Search includes held research. Scheduling requires an eligible visit-date profile; production readiness is not asserted.'
    catalog['dated_verification_summary'] = {'checked_at': evidence['checked_at'],
        'updated': len(evidence['updates']), 'new_search_only': len(evidence['additions']),
        'promoted': sum(e['status'] == 'eligible_for_dated_demo' for e in evidence['updates'].values()),
        'date_range': [evidence['valid_from'], evidence['valid_through']]}
    profiles['notes'].append('2026-11-04: evidence overlay restores only individually reviewed calendars; old snapshots and remaining holds stay intact.')
    return catalog, profiles


def publish():
    e = read(EVIDENCE)
    for p, expected in e['input_sha256'].items():
        if sha(ROOT / p) != expected:
            raise ValueError('Input changed; reconcile review first: ' + p)
    data, profiles = apply(read(ROOT / e['catalog_input']), read(ROOT / e['profiles_input']), e)
    data['input_provenance']['november_verification'] = {'path': str(EVIDENCE.relative_to(ROOT)), 'sha256': sha(EVIDENCE)}
    manifest = read(ROOT / 'data/runtime_catalog.json')
    manifest.update(version='2026-11-04', catalog='final/osaka_catalog_20261104.json',
        profiles='final/osaka_profiles_20261104.json', searchable_count=len(data['places']),
        new_branch_count=sum(r['place']['place_id'].startswith('branch_') for r in data['places']),
        new_branch_dated_eligible_count=sum(r['place']['place_id'].startswith('branch_') and
            (r['review'].get('dated_verification') or r['review'].get('branch_verification',{})).get('status') == 'eligible_for_dated_demo' for r in data['places']),
        dated_verification='final/catalog_verification_20261104.json',
        supplemental_search_only_count=20 + len(e['additions']) - sum(
            x['status'] == 'eligible_for_dated_demo' and pid in {r['place']['place_id'] for r in read(ROOT / e['catalog_input'])['places'][205:]}
            for pid, x in e['updates'].items()))
    for filename, content in [('data/' + manifest['catalog'], data), ('data/' + manifest['profiles'], profiles), ('data/runtime_catalog.json', manifest)]:
        (ROOT / filename).write_text(json.dumps(content, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    return data['dated_verification_summary']


if __name__ == '__main__':
    print(json.dumps(publish(), ensure_ascii=False))
