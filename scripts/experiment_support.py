"""Local rehearsal preparation and SQLite recovery. Never starts a public experiment."""
import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
from contextlib import closing, contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
TABLES = ('rooms', 'members', 'submissions', 'results', 'longlists')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path, value):
    with path.open('x', encoding='utf-8') as out:
        json.dump(value, out, ensure_ascii=False, indent=2)
        out.write('\n')
    path.chmod(0o600)


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args], text=True).strip()


def clean_commit():
    if git('status', '--porcelain', '--untracked-files=normal'):
        raise ValueError('코드 변경을 커밋한 뒤 준비하세요. 실행 중에는 고정한 checkout을 유지하세요.')
    return git('rev-parse', 'HEAD')


def prepare(bundle):
    commit = clean_commit()
    source = read_json(ROOT / 'data/runtime_catalog.json')
    bundle.mkdir(parents=True, exist_ok=False, mode=0o700)
    # A failed preparation is retained for inspection; it is never reused silently.
    files = {}
    for key in ('catalog', 'profiles'):
        original = ROOT / 'data' / source[key]
        target = bundle / f'{key}.json'
        shutil.copyfile(original, target)
        target.chmod(0o600)
        files[key] = {'file': target.name, 'sha256': digest(target), 'source': source[key]}
    places = read_json(bundle / 'catalog.json')['places']
    ids = [row['place']['place_id'] for row in places]
    if len(set(ids)) != len(ids):
        raise ValueError('장소 ID가 중복됩니다. 준비를 중단합니다.')
    manifest = {'schema': 1, 'created_at': datetime.now(timezone.utc).isoformat(),
                'commit': commit, 'dataset': 'osaka_review_150', 'files': files,
                'catalog_version': source['version'], 'catalog_rows': len(ids),
                'purpose': 'local_rehearsal_only', 'travel_dates': None,
                'recommendation_card_policy': 'pending_team_decision'}
    write_json(bundle / 'manifest.json', manifest)
    return manifest


def verify(bundle, *, code=False):
    manifest = read_json(bundle / 'manifest.json')
    if manifest.get('schema') != 1:
        raise ValueError('지원하지 않는 준비 파일입니다.')
    for key in ('catalog', 'profiles'):
        item = manifest['files'][key]
        if item['file'] != f'{key}.json' or digest(bundle / item['file']) != item['sha256']:
            raise ValueError(f'{key} 데이터가 준비 이후 바뀌었습니다. 새 묶음을 만드세요.')
    if code and clean_commit() != manifest['commit']:
        raise ValueError('준비 당시 코드와 다릅니다. 해당 커밋의 checkout 또는 새 묶음을 쓰세요.')
    return manifest


def group_dir(bundle, group):
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}', group):
        raise ValueError('그룹 이름은 영문·숫자·밑줄·하이픈 1~40자로 지정하세요.')
    path = bundle / 'groups' / group
    if path.is_symlink() or (path.exists() and not path.is_dir()):
        raise ValueError('그룹 경로는 일반 디렉터리여야 합니다.')
    if path.parent.is_symlink():
        raise ValueError('그룹 디렉터리에 링크를 사용할 수 없습니다.')
    return path


def database_summary(path):
    if not path.is_file() or path.is_symlink():
        raise ValueError('기존 SQLite 파일을 찾지 못했습니다.')
    with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as db:
        result = db.execute('PRAGMA quick_check').fetchall()
        if result != [('ok',)]:
            raise ValueError('SQLite 무결성 검사 실패. 원본을 보존하고 백업을 확인하세요.')
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not set(TABLES) <= tables:
            raise ValueError('가치로 서버 DB 구조가 아닙니다.')
        counts = {name: db.execute(f'SELECT count(*) FROM {name}').fetchone()[0] for name in TABLES}
    return {'quick_check': 'ok', 'counts': counts}


