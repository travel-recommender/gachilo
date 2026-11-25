#!/usr/bin/env python3
"""체류시간 대표값을 팀 범위의 상한에서 하한으로 바꾼 새 카탈로그를 만든다 (11/25 실험 피드백).

이슈 #1의 사용자 제공 범위(관광 명소 90~120분, 쇼핑몰·백화점 90~180분 등)에서 지금까지는
"일정 여유를 위해" 상한을 대표값으로 썼다. 실험에서 하루 장소가 2~4곳뿐이라 일정이 너무 적었으므로
같은 범위의 하한을 쓴다. 범위 밖의 장소별 값(예: 50분, 120분 식당)과 범위가 없는 곳은 그대로 둔다.

입력 카탈로그는 수정하지 않는다. 사용법:
  python3 scripts/apply_stay_lower_bound.py data/final/osaka_catalog_20261112.json data/final/osaka_catalog_20261125.json
"""
import copy
import hashlib
import json
import sys
from pathlib import Path

REVISION = 'team_planning_rules_20261125_lower_bound'
CHECKED_AT = '2026-11-25'
# 범위가 한 값으로만 적힌 '지점별 시연 추정'·'시연 추정'은 원래 범위(README: 쇼핑30·백화점180·식당90, 카페60은 상한)로 되돌려 하한을 쓴다.
# 포장·간식 20분은 따로 정한 기준이라 그대로 둔다.
SINGLE_VALUE_LOWER = {180: 90, 90: 60, 60: 45, 30: 15}


def lower_bound(record):
    """(새 체류시간, 사유) 또는 None."""
    policy = record['review'].get('stay_policy') or {}
    stay = record['place'].get('stay_min')
    low, high, rep = policy.get('min'), policy.get('max'), policy.get('representative')
    if not all(isinstance(v, int) for v in (low, high, rep, stay)):
        return None
    if low < high and rep == high and stay == rep:
        return low, f'사용자 제공 범위 {low}~{high}분의 하한'
    if low == high == rep == stay and stay in SINGLE_VALUE_LOWER and '시연 추정' in (policy.get('type') or ''):
        return SINGLE_VALUE_LOWER[stay], f'시연 추정 {stay}분(기존 범위 상한)을 같은 범위의 하한으로'
    return None


def main(src, dst):
    raw = Path(src).read_bytes()
    catalog = json.loads(raw)
    out = copy.deepcopy(catalog)
    changed = []
    for record in out['places']:
        hit = lower_bound(record)
        if not hit:
            continue
        new, why = hit
        old = record['place']['stay_min']
        record['place']['stay_min'] = new
        policy = record['review']['stay_policy']
        policy['representative'] = new
        policy['method'] = why + '; 이동·대기시간 별도 (11/25 실험 피드백: 하루 장소 수가 너무 적음)'
        source = record['field_sources'].setdefault('stay_min', {})
        source.update({'revision': REVISION, 'checked_at': CHECKED_AT,
                       'note': f'{why}. 이전 대표값 {old}분(상한). 실제 관람 소요시간이 아닌 추정값.'})
        changed.append((record['place']['place_id'], old, new))
    out.setdefault('input_provenance', {})
    if isinstance(out['input_provenance'], dict):
        out['input_provenance']['stay_lower_bound'] = {
            'input': Path(src).name, 'sha256': hashlib.sha256(raw).hexdigest(),
            'script': 'scripts/apply_stay_lower_bound.py', 'revision': REVISION, 'changed_count': len(changed)}
    Path(dst).write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    summary = {}
    for _, old, new in changed:
        summary[f'{old}->{new}'] = summary.get(f'{old}->{new}', 0) + 1
    print(f'{len(changed)}곳 변경', dict(sorted(summary.items())))


if __name__ == '__main__':
    main(*sys.argv[1:3])
