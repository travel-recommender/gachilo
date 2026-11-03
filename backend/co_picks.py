"""Build co-pick counts from current, server-saved P3 lists (no public API)."""
import argparse
from collections import Counter
from contextlib import closing
from datetime import datetime, timezone
from itertools import combinations
import json
import os
from pathlib import Path
import sqlite3
import tempfile

from place_catalog import DATA
from real_engine import REAL_DATASET

DEMO_DATASET = 'prototype_demo_36'
DATASETS = (REAL_DATASET, DEMO_DATASET)


def catalog_ids(dataset):
    """Search-only known places can supply evidence; excluded places cannot."""
    if dataset == REAL_DATASET:
        records = json.loads(DATA.read_text(encoding='utf-8'))['places']
        return {r['place']['place_id'] for r in records
                if r['review'].get('final_csv', {}).get('record_status') != '제외'}
    if dataset == DEMO_DATASET:
        path = Path(__file__).parent / 'engine/catalog.json'
        return {p['id'] for p in json.loads(path.read_text(encoding='utf-8'))}
    raise ValueError('지원하지 않는 장소 데이터 모드입니다.')


def _ids(row):
    # Match Store.pool: an explicitly saved P3 list, including [], takes priority.
    # Full submissions are a legacy fallback, never a second observation.
    try:
        if row['ids'] is not None:
            value, source = json.loads(row['ids']), 'p3'
        elif row['payload'] is not None:
            value = json.loads(row['payload'])['longlist']
            source = 'submissionFallback'
        else:
            return None, None
        if not (isinstance(value, list) and len(value) <= 30
                and all(isinstance(x, str) and 1 <= len(x) <= 100 for x in value)):
            raise ValueError()
    except (ValueError, TypeError, KeyError):
        # Do not put a member's raw inputs in logs or publish a partial count.
        raise ValueError('저장된 P3 목록 형식이 잘못되어 집계를 중단했습니다.') from None
    return set(value), source


def build_counts(database, dataset=REAL_DATASET):
    """Rebuild one consistent snapshot without changing the source database.

    One room member's current list contributes at most one vote per unordered
    pair. Repeated saves/rejoins do not add votes; edits/removals take effect on
    the next build. There are no cross-room user accounts, so this is NOT a
    unique-person count. All rooms in this database for this dataset contribute.
    """
    allowed = catalog_ids(dataset)
    database = Path(database).resolve()
    places, pairs = Counter(), Counter()
    sources = {'p3': 0, 'submissionFallback': 0}
    saved = nonempty = paired = ignored = 0
    with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True, timeout=10)) as c:
        c.row_factory = sqlite3.Row
        c.execute('PRAGMA query_only=ON')
        c.execute('BEGIN')
        has_p3 = c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='longlists'").fetchone()
        # Older demo databases predate dedicated P3 storage. Read their submitted
        # longlists without creating/migrating tables in a running server's DB.
        ids_sql = 'l.ids' if has_p3 else 'NULL'
        p3_join = 'LEFT JOIN longlists l ON l.member_id=m.id' if has_p3 else ''
        rows = c.execute(f'''
            SELECT {ids_sql} AS ids,
                   CASE WHEN {ids_sql} IS NULL THEN s.payload END AS payload
            FROM rooms r JOIN members m ON m.room_id=r.id
            {p3_join}
            LEFT JOIN submissions s ON s.member_id=m.id
            WHERE r.dataset=?
        ''', (dataset,))
        for row in rows:
            ids, source = _ids(row)
            if ids is None:
                continue
            saved += 1
            sources[source] += 1
            valid = sorted(x for x in ids if x in allowed and not x.startswith('custom_'))
            ignored += len(ids) - len(valid)
            nonempty += bool(valid)
            paired += len(valid) >= 2
            places.update(valid)
            pairs.update(combinations(valid, 2))
    return {
        'schemaVersion': 1,
        'dataset': dataset,
        'countUnit': 'room_member_list',
        'sourcePolicy': 'p3_then_submission_fallback',
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'savedListCount': saved,
        'nonEmptyListCount': nonempty,
        'pairListCount': paired,
        'sourceCounts': sources,
        'ignoredPlaceSelections': ignored,
        'placeCounts': [{'placeId': key, 'listCount': value}
                        for key, value in sorted(places.items())],
        'pairs': [{'placeIds': list(key), 'listCount': value}
                  for key, value in sorted(pairs.items())],
    }


def write_counts(counts, output):
    """Replace a local JSON export only after a complete successful build."""
    output = Path(output)
    if output.suffix != '.json':
        raise ValueError('집계 파일은 .json 확장자로 저장하세요.')
    output.parent.mkdir(parents=True, exist_ok=True)
    name = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8',
                                         dir=output.parent, delete=False) as f:
            name = f.name
            json.dump(counts, f, ensure_ascii=False, indent=2)
            f.write('\n')
        os.replace(name, output)
    finally:
        if name and os.path.exists(name):
            os.unlink(name)


def main(argv=None):
    parser = argparse.ArgumentParser(description='서버에 저장한 P3 목록의 함께 담기 집계')
    parser.add_argument('--db', required=True, type=Path, help='집계할 서버 SQLite 파일')
    parser.add_argument('--dataset', choices=DATASETS, default=REAL_DATASET)
    parser.add_argument('--output', type=Path,
                        default=Path(__file__).parent / '.local/co_pick_counts.json')
    args = parser.parse_args(argv)
    try:
        if args.db.resolve() == args.output.resolve():
            raise ValueError('원본 DB와 집계 파일 경로는 달라야 합니다.')
        counts = build_counts(args.db, args.dataset)
        write_counts(counts, args.output)
    except (OSError, sqlite3.Error, ValueError, KeyError, TypeError):
        # SQLite/schema and input errors must not look like a successful empty export.
        parser.exit(1, '집계 실패: DB 경로·테이블·P3 목록·카탈로그와 출력 경로를 확인하세요.\n')
    print(f"집계 완료: {counts['savedListCount']}개 참여 목록, "
          f"{len(counts['pairs'])}개 장소 쌍 → {args.output}")


if __name__ == '__main__':
    main()
