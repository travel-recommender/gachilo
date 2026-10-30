#!/usr/bin/env python3
"""Publish supplemental research without changing the reviewed 205-place snapshot.

Official map pins and OSRM routes are review evidence, not entrance/calendar approval.
This build is offline and deterministic; the runtime never calls research websites.
"""
import copy
import hashlib
import json
import math
from pathlib import Path

from build_final_catalog import ROOT, OUTPUT as BASE, FINAL_PROFILES, build
from import_branch_collection import build_preview

COLLECTIONS = (
    ROOT / 'data/collections/osaka_cafes_20261030/branches.json',
    ROOT / 'data/collections/osaka_traveler_expansion_20261030/branches.json',
)
EVIDENCE = ROOT / 'data/collections/osaka_traveler_expansion_20261030/location_route_evidence.json'
SUPPORT = ROOT / 'data/collections/osaka_traveler_expansion_20261030/travel_support.json'
OUTPUT = ROOT / 'data/final/osaka_catalog_20261030.json'
MANIFEST = ROOT / 'data/runtime_catalog.json'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def expand(base, collections, evidence):
    final = copy.deepcopy(base)
    original_ids = {r['place']['place_id'] for r in base['places']}
    summaries = []
    for collection in collections:
        preview, proposals, summary = build_preview(final, collection)
        if proposals['updates']:
            raise ValueError('Supplemental collection cannot silently update existing places')
        # Preserve original review decisions, invalidated dates and 55-branch provenance.
        final['places'] = preview['places']
        final['area_schemes_by_place_id'] = preview['area_schemes_by_place_id']
        summaries.append(summary)
    new = {r['place']['place_id']: r for r in final['places'] if r['place']['place_id'] not in original_ids}
    if not set(evidence['places']) <= set(new):
        raise ValueError('Coordinate research must refer to supplemental places only')
    for pid, research in evidence['places'].items():
        if research['entrance_verified'] is not False or research['runtime_coordinate_applied'] is not False:
            raise ValueError('Map pin evidence cannot promote a runtime entrance')
        for field, lo, hi in [('latitude', 34, 35), ('longitude', 135, 136)]:
            value = research[field]
            if type(value) not in (int, float) or not math.isfinite(value) or not lo < value < hi:
                raise ValueError('Invalid Osaka coordinate evidence')
        if research['source_url'] not in new[pid]['review']['branch_collection']['source_url'].split():
            raise ValueError('Coordinate evidence source must match the collected branch')
        new[pid]['review']['location_research'] = copy.deepcopy(research)
    final['dataset_status'] = 'final_csv_branches_and_supplemental_research'
    final['scope'] = 'Search includes supplemental research. Scheduling requires separately validated visit-date profiles.'
    final['supplemental_collection_summaries'] = summaries
    final['expanded_summary'] = {
        'base_count': len(base['places']), 'added_count': len(new),
        'searchable_count': len(final['places']), 'new_schedule_ready_count': 0,
        'official_pin_route_checks': len(evidence['places']),
    }
    return final


def publish():
    build(ROOT / 'data/final/reviewed_places_20261014.csv')
    final = expand(read(BASE), [read(p) for p in COLLECTIONS], read(EVIDENCE))
    support = read(SUPPORT)['items']
    if len({r['support_id'] for r in support}) != len(support) or any(
        r['automatic_itinerary_stop'] is not False or r['runtime_ui_applied'] is not False for r in support
    ):
        raise ValueError('Travel support is reference material, not runtime POIs')
    final['input_provenance']['supplements'] = [
        {'path': str(p.relative_to(ROOT)), 'sha256': digest(p)} for p in (*COLLECTIONS, EVIDENCE, SUPPORT)
    ]
    final['input_provenance']['reviewed_205_sha256'] = digest(BASE)
    manifest = {
        'version': '2026-10-30', 'catalog': str(OUTPUT.relative_to(ROOT / 'data')),
        'profiles': str(FINAL_PROFILES.relative_to(ROOT / 'data')),
        'searchable_count': len(final['places']),
        'new_branch_count': sum(r['place']['place_id'].startswith('branch_') for r in final['places']),
        'new_branch_dated_eligible_count': final['branch_verification_summary']['eligible_for_dated_demo'],
        'supplemental_search_only_count': final['expanded_summary']['added_count'],
        'travel_support': str(SUPPORT.relative_to(ROOT / 'data')), 'travel_support_count': len(support),
    }
    for path, data in [(OUTPUT, final), (MANIFEST, manifest)]:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    return manifest


if __name__ == '__main__':
    print(json.dumps(publish(), ensure_ascii=False))
