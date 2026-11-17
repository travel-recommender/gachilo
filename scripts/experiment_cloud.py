"""One public HTTPS service, four isolated experiment databases on a persistent volume.

Never imports laptop databases or credentials. Setup mode accepts no participant input.
"""
import html
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
from contextlib import ExitStack
from datetime import date, datetime, timezone
from functools import partial
from urllib.parse import urlencode, urlsplit

import experiment_lan as lan
import experiment_share as share
import experiment_support as support

ROOT = Path(__file__).resolve().parents[1]
GROUPS = dict(lan.GROUPS)
GROUP_META = {g: (title, lan.CODES[g]) for g, title in GROUPS.items()}


def configuration():
    mode = os.getenv('EXPERIMENT_MODE', 'setup')
    if mode not in ('setup', 'rehearsal', 'live'):
        raise ValueError('EXPERIMENT_MODE must be setup, rehearsal or live')
    session = os.getenv('EXPERIMENT_SESSION', 'team-20261116-v1')
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,59}', session):
        raise ValueError('Invalid session name')
    start, end = os.getenv('EXPERIMENT_START_DATE', '2026-11-16'), os.getenv('EXPERIMENT_END_DATE', '2026-11-19')
    if (date.fromisoformat(end) - date.fromisoformat(start)).days != 3:
        raise ValueError('The experiment requires four travel days')
    active = set(filter(None, os.getenv('EXPERIMENT_ACTIVE_GROUPS', 'team').split(',')))
    if not active <= set(GROUPS):
        raise ValueError('Unknown active group')
    public_value = os.getenv('PUBLIC_ORIGIN', '')
    if not public_value:
        raise ValueError('Set PUBLIC_ORIGIN to the public HTTPS origin')
    public = share.origin(public_value)
    admin = os.environ.get('EXPERIMENT_ADMIN_TOKEN', '')
    if len(admin) < 32 or not admin.isascii():
        raise ValueError('Set a separate random ASCII EXPERIMENT_ADMIN_TOKEN of at least 32 characters')
    commit = os.environ.get('RAILWAY_GIT_COMMIT_SHA') or os.environ.get('EXPERIMENT_CODE_VERSION', '')
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('A full deployed commit SHA is required')
    if mode == 'live':
        if not all(os.getenv(k) for k in ('GOOGLE_PLACES_API_KEY', 'SOMSOM_API_KEY')):
            raise ValueError('Live mode requires Places and Somsom server keys')
        if os.getenv('LIVE_CHECK_MOCK') or os.getenv('AI_MOCK'):
            raise ValueError('Mock responses are forbidden in live mode')
    return {'mode': mode, 'session': session, 'dates': [start, end], 'active': active,
            'origin': public, 'admin': admin, 'commit': commit}


def freeze_bundle(bundle, cfg):
    """Refuse to overwrite frozen code/data/date identity on a restart or deployment."""
    source = support.read_json(ROOT/'data/runtime_catalog.json')
    identity = {'commit': cfg['commit'], 'mode': cfg['mode'], 'dates': cfg['dates'],
                'recommendationCards': 'disabled_in_experiment', 'survey': 'google_form',
                'groupSize': 3, 'ai': cfg['mode'] == 'live',
                'osrm': bool(os.getenv('OSRM_FOOT_URL')) if cfg['mode'] == 'live' else False}
    if (bundle/'manifest.json').exists():
        support.verify(bundle)
        if support.read_json(bundle/'experiment-config.json') != identity:
            raise ValueError('Frozen experiment differs: use a NEW EXPERIMENT_SESSION; old records are retained')
        for key in ('catalog', 'profiles'):
            if support.digest(ROOT/'data'/source[key]) != support.digest(bundle/f'{key}.json'):
                raise ValueError('Frozen catalog differs from deployed code')
        return
    # A partial preparation must never be mistaken for a fresh session.
    if (bundle/'groups').exists() or (bundle/'catalog.json').exists():
        raise ValueError('Incomplete session initialization: preserve it and use a new session')
    files = {}
    for key in ('catalog', 'profiles'):
        target = bundle/f'{key}.json'
        support.write_private_text(target, (ROOT/'data'/source[key]).read_text(), exclusive=True)
        files[key] = {'file': target.name, 'sha256': support.digest(target), 'source': source[key]}
    rows = support.read_json(bundle/'catalog.json')['places']
    ids = [r['place']['place_id'] for r in rows]
    if len(set(ids)) != len(ids):
        raise ValueError('Duplicate place IDs')
    support.write_json(bundle/'experiment-config.json', identity)
    support.write_json(bundle/'manifest.json', {'schema': 1, 'created_at': datetime.now(timezone.utc).isoformat(),
        'commit': cfg['commit'], 'dataset': 'osaka_review_150', 'files': files,
        'catalog_version': source['version'], 'catalog_rows': len(ids),
        'purpose': 'h4_user_experiment' if cfg['mode'] == 'live' else 'local_h4_rehearsal',
        'travel_dates': cfg['dates'], 'recommendation_card_policy': 'disabled_in_experiment'})


