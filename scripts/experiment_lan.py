"""Build/start isolated H4 LAN rooms. Use --mode rehearsal for offline QA; live requires a Places key."""
import argparse,html,http.client,ipaddress,json,os,secrets,signal,socket,subprocess,sys,threading,time,urllib.request,shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlencode,urlsplit,unquote
from reportlab.graphics.barcode.qrencoder import QRCode,QRErrorCorrectLevel
from PIL import Image,ImageDraw
import experiment_support as support
ROOT=Path(__file__).resolve().parents[1]
SURVEY_URL='https://docs.google.com/forms/d/e/1FAIpQLScOde1GqSlhf7F29K-rBKrb3qkI-TRqd7IWgwDlIw8Go4F7aQ/viewform'
CODES={'team':'T','joeun':'J','hyein':'H','yunjin':'Y'}
GROUPS=[('team','윤진·조은·혜인'),('joeun','조은 친구'),('hyein','혜인 친구'),('yunjin','윤진 친구')]
def request(port,path,body=None):
    req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=30) as response:return json.load(response)

def save_private(path,value):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');path.chmod(0o600)

def qr_image(value,path):
    code=QRCode(None,QRErrorCorrectLevel.M);code.addData(value);code.make()
    count=code.getModuleCount();scale=12;quiet=4
    image=Image.new('RGB',((count+quiet*2)*scale,)*2,'white');draw=ImageDraw.Draw(image)
    for row in range(count):
        for col in range(count):
            if code.modules[row][col]:draw.rectangle(((col+quiet)*scale,(row+quiet)*scale,(col+quiet+1)*scale-1,(row+quiet+1)*scale-1),fill='black')
    image.save(path)

STYLE='''*{box-sizing:border-box}body{margin:0;background:#f6f1f3;color:#252029;font-family:Pretendard,-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif}main{max-width:1000px;margin:auto;padding:32px}h1{font-size:32px;margin:10px 0}p{line-height:1.7}.eyebrow{color:#942847;font-weight:750;letter-spacing:2px;font-size:13px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:28px 0}.card{background:white;border-radius:22px;padding:25px;text-align:center;border-top:6px solid #942847}.card h2{font-size:26px;margin:8px 0}.sub{color:#6a6268;font-size:14px}.card img{display:block;width:244px;height:244px;margin:14px auto;image-rendering:pixelated}.url{font-size:14px;word-break:break-all;color:#692139}.pill{display:inline-block;background:#f8e9c9;border-radius:20px;padding:5px 12px;color:#704c10;font-size:13px}.button{display:block;border-radius:12px;background:#942847;color:white;text-decoration:none;padding:16px;font-weight:700;margin-top:24px}.notice{background:white;border-radius:16px;padding:20px;font-size:15px}@media(max-width:620px){main{padding:20px}.grid{grid-template-columns:1fr}h1{font-size:27px}}@media print{body{background:white}main{padding:10px}.grid{gap:12px}.card{break-inside:avoid;border:1px solid #bbb;border-top:5px solid #942847}.notice{padding:8px}}'''

def page(title,content):return '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+html.escape(title)+'</title><style>'+STYLE+'</style><main>'+content+'</main></html>'

