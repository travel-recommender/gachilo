#!/usr/bin/env python3
"""Control an existing Lima OSRM VM; never create a VM or replace unrelated paths."""
import argparse, os, subprocess
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

def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['start','stop','status']);a=p.parse_args()
    config=settings(ROOT)
    tool=executable(config.get('LIMACTL'),'limactl')
    vm=Path(config.get('LIMA_HOME',str(Path.home()/'.lima'))).expanduser().resolve()
    name=config.get('OSRM_VM_NAME','gachilo-osrm')
    container=config.get('OSRM_CONTAINER_NAME','gachilo-osrm-foot')
    if not tool or not (vm/name/'lima.yaml').is_file():
        raise SystemExit('준비된 OSRM VM 또는 limactl을 찾지 못했습니다. LIMACTL/LIMA_HOME을 지정하세요. 새 VM은 만들지 않았으며 추정 경로로 실행할 수 있습니다.')
    raw=config.get('OSRM_LIMA_LINK')
    link=Path(raw).expanduser().absolute() if raw else None
    home=lima_home(vm,link,a.action)
    env={**os.environ,'LIMA_HOME':str(home)}
    if a.action=='start':
        subprocess.run([tool,'start','--tty=false',name],env=env,check=True)
        subprocess.run([tool,'shell','--workdir=/mnt/osrm-data',name,'nerdctl','start',container],env=env,check=True)
    else:
        subprocess.run([tool,'list' if a.action=='status' else 'stop',name],env=env,check=True)
if __name__=='__main__':main()