def cloud_entry(group, cfg, invite):
    title, code = GROUP_META[group]
    rehearsal = '<p class="pill">모의 점검 · 실제 실험 응답이 아닙니다</p>' if cfg['mode'] == 'rehearsal' else ''
    return lan.page(title+' 실험', '<div class="eyebrow">GACHILO · EXPERIMENT</div><h1>'+title+'</h1>'+rehearsal+
        '<p>가상 오사카 여행: '+cfg['dates'][0]+' ~ '+cfg['dates'][1]+' · 3명</p>'
        '<p>아이폰 Safari / 안드로이드 Chrome · 인터넷만 연결하면 됩니다.</p>'
        '<div class="notice">① 진행자가 배정한 '+code+'-01·02·03 중 본인 번호로 입장하세요. 01번은 진행자가 준 PIN, 02·03번은 처음 입장할 때 정한 PIN을 사용합니다.'
        '<br>② 장소 6곳 이상 → 꼭 가기 5곳 → 숙소·예산·체력 등 화면의 입력을 완료하세요.'
        '<br>③ 세 명 모두 제출하면 일정 A·B·C를 살펴보고 결과 화면의 Google 설문에 답하세요.'
        '<br><br>진행자 안내 후 시작하고, 평가 중에는 다른 사람과 상의하지 마세요. 앱 안에서 일정을 확정하지 않습니다. 새로고침·재접속은 같은 번호와 PIN을 사용하세요.'
        '<br>여행 입력·계산 기록은 실험 서버에, 설문 응답은 혜인님의 Google 설문에 저장됩니다.</div>'
        '<a class="button" href="'+html.escape(invite, quote=True)+'">실험방 입장</a>')


class CloudGateway(share.SharedGateway):
    def route(self):
        cfg = self.server.config
        parsed = urlsplit(self.path)
        # Railway health checks can use their own Host. No identity/secret information is returned.
        if self.command == 'GET' and self.path == '/healthz':
            okay = all(p.poll() is None for p in cfg['processes'])
            return self.respond(200 if okay else 503, json.dumps({'ok': okay}).encode(), 'application/json')
        if parsed.path.startswith('/admin/'):
            if self.headers.get('Host') != urlsplit(cfg['origin']).netloc or self.headers.get('Origin') not in (None, cfg['origin']):
                return self.respond(403)
            if self.command != 'GET' or parsed.path != '/admin/status' or parsed.query:
                return self.respond(404)
            token = self.headers.get('Authorization', '')
            if not token.isascii() or not secrets.compare_digest(token, 'Bearer '+cfg['admin']):
                return self.respond(403)
            rows = []
            for group in GROUPS:
                row = {'group': group, 'title': GROUPS[group], 'active': group in cfg['active_groups'],
                       'link': cfg['origin']+'/g/'+group+'/'+cfg['tokens'][group]}
                private = cfg['bundle']/'groups'/group/'room-private.json'
                if private.exists():
                    row['participant1Pin'] = support.read_json(private)['participant1Pin']
                    row['database'] = support.database_summary(private.parent/'trips.sqlite3')
                rows.append(row)
            return self.respond(200, json.dumps({'session': cfg['session'], 'mode': cfg['mode'],
                'commit': cfg['commit'], 'dates': cfg['dates'], 'groups': rows}, ensure_ascii=False).encode(), 'application/json')
        # Keep the participant instructions ahead of the room selector.
        if parsed.path == '/entry/' and self.command in ('GET', 'HEAD'):
            from http.cookies import SimpleCookie, CookieError
            try:
                cookies = SimpleCookie(self.headers.get('Cookie', ''))
                token = cookies[share.COOKIE].value if share.COOKIE in cookies else ''
            except CookieError:
                token = ''
            if not re.fullmatch(r'[A-Za-z0-9_-]{32}', token):
                return self.respond(403)
            group = next((g for g, t in cfg['tokens'].items() if secrets.compare_digest(token, t)), None)
            if (group in cfg['active_groups'] and cfg['mode'] != 'setup'
                    and self.headers.get('Host') == urlsplit(cfg['origin']).netloc
                    and self.headers.get('Origin') in (None, cfg['origin'])):
                return self.respond(200, cfg['entries'][group].encode())
        return super().route()

    do_GET = route
    do_HEAD = route
    do_POST = route
    do_PUT = route
    do_OPTIONS = route


