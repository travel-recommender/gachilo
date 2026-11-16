"""Share three isolated friend rooms from one laptop through a temporary HTTPS tunnel.

No cloud deployment, firewall change, credentials in URLs, or upload of existing DBs.
Default mode is setup: group links show a preparation notice and cannot submit data.
"""
import argparse
import html
import http.client
from http.cookies import SimpleCookie, CookieError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import queue
import re
import secrets
import signal
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit

import experiment_lan as lan
import experiment_support as support

ROOT = Path(__file__).resolve().parents[1]
GROUPS = {'joeun': ('조은 친구', 'J'), 'hyein': ('혜인 친구', 'H'), 'yunjin': ('윤진 친구', 'Y')}
COOKIE = 'gachilo_experiment_group'


def origin(value):
    u = urlsplit(value)
    local = u.scheme == 'http' and u.hostname == '127.0.0.1' and u.port
    if (not (u.scheme == 'https' or local) or not u.hostname or u.username or u.password
            or u.path not in ('', '/') or u.query or u.fragment):
        raise ValueError('공개 주소는 HTTPS origin이어야 합니다. 로컬 검사는 http://127.0.0.1:포트만 허용합니다.')
    return f'{u.scheme}://{u.netloc}'


def group_tokens(bundle):
    file = bundle / 'public-groups.json'
    if not file.exists():
        support.write_json(file, {g: secrets.token_urlsafe(24) for g in GROUPS})
    tokens = support.read_json(file)
    if set(tokens) != set(GROUPS) or len(set(tokens.values())) != 3 or any(not re.fullmatch(r'[\w-]{32}', t) for t in tokens.values()):
        raise ValueError('그룹 링크 파일이 손상되었습니다. 기존 파일과 DB를 보존하고 확인하세요.')
    return tokens


def entry_page(group, mode, join_url="/entry/"):
    title, code = GROUPS[group]
    if mode == 'setup':
        body = '<h1>'+title+'</h1><p>서버를 준비하고 있어요.</p><p>지금은 접속 확인만 가능합니다. 진행자가 시작을 안내한 뒤 다시 열어 주세요.</p>'
    else:
        rehearsal = '<p class="pill">연결 연습 · 본 실험 응답이 아닙니다</p>' if mode == 'rehearsal' else ''
        body = '<h1>'+title+'</h1>'+rehearsal+'<p>인터넷만 연결하면 됩니다. 같은 Wi-Fi일 필요는 없어요.</p><p>참가자 '+code+'-01 · '+code+'-02 · '+code+'-03</p><p>자신의 번호를 선택하고 PIN으로 입장하세요. 다른 사람과 상의하지 않고 일정을 평가해 주세요.</p><a class="button" href="'+html.escape(join_url, quote=True)+'">실험방 입장</a>'
    return lan.page(title+' 실험', body).encode()


