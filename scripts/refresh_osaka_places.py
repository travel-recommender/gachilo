"""Collect/rebuild a traceable Osaka OSM dataset and a 150-place review draft.

Standard-library only. Run without --raw to fetch once, or pass a saved response
to rebuild offline. The previous draft and source CSVs are never modified.
"""
import argparse
import copy
import hashlib
import json
import math
import unicodedata
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

QUOTAS = {"명소": 20, "문화": 25, "자연": 20, "쇼핑": 25, "카페": 25, "식사": 35}
FIELDS = "place_id name name_ko category area address latitude longitude opening_hours cost stay_min bag_load covered website opening_hours_source verified_at".split()
ENDPOINT = "https://overpass-api.de/api/interpreter"
ATTRIBUTION = {"text": "© OpenStreetMap contributors", "url": "https://www.openstreetmap.org/copyright", "license": "ODbL 1.0"}


def norm(name):
    return ''.join(unicodedata.normalize('NFKC', name or '').casefold().split())


def distance(a, b):
    la, lo, lb, lob = map(math.radians, (a['latitude'], a['longitude'], b['latitude'], b['longitude']))
    h = math.sin((la-lb)/2)**2 + math.cos(la)*math.cos(lb)*math.sin((lo-lob)/2)**2
    return 12742000 * math.asin(min(1, math.sqrt(h)))


def category(t):
    exterior_billboard = t.get('tourism') == 'attraction' and t.get('advertising') == 'billboard' and t.get('visibility') == 'street'
    if t.get('attraction') == 'animal' or (t.get('access') in ('private', 'no') and not exterior_billboard):
        return None
    if t.get('amenity') == 'restaurant': return '식사'
    if t.get('amenity') == 'cafe': return '카페'
    if t.get('shop') in ('mall', 'department_store'): return '쇼핑'
    if t.get('tourism') in ('museum', 'gallery') or t.get('historic') == 'castle' or t.get('amenity') == 'place_of_worship': return '문화'
    if t.get('leisure') in ('park', 'garden'): return '자연'
    if t.get('tourism') in ('attraction', 'viewpoint', 'zoo', 'aquarium', 'theme_park'): return '명소'
    return None


def quality(record):
    p = record['place']
    return (-bool(record['review']['official_checks']), -bool(p['website']), -bool(p['opening_hours']), -bool(p['name_ko']), norm(p['name']), record['source']['osm_ref'])


def normalize(element, collected_at):
    t = element.get('tags', {})
    cat = category(t)
    if not cat or not t.get('name') or element['type'] not in ('node', 'way', 'relation'): return None
    point = element if element['type'] == 'node' else element.get('center', {})
    lat, lon = point.get('lat'), point.get('lon')
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)): return None
    if not math.isfinite(lat) or not math.isfinite(lon) or not (34.60 <= lat <= 34.75 and 135.40 <= lon <= 135.60): return None
    ref = f"{element['type']}/{element['id']}"
    p = dict.fromkeys(FIELDS)
    p.update(place_id='osm_' + ref.replace('/', '_'), name=t['name'], name_ko=t.get('name:ko'), category=cat,
             latitude=lat, longitude=lon, opening_hours=t.get('opening_hours'),
             address=t.get('addr:full'), website=t.get('website') or t.get('contact:website'))
    # Cost and covered are deliberately not inferred from partial tags. Raw
    # charge/fee/covered tags remain available for review in source.tags.
    sources = {key: {'kind': 'osm', 'url': 'https://www.openstreetmap.org/' + ref} for key, value in p.items() if value is not None and key != 'place_id'}
    if t.get('access') in ('private', 'no'):
        sources['latitude']['note'] = '외부에서 보는 간판 자체 좌표. 입장/보행 목적지로 사용하지 말고 공개 관람 위치 별도 확인.'
    return {'place': p, 'field_sources': sources,
            'source': {'osm_ref': ref, 'url': 'https://www.openstreetmap.org/' + ref,
                       'collected_at': collected_at, 'osm_edited_at': element.get('timestamp'),
                       'coordinate_method': 'node' if element['type'] == 'node' else 'bounding_box_center_not_entrance',
                       'address_components': {k:v for k,v in t.items() if k.startswith('addr:')},
                       'tags': t},
            'review': {'status': 'needs_verification', 'official_checks': [], 'notes': [], 'duplicate_osm_refs': []}}


