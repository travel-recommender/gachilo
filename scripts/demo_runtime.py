"""Optional per-checkout paths; never commit .local configuration."""
import json, os, shutil
from pathlib import Path

PATH_SETTINGS = {'NODE_BINARY', 'LIMACTL', 'LIMA_HOME', 'OSRM_LIMA_LINK',
                 'OSRM_VM_NAME', 'OSRM_CONTAINER_NAME'}

def settings(root):
    path=root/'.local/demo/runtime.json'
    config=json.loads(path.read_text()) if path.is_file() else {}
    if not isinstance(config, dict):
        raise SystemExit('runtime.json은 설정 이름과 값을 가진 JSON 객체여야 합니다.')
    env = {}
    for key, value in config.items():
        # null means unset: use the normal default or an explicit environment override.
        if value is None or key in os.environ:
            continue
        if key in PATH_SETTINGS and not isinstance(value, str):
            raise SystemExit(f'runtime.json의 {key}는 문자열 또는 null이어야 합니다.')
        if isinstance(value, bool):
            env[key] = 'true' if value else 'false'
        elif isinstance(value, (str, int, float)):
            env[key] = str(value)
        else:
            raise SystemExit(f'runtime.json의 {key}에는 문자열·숫자·불리언 또는 null을 사용하세요.')
    return {**env, **os.environ}

def executable(value, name):
    candidate=str(Path(value).expanduser()) if value else name
    return shutil.which(candidate) or ''
