"""Local week-5 API prototype. SQLite persistence; run: python3 server.py."""
import argparse, hashlib, hmac, json, re, secrets, sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from engine import Engine, EngineError
from urllib.parse import urlsplit, parse_qs
from place_catalog import catalog, exchange_rate, DATA
from real_engine import RealEngine, REAL_DATASET

class ApiError(Exception):
    def __init__(self,status,message):self.status,self.message=status,message

def require(ok,message):
    if not ok:raise ApiError(400,message)
def digest(token):return hashlib.sha256(token.encode()).hexdigest()
def now():return datetime.now(timezone.utc).isoformat()

class Store:
    def __init__(self,path,catalog=None):
        self.catalog_ids=set(p["id"] for p in catalog) if catalog is not None else None
        self.real_ids={r["place"]["place_id"] for r in json.loads(DATA.read_text(encoding="utf-8"))["places"]}
        self.path=str(path)
        Path(path).parent.mkdir(parents=True,exist_ok=True)
        with self.connect() as c:
            c.executescript('''
            CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY,start TEXT,end TEXT,owner_hash TEXT,revision INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY,room_id TEXT,name TEXT,token_hash TEXT,FOREIGN KEY(room_id) REFERENCES rooms(id));
            CREATE TABLE IF NOT EXISTS submissions(member_id TEXT PRIMARY KEY,payload TEXT,updated TEXT,FOREIGN KEY(member_id) REFERENCES members(id));
            CREATE TABLE IF NOT EXISTS results(room_id TEXT PRIMARY KEY,revision INTEGER,payload TEXT,updated TEXT,FOREIGN KEY(room_id) REFERENCES rooms(id));
            ''')
            if 'dataset' not in {row['name'] for row in c.execute('PRAGMA table_info(rooms)')}:
                c.execute("ALTER TABLE rooms ADD COLUMN dataset TEXT NOT NULL DEFAULT 'prototype_demo_36'")
            if 'planning' not in {row['name'] for row in c.execute('PRAGMA table_info(results)')}:
                c.execute('ALTER TABLE results ADD COLUMN planning TEXT')
            # Shared invite link: one invite token per room, and each name can be claimed once.
            if 'invite_hash' not in {row['name'] for row in c.execute('PRAGMA table_info(rooms)')}:
                c.execute('ALTER TABLE rooms ADD COLUMN invite_hash TEXT')
            if 'claimed' not in {row['name'] for row in c.execute('PRAGMA table_info(members)')}:
                c.execute('ALTER TABLE members ADD COLUMN claimed INTEGER NOT NULL DEFAULT 0')
    @contextmanager
    def connect(self):
        c=sqlite3.connect(self.path,timeout=10)
        c.row_factory=sqlite3.Row
        c.execute('PRAGMA foreign_keys=ON')
        try:
            with c:
                yield c
        finally:
            c.close()
    def room(self,c,room_id):
        r=c.execute('SELECT * FROM rooms WHERE id=?',(room_id,)).fetchone()
        if not r:raise ApiError(404,'여행방을 찾을 수 없습니다.')
        return r
    def create(self,b):
        require(isinstance(b,dict),'JSON 객체가 필요합니다.')
        try:start,end=date.fromisoformat(b['startDate']),date.fromisoformat(b['endDate'])
        except (KeyError,TypeError,ValueError):raise ApiError(400,'시작일·종료일을 YYYY-MM-DD로 입력하세요.')
        require(0<=(end-start).days<=29,'여행 기간은 1~30일이어야 합니다.')
        names=b.get('memberNames');require(isinstance(names,list) and 2<=len(names)<=6,'동행자는 2~6명이어야 합니다.')
        require(all(isinstance(n,str) and 1<=len(n.strip())<=40 for n in names),'참여자 이름은 1~40자여야 합니다.')
        dataset=b.get('dataset','prototype_demo_36')
        require(dataset in ('prototype_demo_36',REAL_DATASET),'장소 데이터 모드를 확인하세요.')
        require(len({n.strip() for n in names})==len(names),'참여자 이름이 겹칩니다.')
        rid=secrets.token_urlsafe(16);owner=secrets.token_urlsafe(32);invite=secrets.token_urlsafe(24);members=[]
        with self.connect() as c:
            c.execute('INSERT INTO rooms(id,start,end,owner_hash,dataset,invite_hash) VALUES(?,?,?,?,?,?)',(rid,start.isoformat(),end.isoformat(),digest(owner),dataset,digest(invite)))
            for i,name in enumerate(names):
                mid=secrets.token_urlsafe(12);token=secrets.token_urlsafe(32)
                # The first name is the room creator, so that seat is already taken.
                c.execute('INSERT INTO members(id,room_id,name,token_hash,claimed) VALUES(?,?,?,?,?)',(mid,rid,name.strip(),digest(token),1 if i==0 else 0))
                members.append({'id':mid,'name':name.strip(),'submissionToken':token})
        return {'roomId':rid,'startDate':start.isoformat(),'endDate':end.isoformat(),'ownerToken':owner,'inviteToken':invite,'members':members,'revision':0,**({'dataset':dataset} if dataset==REAL_DATASET else {})}
    def check_invite(self,r,token):
        if not (r['invite_hash'] and hmac.compare_digest(r['invite_hash'],digest(token))):raise ApiError(403,'초대 링크가 올바르지 않습니다.')
    def invite_info(self,rid,token):
        # What the shared link shows: dates and names to pick from. Never tokens or inputs.
        with self.connect() as c:
            c.execute('BEGIN');r=self.room(c,rid);self.check_invite(r,token)
            rows=c.execute('SELECT id,name,claimed FROM members WHERE room_id=? ORDER BY rowid',(rid,)).fetchall()
        return {'roomId':rid,'startDate':r['start'],'endDate':r['end'],'members':[{'id':m['id'],'name':m['name'],'claimed':bool(m['claimed'])} for m in rows]}
    def claim(self,rid,token,b):
        # Picking a name issues a fresh submission token, so a seat can be taken only once.
        require(isinstance(b,dict) and isinstance(b.get('memberId'),str)!=isinstance(b.get('name'),str),'memberId 또는 name 중 하나가 필요합니다.')
        fresh=secrets.token_urlsafe(32)
        with self.connect() as c:
            c.execute('BEGIN IMMEDIATE');r=self.room(c,rid);self.check_invite(r,token)
            if isinstance(b.get('memberId'),str):
                m=c.execute('SELECT id,name,claimed FROM members WHERE id=? AND room_id=?',(b['memberId'],rid)).fetchone()
                if not m:raise ApiError(404,'이 방에 없는 이름입니다.')
                if m['claimed']:raise ApiError(409,'이미 다른 사람이 고른 이름이에요.')
                c.execute('UPDATE members SET token_hash=?,claimed=1 WHERE id=?',(digest(fresh),m['id']))
                return {'memberId':m['id'],'name':m['name'],'submissionToken':fresh}
            name=b['name'].strip();require(1<=len(name)<=40,'참여자 이름은 1~40자여야 합니다.')
            names=[x['name'] for x in c.execute('SELECT name FROM members WHERE room_id=?',(rid,))]
            if name in names:raise ApiError(409,'이미 있는 이름이에요. 목록에서 골라 주세요.')
            if len(names)>=6:raise ApiError(409,'동행자는 6명까지예요.')
            mid=secrets.token_urlsafe(12)
            c.execute('INSERT INTO members(id,room_id,name,token_hash,claimed) VALUES(?,?,?,?,1)',(mid,rid,name,digest(fresh)))
            # A new member changes who must submit, so any saved result is stale.
            c.execute('UPDATE rooms SET revision=revision+1 WHERE id=?',(rid,));c.execute('DELETE FROM results WHERE room_id=?',(rid,))
        return {'memberId':mid,'name':name,'submissionToken':fresh}
    def authenticate(self,c,r,token,member_id=None,owner_only=False):
        hashed=digest(token)
        if member_id:
            m=c.execute('SELECT token_hash FROM members WHERE id=? AND room_id=?',(member_id,r['id'])).fetchone()
            if m and hmac.compare_digest(m['token_hash'],hashed):return self.occupy(c,member_id)
        elif hmac.compare_digest(r['owner_hash'],hashed):return
        elif not owner_only:
            m=c.execute('SELECT id FROM members WHERE room_id=? AND token_hash=?',(r['id'],hashed)).fetchone()
            if m:return self.occupy(c,m['id'])
        raise ApiError(403,'이 작업의 접근 토큰이 올바르지 않습니다.')
    def occupy(self,c,member_id):
        # A seat someone already uses through a personal link must not be re-picked from the shared link,
        # or the new token would read that person's private input. Same transaction as the request.
        c.execute('UPDATE members SET claimed=1 WHERE id=? AND claimed=0',(member_id,))
    def submit(self,rid,mid,token,b):
        require(isinstance(b,dict),'JSON 객체가 필요합니다.')
        for field in ('longlist','picks'):
            v=b.get(field);require(isinstance(v,list) and len(v)<=30 and all(isinstance(x,str) and 1<=len(x)<=100 for x in v),field+' 형식을 확인하세요.')
            require(len(set(v))==len(v),field+'에 중복 장소가 있습니다.')
        for field in ('must','veto'):require(b.get(field) is None or isinstance(b[field],str) and 1<=len(b[field])<=100,field+' 형식을 확인하세요.')
        require(b.get('must') is None or b['must'] in b['picks'],'꼭 가는 곳은 picks에 포함되어야 합니다.')
        require(b.get('veto') not in b['picks'],'거부 장소는 picks에 포함할 수 없습니다.')
        for field,low,high in [('budgetPerDay',0,10000000),('stepLimit',0,100000),('activeMin',1,1440)]:
            require(type(b.get(field)) is int and low<=b[field]<=high,field+' 범위를 확인하세요.')
        payload={k:b.get(k) for k in ['longlist','picks','must','veto','budgetPerDay','stepLimit','activeMin']};payload['memberId']=mid
        with self.connect() as c:
            c.execute('BEGIN IMMEDIATE');r=self.room(c,rid);self.authenticate(c,r,token,mid)
            allowed=self.real_ids if r['dataset']==REAL_DATASET else self.catalog_ids
            ids=b['longlist']+b['picks']+[b[k] for k in ('must','veto') if b.get(k)]
            if allowed is not None:require(all(x in allowed for x in ids),'이 방의 장소 목록에 없는 ID가 포함되어 있습니다.')
            c.execute('INSERT INTO submissions VALUES(?,?,?) ON CONFLICT(member_id) DO UPDATE SET payload=excluded.payload,updated=excluded.updated',(mid,json.dumps(payload),now()))
            c.execute('UPDATE rooms SET revision=revision+1 WHERE id=?',(rid,));c.execute('DELETE FROM results WHERE room_id=?',(rid,))
            revision=r['revision']+1
        return {'saved':True,'memberId':mid,'revision':revision}
    def result(self,rid,token):
        with self.connect() as c:
            c.execute('BEGIN');r=self.room(c,rid);self.authenticate(c,r,token)
            row=c.execute('SELECT * FROM results WHERE room_id=? AND revision=?',(rid,r['revision'])).fetchone()
            count=c.execute('SELECT COUNT(*) FROM members m JOIN submissions s ON m.id=s.member_id WHERE m.room_id=?',(rid,)).fetchone()[0]
            total=c.execute('SELECT COUNT(*) FROM members WHERE room_id=?',(rid,)).fetchone()[0]
        extra={'dataset':REAL_DATASET,'planning':json.loads(row['planning']) if row and row['planning'] else None} if r['dataset']==REAL_DATASET else {}
        return {**extra,'roomId':rid,'status':('draft' if r['dataset']==REAL_DATASET else 'ready') if row else 'awaiting_result' if count==total else 'collecting','submittedCount':count,'memberCount':total,'revision':r['revision'],'result':json.loads(row['payload']) if row else None}
    def meta(self,rid,token):
        # Same public room shape as the frontend v2 branch; no private inputs.
        with self.connect() as c:
            c.execute('BEGIN');r=self.room(c,rid);self.authenticate(c,r,token)
            rows=c.execute('SELECT id,name FROM members WHERE room_id=? ORDER BY rowid',(rid,)).fetchall()
        return {'roomId':rid,'startDate':r['start'],'endDate':r['end'],'members':[{'id':m['id'],'name':m['name']} for m in rows],**({'dataset':r['dataset']} if r['dataset']==REAL_DATASET else {})}
    def own_submission(self,rid,mid,token):
        # Even the owner token cannot read another participant's choices.
        with self.connect() as c:
            c.execute('BEGIN');r=self.room(c,rid);self.authenticate(c,r,token,mid)
            row=c.execute('SELECT payload FROM submissions WHERE member_id=?',(mid,)).fetchone()
        return {'roomId':rid,'memberId':mid,'revision':r['revision'],'submission':json.loads(row['payload']) if row else None}
    def snapshot(self,rid,token):
        with self.connect() as c:
            c.execute('BEGIN')
            r=self.room(c,rid)
            self.authenticate(c,r,token,owner_only=True)
            rows=c.execute('SELECT m.id,m.name,s.payload FROM members m LEFT JOIN submissions s ON m.id=s.member_id WHERE m.room_id=? ORDER BY m.rowid',(rid,)).fetchall()
            if any(x['payload'] is None for x in rows):raise ApiError(409,'모든 참여자의 입력이 필요합니다.')
            return {'dataset':r['dataset'],'startDate':r['start'],'endDate':r['end'],'revision':r['revision'],'members':[{'id':m['id'],'name':m['name'],'color':'#2563eb'} for m in rows],'submissions':[json.loads(m['payload']) for m in rows]}
    def save_result(self,rid,token,b,*,planning=None):
        require(isinstance(b,dict) and type(b.get('revision')) is int and isinstance(b.get('result'),dict),'revision과 result 객체가 필요합니다.')
        # This is an integration boundary, not a recommendation algorithm.
        result=b['result'];require(set(result)=={'strategy','days','summary'},'결과는 strategy·days·summary 항목만 받습니다.')
        require(result['strategy'] in ('average','least_misery','fairness'),'전략이 올바르지 않습니다.')
        require(isinstance(result['days'],list) and len(result['days'])<=30,'days 형식을 확인하세요.')
        require(isinstance(result['summary'],str) and len(result['summary'])<=2000,'summary는 2000자 이하여야 합니다.')
        for day in result['days']:
            require(isinstance(day,dict) and set(day)=={'date','placeIds'},'하루 결과는 date·placeIds만 받습니다.')
            require(isinstance(day['placeIds'],list) and len(day['placeIds'])<=30 and all(isinstance(x,str) and 1<=len(x)<=100 for x in day['placeIds']),'placeIds 형식을 확인하세요.')
        with self.connect() as c:
            c.execute('BEGIN IMMEDIATE');r=self.room(c,rid);self.authenticate(c,r,token,owner_only=True)
            if r['dataset']==REAL_DATASET and planning is None:raise ApiError(400,'실제 장소 결과는 calculate 경로에서 검증 후 저장하세요.')
            if r['revision']!=b['revision']:raise ApiError(409,'입력이 변경되었습니다. 최신 입력으로 다시 계산하세요.')
            counts=c.execute('SELECT COUNT(*),COUNT(s.member_id) FROM members m LEFT JOIN submissions s ON m.id=s.member_id WHERE m.room_id=?',(rid,)).fetchone()
            if counts[0]!=counts[1]:raise ApiError(409,'모든 참여자의 입력이 필요합니다.')
            seen=set()
            for day in result['days']:
                try:dt=date.fromisoformat(day['date'])
                except (ValueError,TypeError):raise ApiError(400,'결과 날짜 형식을 확인하세요.')
                require(r['start']<=dt.isoformat()<=r['end'] and dt.isoformat() not in seen,'결과 날짜가 여행 기간 밖이거나 중복입니다.');seen.add(dt.isoformat())
            c.execute('INSERT INTO results(room_id,revision,payload,updated,planning) VALUES(?,?,?,?,?) ON CONFLICT(room_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated=excluded.updated,planning=excluded.planning',(rid,r['revision'],json.dumps(result),now(),json.dumps(planning) if planning is not None else None))
        return {'saved':True,'revision':b['revision']}