def apply_checks(record, checks):
    for check in checks:
        if record['source']['osm_ref'] not in check.get('osm_refs', []): continue
        for field, value in check.get('updates', {}).items():
            record['place'][field] = value
            record['field_sources'][field] = {'kind': 'editorial_translation_of_official_name' if field in check.get('editorial_translation_fields', []) else 'official_web_review', 'urls': check['urls'], 'checked_at': check['checked_at']}
        record['review']['official_checks'].append(check['id'])
        record['review']['notes'].extend(check.get('notes', []))
        record['review']['status'] = 'partially_verified'
        # This date applies only to listed reviewed fields, never every field.
        record['place']['verified_at'] = check['checked_at']
        record['field_sources']['verified_at'] = {'kind': 'review_date_only', 'check_id': check['id']}


def build(raw_path, query_path, previous_path, checks_path, output):
    raw_bytes = raw_path.read_bytes()
    raw = json.loads(raw_bytes)
    if raw.get('remark') or not raw.get('elements'):
        raise ValueError('Empty or partial/error Overpass response; refusing to publish a dataset')
    collected_at = datetime.fromtimestamp(raw_path.stat().st_mtime, timezone.utc).isoformat()
    check_document = json.loads(checks_path.read_text(encoding='utf-8'))
    checks = check_document['checks']
    old = json.loads(previous_path.read_text(encoding='utf-8'))['places']
    by_ref = {}
    for element in raw['elements']:
        r = normalize(element, collected_at)
        if r:
            apply_checks(r, checks)
            for observation in check_document.get('identity_observations', []):
                if observation['osm_ref'] == r['source']['osm_ref']:
                    r['review']['notes'].append(observation['action'])
                    r['review']['identity_status'] = observation['status']
            by_ref[r['source']['osm_ref']] = r
    records = sorted(by_ref.values(), key=quality)
    # Keep raw objects separately. Collapse only same-name/category nearby
    # representations for the selectable pool; do not erase chain branches.
    pool, groups, venues = [], defaultdict(list), {}
    for r in records:
        key = (norm(r['place']['name']), r['place']['category'])
        # Explicitly reviewed same-venue OSM representations (e.g. street
        # segments) are not separate destinations even when farther than 75m.
        venue = next((c['id'] for c in checks if c.get('merge_same_venue') and r['source']['osm_ref'] in c['osm_refs']), None)
        duplicate = venues.get(venue) if venue else None
        if duplicate is None:
            duplicate = next((x for x in groups[key] if distance(x['place'], r['place']) <= 75), None)
        if duplicate:
            duplicate['review']['duplicate_osm_refs'].append(r['source']['osm_ref'])
        else:
            pool.append(copy.deepcopy(r))
            groups[key].append(pool[-1])
            if venue: venues[venue] = pool[-1]
    selected, matches, used = [], [], set()
    counts = Counter()
    for prior in old:
        p = prior['place']
        options = sorted([(distance(p, r['place']), r) for r in pool if norm(p['name']) == norm(r['place']['name']) and p['category'] == r['place']['category']], key=lambda x: (x[0], x[1]['source']['osm_ref']))
        nearby = [(d, r) for d, r in options if d <= 250]
        # If similarly close objects remain after duplicate filtering, flag the
        # old identity rather than guessing which branch it denotes.
        ambiguous = len(nearby) > 1 and nearby[1][0] - nearby[0][0] < 25
        match = {'old_place_id': p['place_id'], 'old_name': p['name'], 'status': 'ambiguous' if ambiguous else 'not_matched',
                 'candidates': [{'osm_ref': r['source']['osm_ref'], 'distance_m': round(d, 1)} for d,r in nearby[:3]]}
        if nearby and not ambiguous:
            d, r = nearby[0]
            match['status'] = 'matched'
            match['osm_ref'] = r['source']['osm_ref']
            match['changed_fields'] = {k: {'previous': p.get(k), 'fresh': r['place'][k]} for k in FIELDS if k != 'place_id' and p.get(k) != r['place'][k]}
            if r['source']['osm_ref'] not in used and counts[p['category']] < QUOTAS[p['category']]:
                chosen = copy.deepcopy(r)
                chosen['place']['place_id'] = p['place_id']
                chosen['review']['previous_place_id'] = p['place_id']
                # Preserve human-readable labels only, with their old source;
                # do not carry unchecked old hours, prices or assumptions.
                if p.get('name_ko') and chosen['field_sources'].get('name_ko', {}).get('kind') not in ('official_web_review', 'editorial_translation_of_official_name'):
                    chosen['place']['name_ko'] = p['name_ko']
                    chosen['field_sources']['name_ko'] = {'kind': 'previous_draft_not_reverified', 'place_id': p['place_id']}
                selected.append(chosen); used.add(r['source']['osm_ref']); counts[p['category']] += 1
        matches.append(match)
    for cat, quota in QUOTAS.items():
        cells = defaultdict(list)
        for r in sorted(pool, key=quality):
            if r['place']['category'] == cat and r['source']['osm_ref'] not in used:
                p = r['place']; cells[(int(p['latitude']*100), int(p['longitude']*100))].append(r)
        while counts[cat] < quota and cells:
            for cell in sorted(cells, key=lambda c: (quality(cells[c][0]), c)):
                if counts[cat] >= quota: break
                r = cells[cell].pop(0)
                if not cells[cell]: del cells[cell]
                selected.append(copy.deepcopy(r)); used.add(r['source']['osm_ref']); counts[cat] += 1
        if counts[cat] != quota: raise ValueError(f'Insufficient {cat} records')
    for r in selected:
        r['review']['missing_fields'] = [k for k,v in r['place'].items() if v is None]
        r['review']['schedule_ready'] = False
    metadata = {'schema_version': 2, 'dataset_status': 'draft_for_review', 'collected_at': collected_at,
                'osm_base_timestamp': raw.get('osm3s',{}).get('timestamp_osm_base'),
                'endpoint': ENDPOINT, 'bbox': [34.60,135.40,34.75,135.60],
                'scope': 'Central Osaka bounding box, not all Osaka Prefecture',
                'raw_sha256': hashlib.sha256(raw_bytes).hexdigest(),
                'query_sha256': hashlib.sha256(query_path.read_bytes()).hexdigest(),
                'previous_draft_sha256': hashlib.sha256(previous_path.read_bytes()).hexdigest(),
                'official_checks_sha256': hashlib.sha256(checks_path.read_bytes()).hexdigest(),
                'attribution': ATTRIBUTION}
    stats = {'raw_objects': len(raw['elements']), 'normalized_objects': len(records), 'deduplicated_candidates': len(pool),
             'selected': len(selected), 'category_counts': dict(counts),
             'previous_match_status': dict(Counter(m['status'] for m in matches)),
             'selected_with_official_field_checks': sum(bool(r['review']['official_checks']) for r in selected),
             'selected_missing': {k:sum(r['place'][k] is None for r in selected) for k in FIELDS},
             'selected_with_address_components': sum(bool(r['source']['address_components']) for r in selected)}
    output.mkdir(parents=True, exist_ok=True)
    for filename, document in [('collection_manifest.json',dict(metadata, statistics=stats)),
                               ('osaka_candidates_fresh.json',dict(metadata, places=records)),
                               ('osaka_places_150_fresh.json',dict(metadata, category_quotas=QUOTAS, places=selected)),
                               ('previous_draft_comparison.json',dict(metadata, matches=matches))]:
        (output/filename).write_text(json.dumps(document,ensure_ascii=False,indent=2)+'\n', encoding='utf-8')
    lines = ['# 오사카 실제 수집 결과', '', f"수집 완료 시각(UTC): {collected_at}",
             f"OSM 데이터 기준 시각(UTC): {metadata['osm_base_timestamp']}", '',
             f"원본 객체 {stats['raw_objects']:,}개 → 분류 가능한 객체 {stats['normalized_objects']:,}개 → 근접 중복 정리 후 후보 {len(pool):,}개 → 검토용 150개.", '',
             '## 선정 결과', '', '| 구분 | 개수 |', '| --- | ---: |']
    lines += [f'| {k} | {v} |' for k,v in QUOTAS.items()]
    lines += ['', '## 기존 초안 비교', '', f"매칭 결과: {stats['previous_match_status']}",
              '동일 이름·분류·250m 이내 거리로 연결했다. 비슷하게 가까운 후보가 여럿이면 모호함으로 남겼다. 이름 변경·폐업 여부는 자동 판정하지 않았다.',
              '기존 ID는 명확히 연결된 장소만 유지했다. 매칭되지 않은 장소는 비교 파일에 남기고 빈 자리는 새 후보로 채웠다.', '',
              '## 공식 자료 확인', '', f"선정된 장소 중 {stats['selected_with_official_field_checks']}곳의 일부 항목을 공식 자료와 대조했다. 장소 전체 검증 완료를 뜻하지 않는다.",
              '검증 항목·URL·확인일은 official_checks.json과 각 장소의 field_sources에 기록했다.',
              '오사카성의 OSM 700 JPY/17시 폐장 정보 대신 공식 안내의 1,200 JPY/18시 폐장을 반영했다.',
              '신사이바시스지의 잘못된 OSM 한국어명과 웹사이트는 공식 관광 안내로 보완했다.',
              '브루클린 신사이바시 지점과 난바 지점을 구분했다. 다른 지점 영업시간을 옮겨 넣지 않았다.', '',
              '## 남은 보완', '', '| 항목 | 미확인/누락 |', '| --- | ---: |']
    lines += [f'| {k} | {v} |' for k,v in stats['selected_missing'].items() if v]
    lines += ['', '주소 구성요소는 source.address_components에 보존했다. 부분 주소를 완전한 주소로 단정하거나 추정 번역하지 않았다.',
              'OSM 객체의 최근 수정일은 개별 영업시간의 확인일이 아니다. 신규 OSM 수집만으로 verified_at을 채우지 않았다.',
              '체류시간·짐·실내 여부 및 미확인 비용은 null이다. 예전 샘플 추정값을 공식 사실로 승격하지 않았다.',
              '선별은 기존 초안 연결과 정보 보유 여부·지역 분산을 사용한 검토용 샘플이다. 150곳 모두 관광 적합성을 검증한 추천 목록은 아니다.',
              '일정 생성 연결은 아직 하지 않았다. 마지막 입장·휴무·임시 운영·지점 확인이 필요한 상태로 schedule_ready=false를 기록했다.',
              '범위는 위도 34.60~34.75, 경도 135.40~135.60의 오사카 중심부 사각형이며 오사카부 전체가 아니다.', '',
              '## 출처', '', '[© OpenStreetMap contributors — ODbL](https://www.openstreetmap.org/copyright)',
              '공식 페이지 본문·사진은 복제하지 않고 확인한 사실과 출처 링크만 기록했다.']
    (output/'collection_report.md').write_text('\n'.join(lines)+'\n', encoding='utf-8')
    return stats


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument('--raw', type=Path)
    parser.add_argument('--query', type=Path, required=True)
    parser.add_argument('--previous', type=Path, default=root/'data/week5/osaka_places_week5_draft.json')
    parser.add_argument('--checks', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    raw_path = args.raw
    if raw_path is None:
        # Never overwrite a prior raw snapshot. No automatic parallel/retry load
        # against the public endpoint; a failed call is explicit.
        args.output.mkdir(parents=True, exist_ok=True)
        raw_path = args.output / ('overpass_' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.json')
        request = urllib.request.Request(ENDPOINT, data=urllib.parse.urlencode({'data':args.query.read_text(encoding='utf-8')}).encode(),
                    headers={'User-Agent':'GatiroCapstone/0.1 (Osaka academic dataset collection)'})
        with urllib.request.urlopen(request, timeout=115) as response:
            payload = response.read()
        parsed = json.loads(payload)
        if parsed.get('remark') or not parsed.get('elements'): raise ValueError('Incomplete Overpass response')
        with raw_path.open('xb') as handle: handle.write(payload)
    print(json.dumps(build(raw_path,args.query,args.previous,args.checks,args.output),ensure_ascii=False,indent=2))


if __name__ == '__main__': main()