class SharedGateway(BaseHTTPRequestHandler):
    # Only this app's gateway is exposed. Every group has a separate upstream/SQLite.
    def log_message(self, *_):
        pass

    def setup(self):
        super().setup()
        self.connection.settimeout(20)

    def respond(self, status, body=b'', kind='text/html; charset=utf-8', headers=()):
        self.send_response(status)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Robots-Tag', 'noindex, nofollow, noarchive')
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def route(self):
        cfg = self.server.config
        if self.headers.get('Host') != urlsplit(cfg['origin']).netloc or self.headers.get('Origin') not in (None, cfg['origin']):
            return self.respond(403)
        parsed = urlsplit(self.path)
        if parsed.scheme or parsed.netloc or '%' in parsed.path or '..' in parsed.path or '\\' in parsed.path:
            return self.respond(400)
        if parsed.path == '/healthz' and self.command == 'GET':
            return self.respond(200, b'{"ok":true}', 'application/json')
        entry = re.fullmatch(r'/g/(joeun|hyein|yunjin)/([\w-]+)/?', parsed.path)
        if entry and self.command in ('GET', 'HEAD'):
            group, token = entry.groups()
            if not secrets.compare_digest(token, cfg['tokens'][group]):
                return self.respond(404)
            secure = '; Secure' if cfg['origin'].startswith('https:') else ''
            cookie = f'{COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax'+secure
            if cfg['mode'] == 'setup':
                return self.respond(200, entry_page(group, 'setup'), headers=[('Set-Cookie', cookie)])
            # Go straight to this room's existing participant/PIN selector.
            return self.respond(303, headers=[('Set-Cookie', cookie), ('Location', cfg['joins'][group])])
        try:
            cookies = SimpleCookie(self.headers.get('Cookie', ''))
            gate = cookies[COOKIE].value if COOKIE in cookies else ''
        except CookieError:
            gate = ''
        if not re.fullmatch(r'[A-Za-z0-9_-]{32}', gate):
            gate = ''
        group = next((g for g,t in cfg['tokens'].items() if secrets.compare_digest(gate, t)), None)
        if group is None:
            return self.respond(403, lan.page('실험 초대 링크', '<h1>전달받은 그룹 링크로 들어와 주세요.</h1>').encode())
        if cfg['mode'] == 'setup':
            return self.respond(503, entry_page(group, 'setup'))
        if parsed.path.rstrip('/') == '/entry' and self.command in ('GET', 'HEAD'):
            return self.respond(200, entry_page(group, cfg['mode'], cfg['joins'][group]))
        # A cookie from another group cannot access this group's room, even with a copied URL.
        api = re.fullmatch(r'/backend/rooms/([\w-]+)(?:/.*)?', parsed.path)
        if api and api[1] != cfg['rooms'][group]:
            return self.respond(403)
        if parsed.path.rstrip('/') == '/backend/rooms':
            return self.respond(409)
        # Results are generated by the server; public clients cannot upload/replace them.
        if self.command != 'GET' and re.fullmatch(r'/backend/rooms/[\w-]+/(results|selection)', parsed.path):
            return self.respond(409)
        if self.command not in ('GET', 'HEAD', 'POST', 'PUT', 'OPTIONS'):
            return self.respond(405)
        if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) > 1:
            return self.respond(400)
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            return self.respond(400)
        if not 0 <= length <= 65536:
            return self.respond(413)
        body = self.rfile.read(length) if length else None
        target = urlsplit(cfg['upstreams'][group])
        headers = {'Host': target.netloc, 'Origin': cfg['upstreams'][group]}
        for name in ('Content-Type', 'Authorization'):
            if self.headers.get(name):
                headers[name] = self.headers[name]
        connection = http.client.HTTPConnection('127.0.0.1', target.port, timeout=180)
        try:
            connection.request(self.command, self.path, body, headers)
            response = connection.getresponse()
            data = response.read()
            forwarded = []
            location = response.getheader('Location')
            if location and location.startswith('/') and not location.startswith('//'):
                forwarded.append(('Location', location))
            self.respond(response.status, data, response.getheader('Content-Type', 'application/octet-stream'), forwarded)
        except (OSError, http.client.HTTPException):
            self.respond(502, lan.page('연결 확인', '<h1>서버 연결을 확인하고 있어요.</h1><p>새 번호를 만들지 말고 잠시 후 다시 접속해 주세요.</p>').encode())
        finally:
            connection.close()

    do_GET = route
    do_HEAD = route
    do_POST = route
    do_PUT = route
    do_OPTIONS = route


class SharedServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def stop(child):
    if child and child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=20)
        except subprocess.TimeoutExpired:
            raise RuntimeError('자식 서버 종료를 확인하지 못했습니다. 기존 프로세스를 확인하세요.') from None


