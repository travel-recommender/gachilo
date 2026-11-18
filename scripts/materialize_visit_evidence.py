"""Apply a reviewed source pack to a NEW catalogue directory, never a running bundle.

This is an offline staging step. It changes only field provenance and explicit RAG
assertions, not place values, eligibility or calendars. Runtime activation is a
separate reviewed change after integration; old experiment inputs stay frozen.
"""
import argparse
import copy
from datetime import date
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / 'data/rag/official_followup_20261118.json'


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def digest(value):
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)
    return hashlib.sha256(raw.encode()).hexdigest()


def day(value):
    if not isinstance(value, str) or len(value) != 10:
        raise ValueError('Expected explicit YYYY-MM-DD source date')
    if date.fromisoformat(value).isoformat() != value:
        raise ValueError('Invalid source date')
    return value


def provenance(item, checked_on):
    if item.get('kind') != 'official_web_review' or day(item['checked_at']) != checked_on:
        raise ValueError('Use an explicit official review and its actual checked date')
    urls = item.get('urls')
    if not isinstance(urls, list) or not urls:
        raise ValueError('Source URLs required')
    for url in urls:
        if not isinstance(url, str):
            raise ValueError('Source URL must be text')
        parsed = urlsplit(url)
        if parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError('Unsafe source URL')
    start, end = item.get('valid_from'), item.get('valid_through')
    if start is not None: day(start)
    if end is not None: day(end)
    if start is not None and end is not None and start > end:
        raise ValueError('Invalid source validity period')
    if not isinstance(item.get('note'), str) or not item['note'].strip():
        raise ValueError('Review scope and limitations required')
    return {key: copy.deepcopy(item.get(key)) for key in
            ('kind', 'urls', 'checked_at', 'valid_from', 'valid_through', 'note')}


def apply(dataset, pack):
    if pack.get('schema_version') != 1 or not isinstance(pack.get('version'), str):
        raise ValueError('Unsupported source pack')
    checked_on = day(pack['checked_on'])
    result = copy.deepcopy(dataset)
    rows = {r['place']['place_id']: r for r in result['places']}
    if len(rows) != len(result['places']):
        raise ValueError('Duplicate catalogue IDs')
    applied = result.get('input_provenance', {}).get('visit_evidence_reviews', [])
    if any(p['version'] == pack['version'] for p in applied):
        raise ValueError('Pack already applied; use its original catalogue or reconcile a new review')
    seen = set()

    def row_for(item):
        row = rows.get(item['place_id'])
        if row is None or digest(row['place']) != item['identity_sha256']:
            raise ValueError('Place identity/value changed; re-review ' + item['place_id'])
        return row

    for item in pack['field_refreshes']:
        row = row_for(item)
        field = item['field']
        key = (item['place_id'], field)
        if field not in ('opening_hours', 'cost') or key in seen:
            raise ValueError('Invalid or repeated field refresh')
        seen.add(key)
        previous = row.get('field_sources', {}).get(field)
        if row['place'][field] != item['expected_value'] or digest(previous) != item['expected_source_sha256']:
            raise ValueError('Source/value changed; re-review ' + item['place_id'])
        source = provenance(item, checked_on)
        source['previous'] = {'value': copy.deepcopy(row['place'][field]), 'source': copy.deepcopy(previous)}
        row.setdefault('field_sources', {})[field] = source
    for item in pack['additional_assertions']:
        row = row_for(item)
        source = provenance(item, checked_on)
        if item['field'] != 'operating_exception' or item.get('state') != 'current' or not isinstance(item.get('value'), dict):
            raise ValueError('Only explicit dated exception assertions are supported here')
        if source['valid_from'] is None or source['valid_from'] != source['valid_through']:
            raise ValueError('Exception needs one exact source date')
        assertion = dict(source, place_id=item['place_id'], field=item['field'], value=copy.deepcopy(item['value']), state='current')
        row.setdefault('review', {}).setdefault('visit_evidence', []).append(assertion)
    # reference_checks includes failed/partial source checks. It is deliberately
    # not applied to catalogue verification dates, nor used to clear blockers.
    result.setdefault('input_provenance', {}).setdefault('visit_evidence_reviews', []).append({
        'version': pack['version'], 'pack_sha256': digest(pack), 'checked_on': checked_on,
        'refreshed_fields': len(pack['field_refreshes']),
        'dated_assertions': len(pack['additional_assertions'])})
    return result


def materialize(catalog, pack_path, out):
    catalog, pack_path, out = Path(catalog), Path(pack_path), Path(out)
    if out.exists() or out.is_symlink():
        raise ValueError('Output must be a NEW directory; do not modify an existing experiment bundle')
    dataset, pack = read(catalog), read(pack_path)
    result = apply(dataset, pack)  # Validate everything before creating files.
    serialized = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    report = {'state': 'prepared_not_activated', 'pack_version': pack['version'],
              'input_sha256': hashlib.sha256(catalog.read_bytes()).hexdigest(),
              'output_sha256': hashlib.sha256(serialized.encode()).hexdigest(),
              'refreshed_places': len({e['place_id'] for e in pack['field_refreshes']}),
              'refreshed_fields': len(pack['field_refreshes']),
              'dated_assertions': len(pack['additional_assertions']),
              'runtime_manifest_changed': False, 'schedule_profiles_changed': False,
              'paid_calls': 0, 'reference_checks': pack['reference_checks']}
    out.mkdir(parents=True, exist_ok=False)
    (out/'catalog.json').write_text(serialized, encoding='utf-8')
    (out/'review-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', required=True, type=Path)
    parser.add_argument('--pack', type=Path, default=PACK)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    report = materialize(args.catalog, args.pack, args.out)
    print(json.dumps({k:v for k,v in report.items() if k != 'reference_checks'}, ensure_ascii=False))
