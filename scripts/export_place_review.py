"""Regenerate the 31-column review CSV and queue from the canonical JSON.

No network, inference, source edits, or promotion. JSON null becomes an empty
CSV cell; false and zero remain explicit, and full field provenance is retained.
"""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / 'data/week5/live_20260923/processed'
REVIEW_COLUMNS = [
    'cost_basis', 'stay_basis', 'covered_basis', 'name_ko_evidence',
    'area_evidence', 'address_evidence', 'cost_evidence', 'stay_min_evidence',
    'covered_evidence', 'website_evidence', 'remaining_null_fields',
    'recommendation_blockers', 'review_notes', 'schedule_ready', 'field_sources_json',
]


def urls(evidence):
    return evidence.get('urls') or ([evidence['url']] if evidence.get('url') else [])


def csv_row(record):
    row = {k: '' if v is None else str(v).lower() if type(v) is bool else v
           for k, v in record['place'].items()}
    sources, review = record['field_sources'], record['review']
    for column, field in [('cost_basis', 'cost'), ('stay_basis', 'stay_min'), ('covered_basis', 'covered')]:
        row[column] = sources.get(field, {}).get('note', '')
    for column in REVIEW_COLUMNS:
        if column.endswith('_evidence'):
            row[column] = ' | '.join(urls(sources.get(column.removesuffix('_evidence'), {})))
    row.update(
        remaining_null_fields=' | '.join(k for k,v in record['place'].items() if v is None),
        recommendation_blockers=' | '.join(review['recommendation_blockers']),
        review_notes=' | '.join(review['notes']),
        schedule_ready=str(review['schedule_ready']).lower(),
        field_sources_json=json.dumps(sources, ensure_ascii=False, separators=(',', ':')),
    )
    return row


def main():
    data = json.loads((PROCESSED/'osaka_places_150_fresh.json').read_text())
    ledger = json.loads((PROCESSED/data['latest_enrichment_checks_file']).read_text())
    queue_path = PROCESSED/'place_review_queue.json'
    queue = json.loads(queue_path.read_text())
    old = {r['place_id']: r for r in queue['places']}
    items = []
    for record in data['places']:
        p, review = record['place'], record['review']
        missing = [k for k,v in p.items() if v is None]
        if review['missing_fields'] != missing:
            raise ValueError(f"Stale missing_fields for {p['place_id']}")
        item = dict(old[p['place_id']])
        for k in ('place_id', 'name', 'name_ko', 'address', 'opening_hours'):
            item[k] = p[k]
        item.update(blockers=review['recommendation_blockers'], notes=review['notes'],
                    missing_fields=missing, schedule_ready=review['schedule_ready'])
        evidence = [e for e in record['field_sources'].values()] + review.get('operating_checks', [])
        current = [u for e in evidence if e.get('revision') == data['latest_enrichment_revision'] for u in urls(e)]
        item['source_urls'] = list(dict.fromkeys(item.get('source_urls', []) + current))
        for field, status in [('address', 'address_status'), ('opening_hours', 'hours_status')]:
            conflict = 'address_conflict' if field == 'address' else 'hours_conflict'
            if conflict in review['recommendation_blockers']:
                item[status] = 'conflict'
            elif p[field] is None:
                item[status] = 'missing'
            elif record['field_sources'].get(field, {}).get('kind') == 'official_web_review' and record['field_sources'][field].get('revision') == data['latest_enrichment_revision']:
                item[status] = 'verified_with_conditions'
        items.append(item)
    columns = list(data['places'][0]['place']) + REVIEW_COLUMNS
    if len(columns) != 31 or len({r['place']['place_id'] for r in data['places']}) != len(items):
        raise ValueError('Schema or duplicate identity error')
    missing = {k: sum(r['place'][k] is None for r in data['places']) for k in data['places'][0]['place']}
    if missing != ledger['statistics']['missing_after']:
        raise ValueError('Stale evidence-ledger statistics')
    with (PROCESSED/'osaka_places_150_review.csv').open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=columns, lineterminator='\n', quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(csv_row(r) for r in data['places'])
    queue.update(reviewed_at=ledger['checked_at'], statistics=ledger['statistics'],
                 latest_enrichment_revision=data['latest_enrichment_revision'], places=items)
    queue_path.write_text(json.dumps(queue, ensure_ascii=False, indent=2)+'\n')
    print(f'Exported {len(items)} places, {len(columns)} columns; null/false/0 and provenance preserved.')


if __name__ == '__main__':
    main()