class Gateway(SimpleHTTPRequestHandler):
    def __init__(self,*args,web_root,entry,origin,api_port,**kwargs):
        self.web_root=Path(web_root).resolve();self.entry=entry;self.origin=origin;self.api_port=api_port
        super().__init__(*args,directory=str(self.web_root),**kwargs)
    def log_message(self,*_):pass  # Never log invite query strings or tokens.
    def end_headers(self):
        self.send_header('Cache-Control','no-store');self.send_header('Referrer-Policy','no-referrer');self.send_header('X-Content-Type-Options','nosniff');super().end_headers()
    def list_directory(self,path):self.send_error(404);return None
    def valid(self):
        if self.headers.get('Host') != urlsplit(self.origin).netloc or self.headers.get('Origin') not in (None,self.origin):self.send_error(403);return False
        return True
    def route(self):
        if not self.valid():return
        parsed=urlsplit(self.path)
        if parsed.scheme or parsed.netloc:self.send_error(400);return
        if parsed.path.startswith('/backend/'):
            if self.headers.get('Transfer-Encoding'):self.send_error(400);return
            try:length=int(self.headers.get('Content-Length','0'))
            except ValueError:self.send_error(400);return
            if not 0<=length<=1024*1024:self.send_error(413);return
            body=self.rfile.read(length) if length else None
            conn=http.client.HTTPConnection('127.0.0.1',self.api_port,timeout=180)
            headers={'Origin':f'http://localhost:{urlsplit(self.origin).port}'}
            for name in ('Content-Type','Authorization'):
                if self.headers.get(name):headers[name]=self.headers[name]
            try:
                conn.request(self.command,self.path[len('/backend'):],body=body,headers=headers)
                response=conn.getresponse();data=response.read()
                self.send_response(response.status);self.send_header('Content-Type',response.getheader('Content-Type','application/json'));self.send_header('Content-Length',str(len(data)));self.end_headers()
                if self.command!='HEAD':self.wfile.write(data)
            except (OSError,http.client.HTTPException):self.send_error(502,'Local API unavailable')
            finally:conn.close()
            return
        if self.command not in ('GET','HEAD'):self.send_error(405);return
        if parsed.path=='/entry/':
            data=self.entry.encode();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers()
            if self.command!='HEAD':self.wfile.write(data)
            return
        path=(self.web_root/unquote(parsed.path).lstrip('/')).resolve()
        if not path.is_relative_to(self.web_root) or any(part.startswith('.') for part in path.relative_to(self.web_root).parts):self.send_error(404);return
        if self.command=='HEAD':super().do_HEAD()
        else:super().do_GET()
    do_GET=route;do_HEAD=route;do_POST=route;do_PUT=route;do_OPTIONS=route

