"""Publish the dated landmark review; keep all historical snapshots and brand identities."""
import argparse
from publish_verified_catalog import ROOT, read, sha, apply
import json

def publish(check=False):
    evidence_path=ROOT/'data/final/catalog_verification_20261116.json'
    e=read(evidence_path)
    for p,digest in e['input_sha256'].items():
        if sha(ROOT/p)!=digest:raise ValueError('Review input changed: '+p)
    data,profiles=apply(read(ROOT/e['catalog_input']),read(ROOT/e['profiles_input']),e)
    data['input_provenance']['landmark_verification']={'path':str(evidence_path.relative_to(ROOT)),'sha256':sha(evidence_path)}
    profiles['checked_at']=e['checked_at']
    manifest=read(ROOT/'data/runtime_catalog.json')
    updates={'version':'2026-11-16-landmarks-v1','catalog':'final/osaka_catalog_20261116.json',
        'profiles':'final/osaka_profiles_20261116.json','dated_verification':'final/catalog_verification_20261116.json',
        'supplemental_search_only_count':23,'new_branch_dated_eligible_count':61}
    outputs={updates['catalog']:data,updates['profiles']:profiles}
    for p,value in outputs.items():
        text=json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n'
        target=ROOT/'data'/p
        if check:
            if target.read_text()!=text:raise ValueError('Published file differs: '+p)
        else:target.write_text(text)
    if check:
        if any(manifest.get(k)!=v for k,v in updates.items()):raise ValueError('Runtime manifest differs')
    else:
        manifest.update(updates)
        (ROOT/'data/runtime_catalog.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    return data['dated_verification_summary']

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--check',action='store_true')
    print(json.dumps(publish(p.parse_args().check),ensure_ascii=False))
