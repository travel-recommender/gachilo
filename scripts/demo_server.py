#!/usr/bin/env python3
"""Local rehearsal launcher. Keeps SQLite; stops only its own verified processes."""
import argparse, json, os, shutil, signal, socket, subprocess, sys, time, urllib.request
from pathlib import Path
from demo_runtime import settings, executable
ROOT=Path(__file__).resolve().parents[1]
STATE=ROOT/'.local/demo'
CONFIG=settings(ROOT)
WEB_PORT=3048; API_PORT=8048
NODE=executable(CONFIG.get('NODE_BINARY'), 'node')
ENV={**os.environ,'NODE_BINARY':NODE,'NEXT_TELEMETRY_DISABLED':'1',
 'NEXT_PUBLIC_API_BASE_URL':f'http://localhost:{API_PORT}','NEXT_PUBLIC_DATASET':os.environ.get('DEMO_DATASET','prototype_demo_36'),
 'NEXT_PUBLIC_BASE_PATH':'','NEXT_PUBLIC_GOOGLE_MAPS_API_KEY':'','SOMSOM_API_KEY':'','AI_MOCK':'',
 'JPY_TO_KRW':os.environ.get('JPY_TO_KRW','8.6253'),
 'JPY_TO_KRW_AS_OF':os.environ.get('JPY_TO_KRW_AS_OF','2026-09-30'),
 'JPY_TO_KRW_SOURCE':os.environ.get('JPY_TO_KRW_SOURCE','하나은행 2026-09-30 14:04 337회차; 100JPY=862.53KRW; https://kebhana.com/cont/mall/mall15/mall1501/index.jsp')}
ENV['PATH']=str(Path(NODE).parent)+os.pathsep+ENV.get('PATH','')
ENV['OSRM_FOOT_URL']=os.environ.get('OSRM_FOOT_URL','http://127.0.0.1:5001')
ENV['OSRM_TIMEOUT_MS']='2000'

def record(name):
 p=STATE/(name+'.json')
 return json.loads(p.read_text()) if p.exists() else None

def owned(name):
 r=record(name)
 if not r:return None
 q=subprocess.run(['ps','-ww','-p',str(r['pid']),'-o','command='],capture_output=True,text=True)
 return r if q.returncode==0 and r['marker'] in q.stdout and str(ROOT) in q.stdout else None

def occupied(port):
 with socket.socket() as s:return s.connect_ex(('127.0.0.1',port))==0

def healthy(url):
 try:
  with urllib.request.urlopen(url,timeout=2) as r:return r.status==200
 except Exception:return False

def start(name,cmd,port,url,marker):
 if owned(name):
  print(name+': 이미 실행 중');return
 if occupied(port):raise SystemExit(f'{port} 포트가 다른 실행에 사용 중입니다. 자동 종료하지 않았습니다.')
 STATE.mkdir(parents=True,exist_ok=True)
 with (STATE/(name+'.log')).open('a') as log:
  p=subprocess.Popen(cmd,cwd=ROOT,env=ENV,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 (STATE/(name+'.json')).write_text(json.dumps({'pid':p.pid,'marker':marker}))
 for _ in range(60):
  if healthy(url):print(f'{name}: 준비 완료 ({port})');return
  if p.poll() is not None:raise SystemExit(f'{name} 시작 실패: {STATE/name}.log 확인')
  time.sleep(.5)
 raise SystemExit(f'{name} 준비 시간 초과: 로그를 확인하세요. DB는 보존되었습니다.')

def stop(name):
 r=owned(name)
 if not r:print(name+': 이 실행기가 시작한 프로세스 없음');return
 try:os.killpg(r['pid'],signal.SIGTERM)
 except ProcessLookupError:pass
 port=API_PORT if name=='api' else WEB_PORT
 for _ in range(40):
  if not owned(name) and not occupied(port):break
  time.sleep(.1)
 if owned(name) or occupied(port):
  raise SystemExit(f'{name}: 종료를 확인하지 못했습니다. 상태·로그를 확인하세요. 프로세스 기록과 DB는 보존했습니다.')
 (STATE/(name+'.json')).unlink(missing_ok=True)
 print(name+': 중지 확인 (입력·결과 DB 유지)')

def api():
 cmd=[sys.executable,str(ROOT/'backend/server.py'),'--host','127.0.0.1','--port',str(API_PORT),'--origin',f'http://localhost:{WEB_PORT}','--db',str(ROOT/'.local/demo.sqlite3')]
 start('api',cmd,API_PORT,f'http://localhost:{API_PORT}/health',str(ROOT/'backend/server.py'))

def main():
 p=argparse.ArgumentParser();p.add_argument('action',choices=['start','stop','status','api-start','api-stop']);p.add_argument('--rebuild',action='store_true');args=p.parse_args()
 if args.action=='stop':stop('web');stop('api');return
 if args.action=='api-stop':stop('api');return
 if args.action=='status':
  for n,port,path in [('api',API_PORT,'health'),('web',WEB_PORT,'')]:print(f'{n}: '+('응답 정상' if healthy(f'http://localhost:{port}/{path}') else '응답 없음'))
  print('OSRM: '+('포트 열림 (경로 정상 여부는 별도 확인)' if occupied(5001) else '중지 — 직선거리 추정으로 대체'))
  return
 if sys.version_info<(3,10):raise SystemExit('Python 3.10 이상이 필요합니다.')
 # api-start also loads Engine(), which requires Node 24 to load and calculate the catalogue.
 if not NODE:raise SystemExit('Node.js 24 이상을 PATH에 설치하거나 NODE_BINARY를 지정하세요.')
 v=subprocess.check_output([NODE,'-p','process.versions.node'],text=True).strip()
 if int(v.split('.')[0])<24:raise SystemExit('Node.js 24 이상이 필요합니다: '+v)
 if args.action=='api-start':api();return
 build_config={k:ENV[k] for k in ('NEXT_PUBLIC_API_BASE_URL','NEXT_PUBLIC_DATASET','NEXT_PUBLIC_BASE_PATH','NEXT_PUBLIC_GOOGLE_MAPS_API_KEY')}
 STATE.mkdir(parents=True,exist_ok=True)
 stamp=STATE/'build.json'
 previous=json.loads(stamp.read_text()) if stamp.exists() else None
 if args.rebuild or previous!=build_config or not (ROOT/'web/out/index.html').exists():
  if owned('web'):raise SystemExit('재빌드 전에 stop을 실행하세요.')
  if not (ROOT/'web/node_modules/next').exists():raise SystemExit('먼저 web에서 npm ci를 실행하세요.')
  subprocess.run([NODE,str(ROOT/'web/node_modules/next/dist/bin/next'),'build'],cwd=ROOT/'web',env=ENV,check=True)
  stamp.write_text(json.dumps(build_config))
 api()
 directory=str(ROOT/'web/out')
 start('web',[sys.executable,'-m','http.server',str(WEB_PORT),'--bind','127.0.0.1','--directory',directory],WEB_PORT,f'http://localhost:{WEB_PORT}/',directory)
 print(f'크롬에서 http://localhost:{WEB_PORT}/ 접속 · 종료: python3 scripts/demo_server.py stop')
 print(f"장소 모드: {ENV['NEXT_PUBLIC_DATASET']}")
 print('환율은 시연용 고정값입니다. 기본 실행은 구글지도·유료AI 키를 사용하지 않습니다.')
if __name__=='__main__':main()
