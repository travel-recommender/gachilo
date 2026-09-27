#!/usr/bin/env python3
"""Apply a reviewed local ledger to the matching 150-place selection; no network calls.
Usage: python3 scripts/apply_place_review.py INPUT_JSON LEDGER_JSON OUTPUT_JSON
Use after existing selection/cafe/20260924 enrichment steps. Earlier provenance is retained.
"""
import argparse, copy, json
from pathlib import Path

def apply_review(dataset, ledger):
    result=copy.deepcopy(dataset)
    records=result['places']; checks=ledger['checks']
    by_id={r['place']['place_id']:r for r in records}
    ids=[c['place_id'] for c in checks]
    if len(records)!=150 or len(checks)!=150 or len(by_id)!=150 or len(set(ids))!=150 or set(ids)!=set(by_id):
        raise ValueError('The ledger must match all 150 unique selected place IDs exactly.')
    # Validate the entire ledger before applying anything.
    for c in checks:
        r=by_id[c['place_id']]
        if c['osm_ref']!=r['source']['osm_ref']:
            raise ValueError('OSM branch mismatch: '+c['place_id'])
        if set(c['updates'])-{'address','opening_hours','website'}:
            raise ValueError('Unexpected field in reviewed updates')
    for c in checks:
        r=by_id[c['place_id']];p=r['place'];source=c['source'];u=c['updates'];review=r['review']
        for k,v in u.items():p[k]=v;r['field_sources'][k]=copy.deepcopy(source)
        if 'opening_hours' in u:
            p['opening_hours_source']=source['urls'][0] if u['opening_hours'] is not None and source['urls'] else None
            r['field_sources']['opening_hours_source']=copy.deepcopy(source)
        if u:
            p['verified_at']=c['checked_at']
            r['field_sources']['verified_at']={'kind':'review_date_only','check_id':c['check_id'],'note':'장소 전체 또는 일정 사용 가능 판정이 아님. 검증 범위는 필드 출처 참조.'}
            review['status']='partially_verified'
            if source['kind'].startswith('official') and c['check_id'] not in review['official_checks']:review['official_checks'].append(c['check_id'])
        for note in c['audit']['notes']:
            if note not in review['notes']:review['notes'].append(note)
        review['address_hours_audit']=copy.deepcopy(c['audit'])
        review['recommendation_blockers']=copy.deepcopy(c['recommendation_blockers'])
        if c['operating_status']:review['operating_status']=copy.deepcopy(c['operating_status'])
        review['schedule_ready']=False
        review['missing_fields']=[k for k,v in p.items() if v is None or v=='']
    result['full_review_revision']='address_hours_20260926'
    result['full_review_checks_file']='official_enrichment_20260926.json'
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('input',type=Path);parser.add_argument('ledger',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args();result=apply_review(json.loads(args.input.read_text()),json.loads(args.ledger.read_text()))
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print('Applied local review ledger to 150 places. No network/API requests.')
