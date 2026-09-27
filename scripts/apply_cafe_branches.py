"""Apply the reviewed two-branch selection after refresh_osaka_places.py."""
import argparse
import copy
import hashlib
import json
from collections import Counter
from pathlib import Path


def apply(folder):
    path = folder / 'osaka_places_150_fresh.json'
    supplement_path = folder / 'cafe_branch_supplement.json'
    dataset = json.loads(path.read_text())
    supplement = json.loads(supplement_path.read_text())
    if dataset['raw_sha256'] != supplement['source_raw_sha256']:
        raise ValueError('Supplement belongs to a different OSM snapshot')
    original = copy.deepcopy(dataset['places'])
    before = Counter(r['place']['category'] for r in original)
    log_path = folder / 'cafe_branch_replacements.json'
    log = json.loads(log_path.read_text()) if log_path.exists() else {'replacements': []}
    for incoming in supplement['places']:
        old_id = incoming['identity_comparison']['legacy_place_id']
        new_id = incoming['place']['place_id']
        old = [i for i,r in enumerate(dataset['places']) if r['place']['place_id'] == old_id]
        new = [r for r in dataset['places'] if r['place']['place_id'] == new_id]
        if not old and len(new) == 1:
            continue
        if len(old) != 1 or new:
            raise ValueError(f'Ambiguous replacement: {old_id} -> {new_id}')
        record = copy.deepcopy(incoming)
        record['review']['notes'] = [n for n in record['review']['notes'] if '150개 목록에는 아직 편입하지 않음' not in n]
        record['review']['notes'].append('사용자 지정 지점으로 150개 목록에 편입. 기존 지점 ID는 재사용하지 않음.')
        record['review']['replaces_selection_id'] = old_id
        record['review']['missing_fields'] = [k for k,v in record['place'].items() if v is None]
        removed = dataset['places'][old[0]]
        dataset['places'][old[0]] = record
        if not any(x['old_place_id'] == old_id for x in log['replacements']):
            log['replacements'].append({'old_place_id':old_id, 'new_place_id':new_id,
                'reason':'User-selected distinct branch; replace selection, not entity identity',
                'previous_record':removed, 'new_osm_ref':record['source']['osm_ref']})
    rows = dataset['places']
    if len(rows) != 150 or Counter(r['place']['category'] for r in rows) != before:
        raise ValueError('Selection size/category counts changed')
    if len({r['place']['place_id'] for r in rows}) != 150 or len({r['source']['osm_ref'] for r in rows}) != 150:
        raise ValueError('Duplicate place identity')
    dataset['selection_revision'] = 'cafe_branches_20260923'
    dataset['branch_supplement_sha256'] = hashlib.sha256(supplement_path.read_bytes()).hexdigest()
    manifest_path = folder / 'collection_manifest.json'
    manifest = json.loads(manifest_path.read_text())
    manifest['selection_revision'] = dataset['selection_revision']
    manifest['branch_supplement_sha256'] = dataset['branch_supplement_sha256']
    stats = manifest['statistics']
    stats['selected_with_official_field_checks'] = sum(bool(r['review']['official_checks']) for r in rows)
    stats['selected_missing'] = {k:sum(r['place'][k] is None for r in rows) for k in rows[0]['place']}
    stats['selected_with_address_components'] = sum(bool(r['source']['address_components']) for r in rows)
    manifest['previous_match_status_scope'] = 'Initial automatic matching before branch selection overrides; see cafe_branch_replacements.json'
    # Recompute the displayed missing-field table in the generated report.
    report_path = folder / 'collection_report.md'
    report = report_path.read_text()
    start = report.index('| 항목 | 미확인/누락 |')
    end = report.index('\n\n', start)
    table = '| 항목 | 미확인/누락 |\n| --- | ---: |\n' + '\n'.join(f'| {k} | {v} |' for k,v in stats['selected_missing'].items() if v)
    report = report[:start] + table + report[end:]
    import re
    report = re.sub(r'선정된 장소 중 \d+곳의 일부 항목',f"선정된 장소 중 {stats['selected_with_official_field_checks']}곳의 일부 항목",report)
    marker = '\n## 카페 지점 반영\n'
    report = report.split(marker)[0] + marker + '\n마루후쿠 센니치마에 본점과 브루클린 난바점을 새 ID로 교체 편입했다. 총 150개·카페25개 유지. 마루후쿠 주소와 08:00~23:00은 공식 확인값, 브루클린 주소·영업시간은 미확인이다. 이전 지점의 전체 기록은 cafe_branch_replacements.json에 보존했다. 초기 자동 매칭 비교 결과는 교체 이전 기록이다. 재생성 후 scripts/apply_cafe_branches.py를 실행하면 동일 교체가 다시 적용된다.\n'
    for target,content in [(path,dataset),(manifest_path,manifest),(log_path,log)]:
        target.write_text(json.dumps(content,ensure_ascii=False,indent=2)+'\n')
    report_path.write_text(report)
    return stats


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--folder',type=Path,required=True)
    print(json.dumps(apply(parser.parse_args().folder),ensure_ascii=False,indent=2))
