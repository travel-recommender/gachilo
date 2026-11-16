"""Publish reviewed branch identity/display names without changing operating facts or eligibility."""
import argparse
import copy
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / 'data/brands/osaka_brand_registry_20261112.json'
OUTPUT = 'final/osaka_catalog_20261112.json'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def apply(dataset, registry):
    result = copy.deepcopy(dataset)
    ids = [r['place']['place_id'] for r in result['places']]
    if len(ids) != len(set(ids)) or len(ids) != registry['reviewed_place_count']:
        raise ValueError('Catalog ID count changed; repeat identity review')
    records = {r['place']['place_id']: r for r in result['places']}
    seen, brands, replacement_groups = set(), set(), {}
    for group in registry['brands']:
        brand = group['brand_id']
        if not re.fullmatch(r'[a-z0-9][a-z0-9_]*', brand) or brand in brands:
            raise ValueError('Invalid or duplicate brand ID')
        brands.add(brand)
        if len(group['members']) < 2:
            raise ValueError('This registry reviews multi-branch brands')
        for member in group['members']:
            pid, key = member['place_id'], member['branch_group_id']
            if pid not in records or pid in seen:
                raise ValueError('Unknown or repeated place ID: ' + pid)
            if not re.fullmatch(re.escape(brand) + r':[a-z0-9_]+', key):
                raise ValueError('Replacement group must belong to its brand')
            urls = member['source_urls']
            if not urls or any(urlsplit(u).scheme not in ('http', 'https') or not urlsplit(u).netloc for u in urls):
                raise ValueError('Public branch-specific identity evidence required')
            seen.add(pid)
            r = records[pid]
            # Same-brand identity does not make restaurant and takeaway interchangeable.
            role = r['review'].get('meal_role') or ('meal' if r['place']['category'] == '식사' else None)
            signature = (brand, r['place']['category'], role)
            if key in replacement_groups and replacement_groups[key] != signature:
                raise ValueError('Incompatible category or meal role in branch group: ' + key)
            replacement_groups[key] = signature
            r['place'].update(brand_id=brand, branch_group_id=key)
            correction = member.get('display_name_correction')
            if correction:
                if r['place']['name_ko'] != correction['previous'] or not correction['value'].strip():
                    raise ValueError('Display name correction no longer matches its reviewed source')
                r['place']['name_ko'] = correction['value']
                r['field_sources']['name_ko'] = {
                    'kind': 'official_branch_display_name', 'source_urls': urls,
                    'reviewed_on': correction['reviewed_on'], 'note': correction['note'],
                    'previous_value': correction['previous'],
                    'previous_source': copy.deepcopy(r['field_sources']['name_ko']),
                }
            r['field_sources']['brand_id'] = {
                'kind': 'explicit_identity_review', 'registry_version': registry['version'],
                'source_urls': urls, 'identity_reviewed_on': member['identity_reviewed_on'],
                'live_identity_checked_on': member['live_identity_checked_on'],
                'note': 'Identity review only; existing hours, prices and their verification dates are unchanged.',
            }
            r['field_sources']['branch_group_id'] = {
                'kind': 'conservative_substitution_policy', 'registry_version': registry['version'],
                'note': member['note'],
            }
    ungrouped = registry['ungrouped_place_ids']
    if len(ungrouped) != len(set(ungrouped)) or seen.intersection(ungrouped) or seen.union(ungrouped) != set(ids):
        raise ValueError('Every catalog ID needs exactly one grouped/ungrouped decision')
    for pid in ungrouped:
        records[pid]['place'].update(brand_id=None, branch_group_id=None)
    for pair in registry['explicit_non_matches']:
        a, b = (records[pid]['place'] for pid in pair['place_ids'])
        if a['brand_id'] is not None and a['brand_id'] == b['brand_id']:
            raise ValueError('Explicit non-match incorrectly grouped')
    result['brand_identity'] = {'version': registry['version'], 'reviewed_places': len(ids),
        'brand_count': len(brands), 'grouped_places': len(seen), 'ungrouped_places': len(ungrouped),
        'scope': 'Identity and reviewed display names only. Date eligibility, prices, coordinates and operating facts unchanged.'}
    return result


def publish(check=False):
    registry = read(REGISTRY)
    source = ROOT / registry['catalog_input']
    if digest(source) != registry['catalog_sha256']:
        raise ValueError('Source catalog changed; reconcile identities before publishing')
    result = apply(read(source), registry)
    result['input_provenance']['brand_identity'] = {
        'path': str(REGISTRY.relative_to(ROOT)), 'sha256': digest(REGISTRY),
        'catalog_input': registry['catalog_input'], 'catalog_sha256': digest(source),
    }
    target = ROOT / 'data' / OUTPUT
    serialized = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    manifest = read(ROOT / 'data/runtime_catalog.json')
    updates = {'version': registry['version'], 'catalog': OUTPUT,
               'brand_registry': str(REGISTRY.relative_to(ROOT / 'data'))}
    if check:
        if target.read_text(encoding='utf-8') != serialized or any(manifest.get(k) != v for k, v in updates.items()):
            raise ValueError('Published catalog or runtime manifest differs; rebuild it')
    else:
        target.write_text(serialized, encoding='utf-8')
        manifest.update(updates)
        (ROOT / 'data/runtime_catalog.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return result['brand_identity']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    print(json.dumps(publish(parser.parse_args().check), ensure_ascii=False))
