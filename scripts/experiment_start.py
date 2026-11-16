"""Interactive Mac/Windows setup and start. No credentials are written or printed."""
import argparse
from datetime import datetime
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import venv

import experiment_network as network
import experiment_support as support

ROOT = Path(__file__).resolve().parents[1]
GROUPS = {'team': '윤진·혜인·조은 팀원', 'joeun': '조은 친구', 'hyein': '혜인 친구 (Mac)', 'yunjin': '윤진 친구 (Windows)'}


def choose(label, choices):
    print(label)
    keys = list(choices)
    for i, key in enumerate(keys, 1):
        print(f'{i}. {choices[key]}')
    while True:
        value = input('번호: ').strip()
        if value.isdigit() and 1 <= int(value) <= len(keys):
            return keys[int(value) - 1]


def npm_cli(node):
    binary = Path(node)
    candidates = [binary.parent / 'node_modules/npm/bin/npm-cli.js',
                  binary.parent.parent / 'lib/node_modules/npm/bin/npm-cli.js']
    installed = shutil.which('npm')
    if installed:
        candidates.append(Path(installed).resolve())
        candidates.append(Path(installed).parent / 'node_modules/npm/bin/npm-cli.js')
    for candidate in candidates:
        if candidate.name == 'npm-cli.js' and candidate.is_file():
            return candidate
    raise ValueError('npm을 찾지 못했습니다. nodejs.org에서 Node.js 24 이상을 npm과 함께 설치해 주세요.')


def python_in(environment):
    return environment / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')


def dependencies(node):
    environment = ROOT / '.venv'
    python = python_in(environment)
    if not python.is_file():
        print('이 저장소 전용 Python 환경을 준비합니다.')
        venv.EnvBuilder(with_pip=True).create(environment)
    version = subprocess.check_output([str(python), '-c', 'import sys; print(sys.version_info.major*100+sys.version_info.minor)'], text=True, encoding='utf-8').strip()
    if int(version) < 310:
        raise ValueError('기존 .venv가 Python 3.10 미만입니다. 이 저장소를 새 폴더에 Clone하고 다시 실행해 주세요.')
    requirements = ROOT / 'scripts/requirements-experiment.txt'
    dependency_stamp = environment / '.experiment-dependencies'
    wanted = hashlib.sha256(requirements.read_bytes()).hexdigest()
    if not dependency_stamp.exists() or dependency_stamp.read_text(encoding='utf-8') != wanted:
        subprocess.run([str(python), '-X', 'utf8', '-m', 'pip', 'install', '--disable-pip-version-check', '-r', str(requirements)], check=True)
        dependency_stamp.write_text(wanted, encoding='utf-8')
    stamp = ROOT / '.local/experiment-npm.sha256'
    wanted = hashlib.sha256((ROOT / 'web/package-lock.json').read_bytes()).hexdigest()
    if not (ROOT / 'web/node_modules/next/dist/bin/next').is_file() or not stamp.exists() or stamp.read_text(encoding='utf-8') != wanted:
        print('이 저장소 전용 웹 패키지를 준비합니다. 처음에는 몇 분 걸릴 수 있습니다.')
        subprocess.run([node, str(npm_cli(node)), 'ci', '--no-audit', '--no-fund'], cwd=ROOT / 'web', check=True)
        stamp.parent.mkdir(exist_ok=True)
        stamp.write_text(wanted, encoding='utf-8')
    return python


def choose_bundle(group, mode, session=None):
    if session is not None and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,49}', session):
        raise ValueError('--session은 영문·숫자·밑줄·하이픈 1~50자로 입력하세요.')
    active = ROOT / '.local/experiment-last.json'
    registry = support.read_json(active) if active.exists() else {}
    key = group + '-' + mode
    current = registry.get(key)
    if session is None and current and re.fullmatch(r'[A-Za-z0-9_-]{1,100}', current):
        previous = ROOT / '.local/experiments' / current
        if (previous / 'manifest.json').is_file():
            old = support.read_json(previous / 'manifest.json')
            if old['commit'] == support.clean_commit():
                action = choose(f'{GROUPS[group]}의 기존 방이 있습니다.', {'resume': '같은 방 이어서 실행 (입력·PIN 유지)', 'new': '새 실험방 생성 (이전 기록 보존)'})
                if action == 'resume':
                    return previous, registry, active, key
            else:
                print('이전 방은 다른 코드 버전입니다. 원본을 보관하고 새 방을 준비합니다.')
    name = f'{session or datetime.now().strftime("%Y%m%d-%H%M%S-%f")}-{key}'
    bundle = ROOT / '.local/experiments' / name
    return bundle, registry, active, key