def build(node):
    commit=support.clean_commit()
    env=os.environ.copy();env.update({'NEXT_PUBLIC_EXPERIMENT_MODE':'1','NEXT_PUBLIC_API_BASE_URL':'/backend','NEXT_PUBLIC_BASE_PATH':'','NEXT_TELEMETRY_DISABLED':'1'})
    subprocess.run([node,str(ROOT/'web/node_modules/next/dist/bin/next'),'build'],cwd=ROOT/'web',env=env,check=True)
    # Persist the expected code/build identity; never serve a previous non-experiment export.
    save_private(ROOT/'.local/experiment-build.json',{'commit':commit,'mode':'h4','api':'/backend'})

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('command',choices=['build','start']);p.add_argument('--node',default=os.getenv('NODE_BINARY','node'));p.add_argument('--host');p.add_argument('--group',choices=['all']+[x[0] for x in GROUPS],default='all');p.add_argument('--mode',choices=['rehearsal','live'],default='rehearsal');p.add_argument('--bundle',type=Path);p.add_argument('--start',default='2026-11-16');p.add_argument('--end',default='2026-11-19');p.add_argument('--port',type=int,default=3140);p.add_argument('--api-port',type=int,default=8140)
    a=p.parse_args();node=support.node_binary(a.node)
    if a.command=='build':build(node);return
    ip=ipaddress.ip_address(a.host or '')
    if ip.version!=4 or not any(ip in ipaddress.ip_network(x) for x in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16')):raise ValueError('--host에 현재 노트북의 Wi-Fi 사설 IPv4 주소를 넣으세요.')
    if (support.date.fromisoformat(a.end)-support.date.fromisoformat(a.start)).days!=3:raise ValueError('가상 여행은 4일로 고정합니다.')
    for port in (a.port,a.api_port):
        if not 1024<=port<=65532:raise ValueError('포트 범위는 1024~65532입니다.')
    if a.mode=='live' and not os.getenv('GOOGLE_PLACES_API_KEY'):raise ValueError('실제 실험 시작 전 GOOGLE_PLACES_API_KEY를 서버 환경변수로 설정하세요. 키를 Git에 올리지 마세요. rehearsal은 별도 모의 점검입니다.')
    if a.mode=='live' and (os.getenv('LIVE_CHECK_MOCK') or os.getenv('AI_MOCK')):raise ValueError('실제 실험에서 MOCK 설정을 사용할 수 없습니다.')
    commit=support.clean_commit();marker=ROOT/'.local/experiment-build.json'
    if not marker.exists() or json.loads(marker.read_text())!={'commit':commit,'mode':'h4','api':'/backend'}:raise ValueError('현재 커밋에서 먼저 build를 실행하세요.')
    web=ROOT/'web/out'
    if not (web/'result/index.html').is_file():raise ValueError('실험 화면 빌드가 없습니다.')
    bundle=(a.bundle or ROOT/'.local'/('experiment-'+a.mode)).resolve()
    fresh_bundle=not bundle.exists()
    if fresh_bundle:support.prepare(bundle)
    manifest=support.verify(bundle,code=True)
    config={'commit':commit,'mode':a.mode,'travelDates':[a.start,a.end],'rate':'8.6253','rateDate':'2026-09-30','recommendationCards':'disabled_in_experiment','survey':'google_form','surveyUrl':SURVEY_URL,'groupSize':3,
            'osrm':bool(os.getenv('OSRM_FOOT_URL')) if a.mode=='live' else False,'ai':bool(os.getenv('SOMSOM_API_KEY')) if a.mode=='live' else False}
    expected={'purpose':'h4_user_experiment' if a.mode=='live' else 'local_h4_rehearsal','travel_dates':[a.start,a.end],'recommendation_card_policy':'disabled_in_experiment'}
    if fresh_bundle:save_private(bundle/'manifest.json',{**manifest,**expected})
    elif any(manifest.get(k)!=v for k,v in expected.items()):raise ValueError('기존 묶음의 날짜·실험 정책이 다릅니다. 새 --bundle 경로를 사용하세요.')
    config_file=bundle/'experiment-config.json'
    if config_file.exists() and json.loads(config_file.read_text())!=config:raise ValueError('기존 실험과 설정이 다릅니다. 새 --bundle 경로로 준비하세요.')
    if not config_file.exists():save_private(config_file,config)
    selected=[(i,g) for i,g in enumerate(GROUPS) if a.group in ('all',g[0])]
    # Claim ports before spawning, never stop unrelated servers.
    for i,_ in selected:
        for host,port in [(str(ip),a.port+i),('127.0.0.1',a.api_port+i)]:
            with socket.socket() as sock:sock.bind((host,port))
    out=bundle/'qr-share';out.mkdir(exist_ok=True);processes=[];servers=[];cards=[];metadata=[];locks=[]
    try:
        for i,(key,title) in selected:
            g=support.group_dir(bundle,key);g.mkdir(parents=True,exist_ok=True,mode=0o700)
            lock=support.group_lock(g);lock.__enter__();locks.append(lock)
            api=a.api_port+i;port=a.port+i;origin=f'http://{ip}:{port}'
            env=support.offline_env(bundle,node);env.update({'EXPERIMENT_SERVER':'1','JPY_TO_KRW':config['rate'],'JPY_TO_KRW_AS_OF':config['rateDate'],'JPY_TO_KRW_SOURCE':'하나은행 2026-09-30 실험 고정 환율; 현재 환율 아님'})
            if a.mode=='rehearsal':env['LIVE_CHECK_MOCK']='pass'
            else:
                for name in ('GOOGLE_PLACES_API_KEY','SOMSOM_API_KEY','SOMSOM_BASE_URL','SOMSOM_MODEL','OSRM_FOOT_URL'):
                    if name in os.environ:env[name]=os.environ[name]
            # Keep the established backup/restore tool's group configuration.
            if not (g/'rehearsal.json').exists():save_private(g/'rehearsal.json',{'experiment':config,'group':key})
            logfile=g/'server.log'
            with logfile.open('a') as log:
                child=subprocess.Popen([sys.executable,str(ROOT/'backend/server.py'),'--db',str(g/'trips.sqlite3'),'--host','127.0.0.1','--port',str(api),'--origin',f'http://localhost:{port}'],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
                # Do not print request tokens; backend logs no request URLs.
            processes.append(child)
            for _ in range(150):
                if child.poll() is not None:raise RuntimeError(title+' API 시작 실패')
                try:
                    if request(api,'/health')['ok']:break
                except OSError:pass
                time.sleep(.2)
            else:raise RuntimeError(title+' API 대기 시간 초과')
            private=g/'room-private.json'
            if private.exists():state=json.loads(private.read_text())
            else:
                pin=f'{secrets.randbelow(10000):04d}'
                room=request(api,'/rooms',{'startDate':a.start,'endDate':a.end,'memberNames':[f'{CODES[key]}-{n:02d}' for n in (1,2,3)],'ownerPin':pin,'dataset':'osaka_review_150'})
                state={'room':room,'participant1Pin':pin};save_private(private,state)
            room=state['room'];invite='/join/?'+urlencode({'room':room['roomId'],'k':room['inviteToken']})
            label='모의 점검 · 응답은 본 실험에 사용하지 않음' if a.mode=='rehearsal' else 'H4 실험 · 진행자 안내 후 시작'
            notice='운영정보 조회는 모의 응답입니다. 실제 Google 확인이 아닙니다.' if a.mode=='rehearsal' else '여행 입력·일정은 로컬 서버에, 설문 응답은 혜인님의 Google 설문에 저장됩니다. 진행자의 안내 후 시작해 주세요.'
            entry=page(title+' 실험','<div class="eyebrow">GACHILO · EXPERIMENT</div><h1>'+title+'</h1><span class="pill">'+label+'</span><p>가상 오사카 여행: '+a.start+' ~ '+a.end+' (4일)<br>같은 그룹의 서버 노트북과 같은 Wi-Fi · 각자 휴대폰 · 그룹 3명</p><div class="notice">'+notice+'<br><br>① 진행자가 준 본인 번호로 입장하고 PIN을 기억하세요.<br>② 장소 6곳 이상 → 꼭 가기 5곳 → 예산·체력 입력<br>③ 일정 A·B·C를 모두 살펴보고 혜인님의 Google 설문 작성<br><br>다른 사람과 상의하지 말고 평가해 주세요. 방장이 확정하지 않습니다. 01번은 진행자가 전달한 PIN으로 다시 들어갑니다. 번호를 추가하지 마세요. 아이폰 Safari / 안드로이드 Chrome 공통입니다.</div><a class="button" href="'+html.escape(invite,quote=True)+'">실험방 입장</a><p><a href="'+SURVEY_URL+'" target="_blank" rel="noopener noreferrer">혜인님 Google 설문</a></p>')
            server=ThreadingHTTPServer((str(ip),port),partial(Gateway,web_root=web,entry=entry,origin=origin,api_port=api));server.daemon_threads=True;servers.append(server);threading.Thread(target=server.serve_forever,daemon=True).start()
            url=origin+'/entry/';qr_image(url,out/(key+'-qr.png'));metadata.append({'group':key,'title':title,'url':url,'mode':a.mode,'travelDates':config['travelDates']})
            cards.append('<section class="card"><h2>'+title+'</h2><span class="pill">'+label+'</span><img src="'+key+'-qr.png" alt="'+title+' QR"><a class="url" href="'+url+'">'+url+'</a><p>각자 배정받은 참가자 번호로 입장</p></section>')
        (out/'QR_접속안내.html').write_text(page('가치로 그룹별 QR','<div class="eyebrow">GACHILO · EXPERIMENT</div><h1>그룹별 실험 QR</h1><p>서버 노트북과 같은 Wi-Fi에서 Safari 또는 Chrome으로 열어 주세요.</p><div class="grid">'+''.join(cards)+'</div><p>이 노트북의 현재 Wi-Fi 주소 기준입니다. 혜인·윤진 노트북에서 진행할 때는 해당 노트북에서 실행하고 새 QR을 사용하세요.</p>'))
        (out/'links.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2))
        print('QR 안내: '+str(out/'QR_접속안내.html'),flush=True)
        print('참가자 1 PIN: 각 그룹 .local room-private.json에서 진행자만 확인 후 본인에게 전달',flush=True)
        for row in metadata:print(row['title']+': '+row['url']+' ('+a.mode+')',flush=True)
        while True:
            time.sleep(1)
            if any(x.poll() is not None for x in processes):raise RuntimeError('API 종료 감지. DB를 보존하고 이번 실행을 중단합니다.')
    except KeyboardInterrupt:pass
    finally:
        for s in servers:s.shutdown();s.server_close()
        for child in processes:
            if child.poll() is None:
                child.send_signal(signal.SIGTERM)
                try:child.wait(timeout=15)
                except subprocess.TimeoutExpired:print('API 종료 대기 초과. 해당 프로세스를 확인하세요.',file=sys.stderr)
        for lock in reversed(locks):lock.__exit__(None,None,None)

if __name__=='__main__':
    signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(KeyboardInterrupt()))
    try:main()
    except (ValueError,OSError,subprocess.CalledProcessError) as e:raise SystemExit(str(e))
