#!/usr/bin/env python3
"""Start the already prepared capstone OSRM VM; never create a new VM."""
import argparse,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
HOME=Path(os.environ.get('CAPSTONE_HOME',str(ROOT.parents[1])))
VM=HOME/'runtime/lima'; LINK=Path('/private/tmp/gachilo-osrm-lima')
TOOL=HOME/'workspace/outputs/osrm-live-20261013/runtime/lima/bin/limactl'
def main():
 p=argparse.ArgumentParser();p.add_argument('action',choices=['start','stop','status']);a=p.parse_args()
 if not (VM/'gachilo-osrm/lima.yaml').is_file() or not TOOL.is_file():
  raise SystemExit('준비된 OSRM VM이 없습니다. 새 VM은 만들지 않았습니다. 서버는 추정 경로로 실행할 수 있습니다.')
 if LINK.is_symlink() and (not LINK.exists() or not LINK.samefile(VM)):raise SystemExit('OSRM 임시 링크가 다른 곳을 가리킵니다. 자동 변경하지 않았습니다.')
 if LINK.exists() and not LINK.is_symlink():raise SystemExit('OSRM 임시 경로가 일반 폴더입니다. 기존 실행 여부를 확인해야 합니다. 새 VM은 만들지 않았습니다.')
 if not LINK.is_symlink():LINK.symlink_to(VM,target_is_directory=True)
 env={**os.environ,'LIMA_HOME':str(LINK)}
 if a.action=='start':
  subprocess.run([str(TOOL),'start','--tty=false','gachilo-osrm'],env=env,check=True)
  subprocess.run([str(TOOL),'shell','--workdir=/mnt/osrm-data','gachilo-osrm','nerdctl','start','gachilo-osrm-foot'],env=env,check=True)
 else:subprocess.run([str(TOOL),'list' if a.action=='status' else 'stop','gachilo-osrm'],env=env,check=True)
if __name__=='__main__':main()
