#!/usr/bin/env python3
"""Build an isolated review preview from branch research; never promote or overwrite.

The existing canonical records stay byte-for-byte unchanged on disk and structurally
unchanged in the preview. Existing-place updates remain explicit proposals.
"""
import argparse
import copy
import hashlib
import json
import math
import re
from collections import Counter
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'data/week5/live_20260923/processed/osaka_places_150_fresh.json'
COLLECTION = ROOT / 'data/collections/osaka_branches_20261019/branches.json'
FIELDS = ('place_id', 'name', 'name_ko', 'category', 'area', 'address',
          'latitude', 'longitude', 'opening_hours', 'cost', 'stay_min',
          'bag_load', 'covered', 'website', 'opening_hours_source', 'verified_at')
KINDS = {'official_web_review', 'official_mall_listing', 'official_shopping_street_listing'}
CATEGORIES = {'명소', '문화', '자연', '쇼핑', '카페', '식사', '체험·오락', '복합문화'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def url(value):
    if not isinstance(value, str):
        return False
    p = urlparse(value)
    return p.scheme in ('http', 'https') and bool(p.hostname) and not p.username and not p.password


def validate(base, collection):
    require(isinstance(base.get('places'), list), 'Base must have a places list.')
    records = base['places']
    ids = [r['place']['place_id'] for r in records]
    require(len(ids) == len(set(ids)), 'Duplicate place ID in base.')
    rows = collection.get('rows')
    require(isinstance(rows, list) and rows, 'Collection must have nonempty rows.')
    seen, updated = set(), set()
    for row in rows:
        cid = row.get('collection_id')
        require(isinstance(cid, str) and re.fullmatch(r'branch_[a-z0-9_]+', cid), 'Invalid collection ID.')
        require(cid not in seen, f'Duplicate collection ID: {cid}')
        seen.add(cid)
        for key in ('brand', 'name_ko', 'official_name', 'area', 'address', 'subtype', 'remaining', 'cost_basis'):
            require(isinstance(row.get(key), str) and bool(row[key].strip()), f'{cid}: missing {key}')
        require(row.get('action') in ('신규 후보', '보완'), f'{cid}: invalid action')
        target = row.get('existing_place_id')
        if row['action'] == '보완':
            require(target in ids, f'{cid}: update target does not exist: {target}')
            require(target not in updated, f'{cid}: duplicate update target: {target}')
            updated.add(target)
        else:
            require(target in ('', None), f'{cid}: new candidate cannot target an existing place')
        require(row.get('schedule_ready') is False, f'{cid}: this importer cannot promote places')
        require(row.get('category') in CATEGORIES, f'{cid}: invalid category')
        require(row.get('source_kind') in KINDS and url(row.get('source_url')), f'{cid}: invalid source')
        try:
            require(date.fromisoformat(row['checked_at']).isoformat() == row['checked_at'], f'{cid}: invalid date')
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError(f'{cid}: invalid checked_at') from error
        require(row.get('hours') is None or isinstance(row['hours'], str), f'{cid}: invalid hours')
        for key in ('reference_cost_jpy', 'purchase_budget_jpy', 'stay_min'):
            value = row.get(key)
            require(value is None or (type(value) in (int, float) and math.isfinite(value)
                    and value >= 0 and (key != 'stay_min' or value > 0)), f'{cid}: invalid {key}')
        require(row.get('space_type') in (None, '', '실내', '야외', '혼합', '미확인'), f'{cid}: invalid space_type')
        require(not row.get('entrance_map_url') or url(row['entrance_map_url']), f'{cid}: invalid entrance URL')
    require(isinstance(collection.get('held', []), list), 'held must be a list.')


def candidate(row):
    """Adapt research to the current review shape without inventing scheduling facts."""
    place = dict.fromkeys(FIELDS)
    place.update(place_id=row['collection_id'], name=row['official_name'], name_ko=row['name_ko'],
                 category=row['category'], area=row['area'], address=row['address'],
                 opening_hours=row.get('hours'), verified_at=row['checked_at'],
                 opening_hours_source=row['source_url'] if row.get('hours') else None)
    evidence = {'kind': row['source_kind'], 'urls': [row['source_url']], 'checked_at': row['checked_at']}
    sources = {k: copy.deepcopy(evidence) for k in ('name', 'address')}
    if row.get('hours'):
        sources.update({k: copy.deepcopy(evidence) for k in ('opening_hours', 'opening_hours_source')})
    for key in ('name_ko', 'category', 'area'):
        sources[key] = {'kind': 'collection_editorial_draft', 'checked_at': row['checked_at'],
                        'note': '표시 이름·방문 목적·관광 권역 작업 분류. 공식 분류/일정용 검증 완료 아님.'}
    sources['verified_at'] = {'kind': 'review_date_only', 'note': '출처 확인일. 장소 전체 승격일 아님.'}
    # Menu quotes may have unresolved tax, surcharge, portion or visit conditions.
    # Even non-null user inputs are review material, not automatic cost/covered/stay rules.
    sources['cost'] = {'kind': 'pending_cost_review', 'note': row['cost_basis']}
    blockers = ['branch_collection_review_required', 'entrance_coordinates_unconfirmed',
                'stay_policy_unconfirmed', 'covered_unconfirmed', 'bag_load_unconfirmed',
                'structured_date_profile_missing']
    if row['category'] in ('체험·오락', '복합문화'):
        blockers.append('category_contract_review_required')
    return {
        'place': place,
        'field_sources': sources,
        'source': {**evidence, 'osm_ref': None, 'coordinate_method': None, 'tags': {}},
        'review': {
            'status': 'partially_verified', 'schedule_ready': False, 'official_checks': [],
            'recommendation_blockers': blockers,
            'missing_fields': [k for k, v in place.items() if v is None or v == ''],
            'notes': [row.get('exceptions') or '', row['remaining'], row['cost_basis'],
                      '수집표의 기준 가격·추정 체류시간·공간 표시는 자동 확정하지 않음. 포장/간식은 한 끼 식당으로 승격하지 않음.'],
            'stay_policy': None,
            'branch_collection': copy.deepcopy(row),
        },
    }


def build_preview(base, collection):
    validate(base, collection)
    records = copy.deepcopy(base['places'])
    by_id = {r['place']['place_id']: r for r in records}
    updates, added, unchanged = [], 0, 0
    for row in collection['rows']:
        if row['action'] == '보완':
            updates.append({'place_id': row['existing_place_id'], 'applied': False,
                            'current_place': copy.deepcopy(by_id[row['existing_place_id']]['place']),
                            'proposed_collection': copy.deepcopy(row)})
            continue
        record = candidate(row)
        cid = row['collection_id']
        if cid in by_id:
            require(by_id[cid] == record, f'{cid}: existing record differs; review explicitly, do not overwrite')
            unchanged += 1
            continue
        records.append(record)
        by_id[cid] = record
        added += 1
    # Avoid copying base-only OSM hashes, quotas or statistics as if they cover new branches.
    preview = {'schema_version': base.get('schema_version'), 'dataset_status': 'branch_collection_review_preview',
               'scope': 'Review only. Runtime data and scheduler profiles are not changed.', 'places': records}
    summary = {'base_count': len(base['places']), 'collection_count': len(collection['rows']),
               'added_count': added, 'unchanged_candidate_count': unchanged, 'update_proposal_count': len(updates),
               'preview_count': len(records), 'held_count': len(collection.get('held', [])),
               'new_schedule_ready_count': 0,
               'collection_categories': dict(sorted(Counter(r['category'] for r in collection['rows']).items()))}
    return preview, {'applied': False, 'updates': updates, 'held': copy.deepcopy(collection.get('held', []))}, summary


def write_preview(base_path, collection_path, output_dir):
    base_bytes, collection_bytes = base_path.read_bytes(), collection_path.read_bytes()
    base = json.loads(base_bytes.decode('utf-8-sig'))
    collection = json.loads(collection_bytes.decode('utf-8-sig'))
    preview, proposals, summary = build_preview(base, collection)
    provenance = {'base_sha256': hashlib.sha256(base_bytes).hexdigest(),
                  'collection_sha256': hashlib.sha256(collection_bytes).hexdigest()}
    preview['input_provenance'] = provenance
    summary.update(provenance)
    # All validation precedes output. A new directory is required on every run.
    output_dir.mkdir(parents=True, exist_ok=False)
    for filename, value in [('places.review.json', preview), ('updates.review.json', proposals), ('summary.json', summary)]:
        with (output_dir / filename).open('x', encoding='utf-8') as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write('\n')
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, default=BASE)
    parser.add_argument('--collection', type=Path, default=COLLECTION)
    parser.add_argument('--output-dir', type=Path, required=True, help='New review output directory; must not exist.')
    args = parser.parse_args()
    try:
        result = write_preview(args.base, args.collection, args.output_dir)
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.exit(1, f'Import refused: {error}\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