def launch_env(mode):
    # Keep Node/OS support variables, but never inherit arbitrary debug or external-service settings.
    env = support.offline_env(ROOT / '.local', support.node_binary(os.getenv('NODE_BINARY')))
    env.pop('REAL_CATALOG_PATH', None)
    env.pop('REAL_PROFILES_PATH', None)
    if mode == 'live':
        key = os.environ.get('GOOGLE_PLACES_API_KEY', '').strip()
        if not key:
            if not sys.stdin.isatty():
                raise ValueError('실제 실험은 GOOGLE_PLACES_API_KEY가 필요합니다. 대화형 실행기에서 비공개로 입력하세요.')
            key = getpass.getpass('이 서버에서 사용할 Google Places 키 (화면/파일에 표시·저장 안 함): ').strip()
        if not key:
            raise ValueError('Places 키가 비어 있어 시작하지 않았습니다.')
        env['GOOGLE_PLACES_API_KEY'] = key
    return env


def main():
    if sys.version_info < (3, 10):
        raise ValueError('Python 3.10 이상을 설치해 주세요.')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--group', choices=GROUPS)
    parser.add_argument('--mode', choices=('rehearsal', 'live'))
    parser.add_argument('--host')
    parser.add_argument('--session', help='같은 이름은 기존 방 재시작, 새 이름은 새 실험')
    parser.add_argument('--port', type=int, default=3140)
    parser.add_argument('--api-port', type=int, default=8140)
    parser.add_argument('--check', action='store_true', help='환경 확인만, 설치/빌드/서버/유료 조회 없음')
    parser.add_argument('--no-open', action='store_true')
    args = parser.parse_args()
    commit = support.clean_commit()
    node = support.node_binary(os.getenv('NODE_BINARY'))
    npm_cli(node)
    if args.check:
        print(json.dumps({'python': sys.version.split()[0], 'node_ready': True, 'git_commit': commit,
                          'local_addresses': network.discover(), 'platform': sys.platform}, ensure_ascii=False, indent=2))
        return
    group = args.group or choose('어느 그룹을 진행하나요?', GROUPS)
    mode = args.mode or choose('실행 용도를 고르세요.', {'rehearsal': '연결 연습 (영업정보 모의 응답, 실험과 분리)', 'live': '실제 실험 (Google 조회, API 사용량 발생)'})
    host = network.choose_host(args.host)
    network.ensure_local(host)
    bundle, registry, active, key = choose_bundle(group, mode, args.session)
    env = launch_env(mode)
    python = dependencies(node)
    marker = ROOT / '.local/experiment-build.json'
    expected = {'commit': commit, 'mode': 'h4', 'api': '/backend'}
    if not marker.exists() or support.read_json(marker) != expected or not (ROOT / 'web/out/result/index.html').is_file():
        subprocess.run([str(python), '-X', 'utf8', str(ROOT / 'scripts/experiment_lan.py'), 'build', '--node', node], check=True, cwd=ROOT)
    registry[key] = bundle.name
    active.parent.mkdir(exist_ok=True)
    active.write_text(json.dumps(registry, ensure_ascii=False, indent=2), encoding='utf-8')
    active.chmod(0o600)
    command = [str(python), '-X', 'utf8', str(ROOT / 'scripts/experiment_lan.py'), 'start', '--node', node,
               '--group', group, '--mode', mode, '--host', host, '--bundle', str(bundle),
               '--port', str(args.port), '--api-port', str(args.api_port)]
    if not args.no_open:
        command.append('--open')
    print('이 창을 열어 둔 채 실험하세요. Ctrl+C로 종료합니다. 다른 노트북의 QR을 재사용하지 마세요.', flush=True)
    child = subprocess.Popen(command, cwd=ROOT, env=env)
    try:
        result = child.wait()
    except KeyboardInterrupt:
        # Ctrl+C reaches the LAN launcher too. Wait for its gateway/API cleanup,
        # otherwise a quick restart can race the still-running child.
        try:
            result = child.wait(timeout=30)
        except subprocess.TimeoutExpired:
            raise ValueError('서버가 아직 종료 중입니다. 잠시 기다린 뒤 재시작하세요.') from None
    if result:
        raise subprocess.CalledProcessError(result, command)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error))
