#!/usr/bin/env python3
"""Merge a reviewed CSV and branch collection into a reproducible demo catalog.

Missing facts stay null. Review decisions and old scheduling blockers are retained.
Changed date-sensitive facts invalidate old profiles rather than inheriting them.
"""
import argparse, copy, csv, hashlib, json, math
from pathlib import Path
from import_branch_collection import BASE, COLLECTION, FIELDS, ROOT, build_preview

OUTPUT=ROOT/'data/final/osaka_catalog_20261026.json'
PROFILES=ROOT/'data/week5/schedule_profiles_20260930.json'
FINAL_PROFILES=ROOT/'data/final/osaka_profiles_20261026.json'
from apply_branch_verification import apply_verification, PATH as VERIFICATION

def value(key, text):
    if text == '': return None
    if key == 'covered':
        if text not in ('true','false'): raise ValueError('Invalid covered value')
        return text == 'true'
    if key in ('latitude','longitude','cost','stay_min','bag_load'):
        n=float(text)
        if not math.isfinite(n): raise ValueError('Invalid numeric value')
        return int(n) if n.is_integer() else n
    return text

def merge(base, rows, collection, profiles):
    ids=[r['place']['place_id'] for r in base['places']]
    row_ids=[r['place_id'] for r in rows]
    if len(set(row_ids)) != len(row_ids) or set(ids) != set(row_ids):
        raise ValueError('Final CSV IDs must exactly match the original catalog')
    final=copy.deepcopy(base); calendars=copy.deepcopy(profiles)
    by_id={r['place_id']:r for r in rows}; invalidated=[]
    for record in final['places']:
        previous=record['place']; pid=previous['place_id']; row=by_id[pid]
        place={k:value(k,row[k]) for k in FIELDS}
        record['place']=place
        record['field_sources']=json.loads(row['field_sources_json'])
        review=record['review']
        review['final_csv']={k:row.get(k,'') for k in (
            'record_status','record_status_reason','space_type','cost_basis',
            'manual_review_notes','manual_review_source_url','manual_review_date',
            'manual_remaining_questions')}
        review['schedule_ready']=False
        blockers=review['recommendation_blockers']
        status=row['record_status']
        if status == '제외': blockers.append('final_record_excluded')
        elif any(word in status for word in ('보류','휴관')):
            blockers.append('final_record_review_required')
        # Profiles include prices, identity and visit windows: stale profiles must
        # not override later user corrections. Do not synthesize calendar facts.
        if any(place[k] != previous[k] for k in ('name','address','latitude','longitude','opening_hours','cost','category')):
            if pid in calendars['places']:
                calendars['places'].pop(pid); invalidated.append(pid)
            blockers.append('final_calendar_review_required')
        review['recommendation_blockers']=list(dict.fromkeys(blockers))
    catalog, proposals, summary=build_preview(final,collection)
    catalog.update(dataset_status='final_csv_and_branch_collection',
                   scope='Complete searchable catalog; scheduling still requires date-specific validation.',
                   collection_summary=summary, update_proposals=proposals,
                   invalidated_calendar_ids=invalidated)
    calendars['notes'].append('Final CSV corrections invalidate stale profiles; no missing facts are inferred.')
    return catalog,calendars

def build(csv_path):
    raw=csv_path.read_bytes()
    with csv_path.open(encoding='utf-8-sig',newline='') as f: rows=list(csv.DictReader(f))
    catalog,profiles=merge(json.loads(BASE.read_text(encoding='utf-8')),rows,json.loads(COLLECTION.read_text(encoding='utf-8')),json.loads(PROFILES.read_text(encoding='utf-8')))
    catalog,profiles=apply_verification(catalog,profiles,COLLECTION.read_bytes())
    catalog['input_provenance']={
      'branch_verification_sha256':hashlib.sha256(VERIFICATION.read_bytes()).hexdigest(),
      'final_csv_name':csv_path.name,'final_csv_sha256':hashlib.sha256(raw).hexdigest(),
      'base_sha256':hashlib.sha256(BASE.read_bytes()).hexdigest(),
      'collection_sha256':hashlib.sha256(COLLECTION.read_bytes()).hexdigest()}
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    for path,data in ((OUTPUT,catalog),(FINAL_PROFILES,profiles)):
        path.write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False)+'\n')
    return catalog['collection_summary']

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('csv',type=Path,nargs='?',default=ROOT/'data/final/reviewed_places_20261014.csv')
    print(json.dumps(build(p.parse_args().csv),ensure_ascii=False))