@contextmanager
def group_lock(path):
    with (path / 'server.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('이 그룹의 준비 서버가 이미 실행 중입니다.') from None
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def snapshot(source, destination):
    """SQLite backup API includes committed WAL records; never copy a live DB file."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    deadline = time.monotonic() + 30
    def progress(*_):
        if time.monotonic() > deadline:
            raise TimeoutError('DB 백업이 30초 안에 완료되지 않았습니다.')
    try:
        source_db = sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True, timeout=5)
        try:
            target_db = sqlite3.connect(destination)
            try:
                source_db.backup(target_db, pages=128, progress=progress, sleep=0.05)
            finally:
                target_db.close()
        finally:
            source_db.close()
        return database_summary(destination)
    except BaseException:
        destination.unlink(missing_ok=True)  # Only the file exclusively created by this call.
        raise


def backup(bundle, group, destination):
    verify(bundle)
    source = group_dir(bundle, group) / 'trips.sqlite3'
    database_summary(source)
    metadata = destination.with_suffix(destination.suffix + '.json')
    if destination.exists() or destination.is_symlink() or metadata.exists() or metadata.is_symlink():
        raise ValueError('백업 대상이 이미 있습니다. 새 파일명을 쓰세요.')
    config = read_json(source.parent / 'rehearsal.json')
    summary = snapshot(source, destination)
    record = {'schema': 1, 'group': group, 'created_at': datetime.now(timezone.utc).isoformat(),
              'manifest_sha256': digest(bundle / 'manifest.json'), 'db_sha256': digest(destination),
              'rehearsal_config': config,
              **summary}
    private = source.parent / 'room-private.json'
    if private.exists():
        record['room_private'] = read_json(private)
    write_json(metadata, record)
    # Recovery credentials belong only in the mode-0600 metadata, never CLI output.
    return {k: v for k, v in record.items() if k != 'room_private'}


def restore(bundle, source, new_group):
    verify(bundle)
    metadata = read_json(source.with_suffix(source.suffix + '.json'))
    if (metadata.get('schema') != 1 or metadata['manifest_sha256'] != digest(bundle / 'manifest.json')
            or metadata['db_sha256'] != digest(source)):
        raise ValueError('백업의 데이터 버전 또는 파일 해시가 일치하지 않습니다.')
    database_summary(source)
    target = group_dir(bundle, new_group)
    target.mkdir(parents=True, exist_ok=False, mode=0o700)
    summary = snapshot(source, target / 'trips.sqlite3')
    write_json(target / 'rehearsal.json', metadata['rehearsal_config'])
    if 'room_private' in metadata:
        write_json(target / 'room-private.json', metadata['room_private'])
    write_json(target / 'restored_from.json', {'original_group': metadata['group'],
               'backup_created_at': metadata['created_at'], 'backup_sha256': metadata['db_sha256']})
    return summary


def node_binary(value):
    binary = shutil.which(value or 'node')
    if not binary or int(subprocess.check_output([binary, '-p', 'process.versions.node.split(".")[0]'],
                                                 text=True, timeout=5).strip()) < 24:
        raise ValueError('Node.js 24 이상이 필요합니다. --node 또는 NODE_BINARY를 지정하세요.')
    return binary


def offline_env(bundle, node):
    # Deliberate allowlist: no inherited AI/weather/routing/debug overrides or credentials.
    env = {k: os.environ[k] for k in ('PATH', 'HOME', 'TMPDIR', 'LANG') if k in os.environ}
    env.update({'NODE_BINARY': node, 'REAL_CATALOG_PATH': str(bundle / 'catalog.json'),
                'REAL_PROFILES_PATH': str(bundle / 'profiles.json'), 'WEATHER_ENABLED': '0',
                'SOMSOM_API_KEY': '', 'AI_MOCK': '', 'OSRM_FOOT_URL': '', 'PYTHONUNBUFFERED': '1'})
    return env


def audit(bundle, start, end, node):
    verify(bundle, code=True)
    days = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1
    if not 1 <= days <= 30:
        raise ValueError('여행 날짜는 시작일 포함 1~30일이어야 합니다.')
    result = subprocess.run([node, str(ROOT / 'scripts/experiment_catalog_audit.mjs'), start, end],
                            env=offline_env(bundle, node), capture_output=True, text=True,
                            timeout=30, check=True)
    return json.loads(result.stdout)


def rehearsal(args):
    verify(args.bundle, code=True)
    node = node_binary(args.node)
    origin = urlsplit(args.origin)
    if (origin.scheme != 'http' or origin.hostname != 'localhost' or origin.path
            or origin.query or origin.fragment or origin.username or origin.password or not origin.port):
        raise ValueError('--origin은 http://localhost:포트 형태여야 합니다.')
    if not 1024 <= args.port <= 65535:
        raise ValueError('API 포트는 1024~65535로 지정하세요.')
    if not re.fullmatch(r'\d{1,6}(\.\d{1,6})?', args.rate) or float(args.rate) <= 0:
        raise ValueError('--rate는 1엔당 원화, 양수·소수점 6자리 이내여야 합니다.')
    if date.fromisoformat(args.rate_date).isoformat() != args.rate_date:
        raise ValueError('--rate-date는 YYYY-MM-DD여야 합니다.')
    if '하나은행' not in args.rate_source and 'kebhana.com' not in args.rate_source:
        raise ValueError('--rate-source에 하나은행 고시환율 출처를 기록하세요.')
    path = group_dir(args.bundle, args.group)
    exists = (path / 'trips.sqlite3').exists()
    if path.exists() and not args.resume:
        raise ValueError('그룹이 이미 있습니다. 재시작은 --resume, 새 시험은 새 그룹 이름을 쓰세요.')
    if args.resume and not exists:
        raise ValueError('--resume에는 기존 그룹 DB가 필요합니다.')
    if exists:
        database_summary(path / 'trips.sqlite3')
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    env = offline_env(args.bundle, node)
    env.update({'JPY_TO_KRW': args.rate, 'JPY_TO_KRW_AS_OF': args.rate_date,
                'JPY_TO_KRW_SOURCE': args.rate_source})
    config = {'port': args.port, 'origin': args.origin, 'rate': args.rate,
              'rate_date': args.rate_date, 'rate_source': args.rate_source}
    with group_lock(path):
        config_file = path / 'rehearsal.json'
        if config_file.exists():
            if read_json(config_file) != config:
                raise ValueError('재시작 설정이 다릅니다. 기존 포트·origin·환율 설정을 유지하세요.')
        else:
            write_json(config_file, config)
        print(f'로컬 준비 시험 전용 · 그룹 {args.group} · API http://localhost:{args.port}', flush=True)
        print('실제 참가자 실험 아님: AI·날씨 조회·OSRM 비활성, 기존 추정 경로 사용. Ctrl+C로 종료.', flush=True)
        process = subprocess.Popen([sys.executable, str(ROOT / 'backend/server.py'), '--host', '127.0.0.1',
                                    '--port', str(args.port), '--origin', args.origin,
                                    '--db', str(path / 'trips.sqlite3')], cwd=ROOT, env=env)
        try:
            return process.wait()
        except KeyboardInterrupt:
            if process.poll() is None:
                process.send_signal(signal.SIGINT)
            return process.wait(timeout=15)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True, help='고정 데이터와 그룹 DB를 둘 새 폴더')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('prepare')
    check = commands.add_parser('check')
    check.add_argument('--group')
    dates = commands.add_parser('audit')
    dates.add_argument('--start', required=True)
    dates.add_argument('--end', required=True)
    dates.add_argument('--node', default=os.environ.get('NODE_BINARY'))
    run = commands.add_parser('serve-rehearsal')
    run.add_argument('--group', required=True)
    run.add_argument('--resume', action='store_true')
    run.add_argument('--port', type=int, default=8111)
    run.add_argument('--origin', default='http://localhost:3111')
    run.add_argument('--node', default=os.environ.get('NODE_BINARY'))
    run.add_argument('--rate', required=True)
    run.add_argument('--rate-date', required=True)
    run.add_argument('--rate-source', required=True)
    save = commands.add_parser('backup')
    save.add_argument('--group', required=True)
    save.add_argument('--output', type=Path, required=True)
    recover = commands.add_parser('restore')
    recover.add_argument('--input', type=Path, required=True)
    recover.add_argument('--new-group', required=True)
    args = parser.parse_args()
    args.bundle = args.bundle.expanduser().resolve()
    try:
        if args.command == 'prepare':
            result = prepare(args.bundle)
        elif args.command == 'check':
            result = {'manifest': verify(args.bundle, code=True)}
            if args.group:
                result['database'] = database_summary(group_dir(args.bundle, args.group) / 'trips.sqlite3')
        elif args.command == 'audit':
            result = audit(args.bundle, args.start, args.end, node_binary(args.node))
        elif args.command == 'serve-rehearsal':
            return rehearsal(args)
        elif args.command == 'backup':
            result = backup(args.bundle, args.group, args.output.expanduser().absolute())
        else:
            result = restore(args.bundle, args.input.expanduser().absolute(), args.new_group)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (ValueError, OSError, sqlite3.Error, KeyError, subprocess.SubprocessError) as error:
        print(f'준비 작업 실패: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