def quick_tunnel(binary, port):
    child = subprocess.Popen([binary, 'tunnel', '--no-autoupdate', '--url', f'http://127.0.0.1:{port}'],
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8')
    events = queue.Queue()
    def read():
        for line in child.stdout:
            hit = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', line)
            if hit:
                events.put(hit[0])
        events.put(None)
    threading.Thread(target=read, daemon=True).start()
    try:
        url = events.get(timeout=45)
        if not url:
            raise ValueError('외부 접속 주소를 만들지 못했습니다. 인터넷 연결을 확인하세요.')
        return child, url
    except BaseException:
        stop(child)
        raise


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--bundle', type=Path)
    p.add_argument('--build', action='store_true', help='Build current committed experiment with the public browser Maps key')
    p.add_argument('--mode', choices=('setup', 'rehearsal', 'live'), default='setup')
    p.add_argument('--node', default=os.getenv('NODE_BINARY', 'node'))
    p.add_argument('--port', type=int, default=3180)
    p.add_argument('--lan-port', type=int, default=3184)
    p.add_argument('--api-port', type=int, default=8184)
    p.add_argument('--origin', help='Existing HTTPS origin, or loopback origin for offline QA')
    p.add_argument('--cloudflared', default='cloudflared')
    p.add_argument('--start', default='2026-11-16')
    p.add_argument('--end', default='2026-11-19')
    a = p.parse_args()
    if a.build:
        if not os.getenv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', '').strip():
            raise ValueError('지도 표시용 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY를 빌드 환경에 설정하세요. 서버 Places 키와 구분합니다.')
        lan.build(support.node_binary(a.node))
        lan.save_private(ROOT/'.local/public-map-build.json', {'commit': support.clean_commit(), 'mapKeyConfigured': True})
        return
    if not a.bundle:
        raise ValueError('--bundle 경로를 지정하세요.')
    for port in (a.port, a.lan_port, a.api_port):
        if not 1024 <= port <= 65532:
            raise ValueError('포트 범위는 1024~65532입니다.')
    lan.probe_port('127.0.0.1', a.port)
    bundle = a.bundle.resolve()
    bundle.mkdir(parents=True, exist_ok=True, mode=0o700)
    tokens = group_tokens(bundle)
    child = tunnel = server = None
    config = {'mode': a.mode, 'tokens': tokens, 'upstreams': {}, 'joins': {}, 'rooms': {}}
    try:
        if a.mode != 'setup':
            node = support.node_binary(a.node)
            if a.mode == 'live':
                required = ['GOOGLE_PLACES_API_KEY', 'SOMSOM_API_KEY']
                missing = [k for k in required if not os.getenv(k)]
                if missing:
                    raise ValueError('실제 실험에 필요한 서버 설정이 없습니다: '+', '.join(missing))
                if not (ROOT/'.local/public-map-build.json').exists() or support.read_json(ROOT/'.local/public-map-build.json').get('commit') != support.clean_commit():
                    raise ValueError('현재 코드의 지도 키 포함 빌드를 확인한 뒤 실제 실험을 시작하세요.')
            # Keep existing export/backup format and one DB per group. Do not reuse the team room.
            session = bundle / ('session-'+a.mode)
            command = [sys.executable, '-X', 'utf8', str(ROOT/'scripts/experiment_lan.py'), 'start', '--loopback', '--group', 'friends',
                       '--mode', a.mode, '--bundle', str(session), '--node', node, '--port', str(a.lan_port), '--api-port', str(a.api_port),
                       '--start', a.start, '--end', a.end]
            child = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            for _ in range(150):
                if child.poll() is not None:
                    raise RuntimeError('그룹 서버 시작 실패. 날짜·빌드·설정을 확인하세요.')
                try:
                    rows = support.read_json(session/'qr-share/links.json')
                    for row in rows:
                        group = row['group']
                        config['upstreams'][group] = row['url'].removesuffix('/entry/')
                        state = support.read_json(session/'groups'/group/'room-private.json')['room']
                        config['rooms'][group] = state['roomId']
                        config['joins'][group] = '/join/?'+lan.urlencode({'room': state['roomId'], 'k': state['inviteToken']})
                    if set(config['upstreams']) == set(GROUPS):
                        for g in GROUPS:
                            lan.request(urlsplit(config['upstreams'][g]).port, '/backend/health')
                        break
                except (OSError, ValueError, KeyError):
                    pass
                time.sleep(.2)
            else:
                raise RuntimeError('그룹 서버 시작 대기 시간을 초과했습니다.')
        if a.origin:
            config['origin'] = origin(a.origin)
        else:
            tunnel, value = quick_tunnel(a.cloudflared, a.port)
            config['origin'] = origin(value)
        server = SharedServer(('127.0.0.1', a.port), SharedGateway)
        server.config = config
        threading.Thread(target=server.serve_forever, daemon=True).start()
        links = {g: config['origin']+'/g/'+g+'/'+t+'/' for g,t in tokens.items()}
        support.write_private_text(bundle/'share-links.json', json.dumps({'mode': a.mode, 'links': links}, ensure_ascii=False, indent=2))
        text = ['가치로 친구 실험 링크', '상태: '+a.mode, '조은 노트북과 인터넷 연결을 유지하세요. 중지 후 다시 켜면 인터넷 주소가 바뀔 수 있습니다.']
        for g,url in links.items():
            text += [GROUPS[g][0]+': '+url]
        support.write_private_text(bundle/'친구에게_보낼_링크.txt', '\n'.join(text)+'\n')
        print('그룹 링크 저장: '+str(bundle/'친구에게_보낼_링크.txt'), flush=True)
        print('모드: '+a.mode+' / 종료: Ctrl+C / 노트북을 닫지 마세요.', flush=True)
        while True:
            time.sleep(1)
            if any(p and p.poll() is not None for p in (child,tunnel)):
                raise RuntimeError('서버 또는 외부 연결 종료. 기록은 보존되며 링크를 다시 확인해야 합니다.')
    except KeyboardInterrupt:
        pass
    finally:
        if server:
            server.shutdown()
            server.server_close()
        stop(tunnel)
        stop(child)


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        main()
    except (OSError, ValueError, RuntimeError, queue.Empty) as error:
        raise SystemExit(str(error) or '외부 연결 준비 시간이 초과되었습니다.')