def main():
    os.umask(0o077)
    cfg = configuration()
    bundle = Path(os.getenv('EXPERIMENT_DATA_DIR', '/data')).resolve()/cfg['session']
    bundle.mkdir(parents=True, exist_ok=True, mode=0o700)
    web = ROOT/'web/out'
    if not all((web/p/'index.html').is_file() for p in ('join', 'result', 'plan')):
        raise ValueError('Experiment web export missing')
    node = support.node_binary(os.getenv('NODE_BINARY', 'node'))
    processes, servers = [], []
    port = int(os.getenv('PORT', '8080'))
    api_base = int(os.getenv('EXPERIMENT_API_PORT', '8180'))
    lan_base = int(os.getenv('EXPERIMENT_WEB_PORT', '3180'))
    config = {**cfg, 'bundle': bundle, 'tokens': share.group_tokens(bundle, GROUP_META), 'groups': GROUP_META,
              'active_groups': cfg['active'], 'upstreams': {}, 'rooms': {}, 'joins': {}, 'entries': {}, 'processes': processes}
    with ExitStack() as stack:
        stack.enter_context(support.group_lock(bundle))
        try:
            if cfg['mode'] != 'setup':
                freeze_bundle(bundle, cfg)
                for i, (group, title) in enumerate(GROUPS.items()):
                    directory = support.group_dir(bundle, group)
                    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
                    stack.enter_context(support.group_lock(directory))
                    api, local = api_base+i, lan_base+i
                    lan.probe_port('127.0.0.1', api)
                    lan.probe_port('127.0.0.1', local)
                    env = support.offline_env(bundle, node)
                    env.update({'EXPERIMENT_SERVER': '1', 'JPY_TO_KRW': '8.6253', 'JPY_TO_KRW_AS_OF': '2026-09-30',
                                'JPY_TO_KRW_SOURCE': '하나은행 2026-09-30 실험 고정 환율; 현재 환율 아님'})
                    if cfg['mode'] == 'rehearsal':
                        env['LIVE_CHECK_MOCK'] = 'pass'
                    else:
                        for key in ('GOOGLE_PLACES_API_KEY', 'SOMSOM_API_KEY', 'SOMSOM_BASE_URL', 'SOMSOM_MODEL', 'OSRM_FOOT_URL'):
                            if key in os.environ:
                                env[key] = os.environ[key]
                    if not (directory/'rehearsal.json').exists():
                        support.write_json(directory/'rehearsal.json', {'experiment': support.read_json(bundle/'experiment-config.json'), 'group': group})
                    log = stack.enter_context((directory/'server.log').open('a'))
                    process = subprocess.Popen([sys.executable, '-X', 'utf8', str(ROOT/'backend/server.py'), '--db', str(directory/'trips.sqlite3'),
                        '--host', '127.0.0.1', '--port', str(api), '--origin', f'http://localhost:{local}'], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
                    processes.append(process)
                    for _ in range(150):
                        if process.poll() is not None:
                            raise RuntimeError(group+' backend failed to start')
                        try:
                            if lan.request(api, '/health').get('ok'):
                                break
                        except OSError:
                            pass
                        time.sleep(.2)
                    else:
                        raise RuntimeError(group+' backend health timeout')
                    private = directory/'room-private.json'
                    if not private.exists():
                        # Crash between room creation and credential saving must not create a second room.
                        if support.database_summary(directory/'trips.sqlite3')['counts']['rooms']:
                            raise ValueError(group+' has a room without private metadata; preserve records and inspect')
                        pin = f'{secrets.randbelow(10000):04d}'
                        room = lan.request(api, '/rooms', {'startDate': cfg['dates'][0], 'endDate': cfg['dates'][1],
                            'memberNames': [f'{lan.CODES[group]}-{n:02d}' for n in (1,2,3)], 'ownerPin': pin, 'dataset': 'osaka_review_150'})
                        support.write_json(private, {'room': room, 'participant1Pin': pin})
                    room = support.read_json(private)['room']
                    invite = '/join/?'+urlencode({'room': room['roomId'], 'k': room['inviteToken']})
                    entry = cloud_entry(group, cfg, invite)
                    origin = f'http://127.0.0.1:{local}'
                    server = lan.LanServer(('127.0.0.1', local), partial(lan.Gateway, web_root=web, entry=entry, origin=origin, api_port=api))
                    server.daemon_threads = True
                    servers.append(server)
                    threading.Thread(target=server.serve_forever, daemon=True).start()
                    config['upstreams'][group] = origin
                    config['rooms'][group] = room['roomId']
                    config['joins'][group] = '/entry/'
                    config['entries'][group] = entry
            public = share.SharedServer(('0.0.0.0', port), CloudGateway)
            public.daemon_threads = True
            public.config = config
            servers.append(public)
            threading.Thread(target=public.serve_forever, daemon=True).start()
            print('Experiment gateway ready; mode='+cfg['mode']+'; session='+cfg['session']+'; active='+','.join(sorted(cfg['active'])), flush=True)
            while True:
                time.sleep(1)
                if any(p.poll() is not None for p in processes):
                    raise RuntimeError('Backend exited; stopping gateway, preserving records')
        finally:
            for server in reversed(servers):
                server.shutdown()
                server.server_close()
            for process in processes:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        main()
    except KeyboardInterrupt:
        pass
    except (ValueError, OSError, RuntimeError) as error:
        raise SystemExit(str(error))