def make_server(path,host='127.0.0.1',port=8000,allowed_origin='http://localhost:3000'):
    exchange_rate() # Fail at startup for malformed conversion configuration.
    engine=Engine()
    real_engine=RealEngine(engine.node)
    store=Store(path,engine.catalog)
    class Handler(BaseHTTPRequestHandler):
        def trusted_origin(self):
            origin=self.headers.get('Origin')
            return origin in (None,allowed_origin,f'http://127.0.0.1:{self.server.server_port}',f'http://localhost:{self.server.server_port}')
        def log_message(self,*args):pass # Do not log authorization tokens or private inputs.
        def send_json(self,status,payload):
            raw=json.dumps(payload,ensure_ascii=False).encode();self.send_response(status)
            if self.headers.get('Origin') and self.trusted_origin():self.send_header('Access-Control-Allow-Origin',self.headers['Origin'])
            self.send_header('Vary','Origin');self.send_header('Cache-Control','no-store');self.send_header('Referrer-Policy','no-referrer');self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
        def do_OPTIONS(self):
            if not self.trusted_origin():return self.send_json(403,{'error':'허용되지 않은 출처입니다.'})
            self.send_response(204);self.send_header('Access-Control-Allow-Origin',self.headers.get('Origin',allowed_origin));self.send_header('Access-Control-Allow-Methods','GET,POST,PUT,OPTIONS');self.send_header('Access-Control-Allow-Headers','Content-Type,Authorization');self.send_header('Vary','Origin');self.end_headers()
        def handle_api(self):
            try:
                if not self.trusted_origin():raise ApiError(403,'허용되지 않은 출처입니다.')
                b=None
                if self.command in ('POST','PUT'):
                    require(self.headers.get_content_type()=='application/json','Content-Type은 application/json이어야 합니다.')
                    try:n=int(self.headers.get('Content-Length','0'))
                    except ValueError:raise ApiError(400,'잘못된 본문 길이입니다.')
                    if not 0<n<=65536:raise ApiError(413,'본문은 64KB 이하여야 합니다.')
                    try:b=json.loads(self.rfile.read(n))
                    except (ValueError,UnicodeDecodeError):raise ApiError(400,'JSON을 읽을 수 없습니다.')
                auth=self.headers.get('Authorization','');token=auth[7:] if auth.startswith('Bearer ') else ''
                path=self.path.split('?')[0].rstrip('/')
                assets={'':('index.html','text/html'),'/join':('index.html','text/html'),'/app.js':('app.js','text/javascript'),'/planning-reasons.mjs':('planning-reasons.mjs','text/javascript'),'/session.mjs':('session.mjs','text/javascript'),'/polling.mjs':('polling.mjs','text/javascript'),'/client.js':('client.js','text/javascript'),'/style.css':('style.css','text/css')}
                if self.command=='GET' and path in assets:
                    filename,mime=assets[path];raw=(Path(__file__).parent/'public'/filename).read_bytes()
                    self.send_response(200);self.send_header('Content-Type',mime+'; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Referrer-Policy','no-referrer');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw);return
                if self.command=='GET' and path=='/api/places':
                    qs=parse_qs(urlsplit(self.path).query)
                    try:limit=int(qs.get('limit',['150'])[0])
                    except ValueError:raise ApiError(400,'limit는 1~150 정수여야 합니다.')
                    require(1<=limit<=150,'limit는 1~150 정수여야 합니다.')
                    return self.send_json(200,catalog(qs.get('q',[''])[0],qs.get('category',[None])[0],limit))
                if self.command=='GET' and path=='/places':return self.send_json(200,{'dataset':'prototype_demo_36','currency':'KRW','places':engine.catalog})
                m=re.fullmatch(r'/rooms/([\w-]+)/calculate',path)
                if m and self.command=='POST':
                    require(isinstance(b,dict) and b.get('strategy') in ('average','least_misery','fairness'),'추천 전략을 선택하세요.')
                    snapshot=store.snapshot(m[1],token)
                    planning=None
                    if snapshot['dataset']==REAL_DATASET:
                        require(b['strategy']=='average','실제 장소 모드는 선택 수 우선(average)만 지원합니다.')
                        computed=real_engine.calculate(snapshot)
                        result,planning=computed['result'],computed['planning']
                    else:result=engine.calculate(snapshot,b['strategy'])
                    store.save_result(m[1],token,{'revision':snapshot['revision'],'result':result},planning=planning)
                    return self.send_json(200,store.result(m[1],token))
                if self.command=='GET' and path=='/health':return self.send_json(200,{'ok':True})
                if self.command=='POST' and path=='/rooms':return self.send_json(201,store.create(b))
                m=re.fullmatch(r'/rooms/([\w-]+)/join',path)
                if m and self.command=='GET':return self.send_json(200,store.invite_info(m[1],token))
                if m and self.command=='POST':return self.send_json(200,store.claim(m[1],token,b))
                m=re.fullmatch(r'/rooms/([\w-]+)',path)
                if self.command=='GET' and m:return self.send_json(200,store.meta(m[1],token))
                m=re.fullmatch(r'/rooms/([\w-]+)/submissions/([\w-]+)',path)
                if self.command=='GET' and m:return self.send_json(200,store.own_submission(*m.groups(),token))
                if self.command=='PUT' and m:return self.send_json(200,store.submit(*m.groups(),token,b))
                m=re.fullmatch(r'/rooms/([\w-]+)/results',path)
                if m and self.command=='GET':return self.send_json(200,store.result(m[1],token))
                if m and self.command=='POST':return self.send_json(200,store.save_result(m[1],token,b))
                raise ApiError(404,'경로를 찾을 수 없습니다.')
            except ApiError as e:self.send_json(e.status,{'error':e.message})
            except EngineError as e:self.send_json(503,{'error':str(e)})
            except sqlite3.Error:self.send_json(503,{'error':'저장소를 사용할 수 없습니다. 다시 시도하세요.'})
        do_GET=handle_api;do_POST=handle_api;do_PUT=handle_api
    return ThreadingHTTPServer((host,port),Handler)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--host',default='127.0.0.1');p.add_argument('--port',type=int,default=8000);p.add_argument('--db',default=str(Path(__file__).parent/'.local/trips.sqlite3'));p.add_argument('--origin',default='http://localhost:3000');a=p.parse_args()
    server=make_server(a.db,host=a.host,port=a.port,allowed_origin=a.origin)
    print(f'API listening on {a.host}:{server.server_port}',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
