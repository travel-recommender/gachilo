#!/usr/bin/env python3
"""Control an existing Lima OSRM VM; never create a VM or replace unrelated paths."""
import argparse, json, os, subprocess, tempfile
from pathlib import Path
from demo_runtime import settings, executable
ROOT=Path(__file__).resolve().parents[1]

def lima_home(vm, link, action):
    if link is None:return vm
    if link.is_symlink():
        # An unrelated or dangling link is never repointed silently.
        if not link.exists() or not link.samefile(vm):
            raise SystemExit('OSRM 링크가 깨졌거나 다른 폴더를 가리킵니다. LIMA_HOME/OSRM_LIMA_LINK를 확인하세요. 변경하지 않았습니다.')
    elif link.exists():
        raise SystemExit('OSRM 링크 위치에 다른 파일/폴더가 있습니다. 변경하지 않았습니다.')
    elif action=='start':
        link.symlink_to(vm,target_is_directory=True)
    else:
        raise SystemExit('OSRM 임시 링크가 없습니다. 설정을 확인한 뒤 start로 복구하세요. 조회/중지는 링크를 생성하지 않습니다.')
    return link


CONTROL_KEYS = {'LIMACTL', 'LIMA_HOME', 'OSRM_LIMA_LINK', 'OSRM_VM_NAME'}
REQUIRED_TARGET = {'LIMACTL', 'LIMA_HOME', 'OSRM_VM_NAME'}

def recovery_hint(root):
    return (f'실행 기록 {root/".local/demo/osrm.json"}을 확인하세요. '
            '이동·변경한 대상을 사용하려면 LIMACTL·LIMA_HOME·OSRM_VM_NAME을 모두 환경변수로 명시하세요. '
            '세 값이 모두 있으면 기록 대신 사용하며, 짧은 링크가 필요하면 OSRM_LIMA_LINK도 지정하세요.')

def control_settings(root):
    # A complete explicit target is a deliberate recovery override, not a partial retarget.
    if all(os.environ.get(k,'').strip() for k in REQUIRED_TARGET):
        return {k:os.environ[k] for k in CONTROL_KEYS if k in os.environ}
    record=root/'.local/demo/osrm.json'
    if record.exists():
        try:
            config=json.loads(record.read_text())
            if (not isinstance(config,dict) or set(config)!=CONTROL_KEYS
                or any(not isinstance(config[k],str) or not config[k] for k in REQUIRED_TARGET)
                or config['OSRM_LIMA_LINK'] is not None and not isinstance(config['OSRM_LIMA_LINK'],str)):
                raise ValueError('invalid OSRM target')
            return config
        except (OSError,ValueError,UnicodeError):
            raise SystemExit(f'OSRM 실행 기록을 읽지 못했습니다. {recovery_hint(root)} 다른 VM을 추측해서 조작하지 않았습니다.') from None
    try:
        # Older launches have no record. Ignore settings unrelated to stop/status.
        return settings(root,only=CONTROL_KEYS)
    except SystemExit as error:
        # Malformed JSON cannot reveal a custom target: require an explicit one instead of guessing.
        raise SystemExit(f'{error} {recovery_hint(root)}') from None

def remember_target(root,tool,vm,link,name):
    directory=root/'.local/demo';directory.mkdir(parents=True,exist_ok=True)
    config={'LIMACTL':tool,'LIMA_HOME':str(vm),'OSRM_LIMA_LINK':str(link) if link else None,'OSRM_VM_NAME':name}
    temporary=None
    try:
        with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',dir=directory,delete=False) as file:
            temporary=Path(file.name);json.dump(config,file,ensure_ascii=False)
        temporary.replace(directory/'osrm.json')
    except OSError:
        raise SystemExit('OSRM 실행 기록을 저장하지 못해 시작하지 않았습니다. .local/demo의 쓰기 권한을 확인하세요.') from None
    finally:
        if temporary is not None:temporary.unlink(missing_ok=True)

def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['start','stop','status']);a=p.parse_args()
    config=settings(ROOT,only=CONTROL_KEYS|{'OSRM_CONTAINER_NAME'}) if a.action=='start' else control_settings(ROOT)
    tool=executable(config.get('LIMACTL'),'limactl')
    vm=Path(config.get('LIMA_HOME',str(Path.home()/'.lima'))).expanduser().resolve()
    name=config.get('OSRM_VM_NAME','gachilo-osrm')
    container=config.get('OSRM_CONTAINER_NAME','gachilo-osrm-foot')
    if not tool or not (vm/name/'lima.yaml').is_file():
        raise SystemExit(f'준비된 OSRM VM 또는 limactl을 찾지 못했습니다. {recovery_hint(ROOT)} 새 VM은 만들지 않았으며 추정 경로로 실행할 수 있습니다.')
    raw=config.get('OSRM_LIMA_LINK')
    link=Path(raw).expanduser().absolute() if raw else None
    home=lima_home(vm,link,a.action)
    env={**os.environ,'LIMA_HOME':str(home)}
    try:
        if a.action=='start':
            # Record the checked existing target before starting, including partial-start failures.
            remember_target(ROOT,tool,vm,link,name)
            subprocess.run([tool,'start','--tty=false',name],env=env,check=True)
            subprocess.run([tool,'shell','--workdir=/mnt/osrm-data',name,'nerdctl','start',container],env=env,check=True)
        else:
            subprocess.run([tool,'list' if a.action=='status' else 'stop',name],env=env,check=True)
    except (subprocess.CalledProcessError,OSError) as error:
        raise SystemExit(f'OSRM {a.action} 실행을 확인하지 못했습니다. VM 상태와 설정을 확인하세요. ({type(error).__name__})') from None
if __name__=='__main__':main()
