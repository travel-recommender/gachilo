"""Private H4 survey records. Canonical assignment and scores come from saved server candidates."""
import hashlib,json,os,subprocess
from datetime import datetime,timezone
from pathlib import Path
from api_errors import ApiError,require
from engine import EngineError

LETTERS=('A','B','C')
def stamp():return datetime.now(timezone.utc).isoformat()
def encoded(v):return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def sha(v):return hashlib.sha256(encoded(v).encode()).hexdigest()
def score(v):return type(v) is int and 1<=v<=5

class ExperimentStore:
 def init_experiment(self,c):
  c.executescript('''
  CREATE TABLE IF NOT EXISTS experiment_pre(member_id TEXT PRIMARY KEY REFERENCES members(id),payload TEXT NOT NULL,updated TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS experiment_records(room_id TEXT NOT NULL REFERENCES rooms(id),member_id TEXT NOT NULL REFERENCES members(id),revision INTEGER NOT NULL,candidate_hash TEXT NOT NULL,kind TEXT NOT NULL,letter TEXT NOT NULL,payload TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(room_id,member_id,revision,candidate_hash,kind,letter));
  ''')
 def experiment_bridge(self,payload):
  try:
   out=subprocess.run([self.experiment_node,str(Path(__file__).parent/'engine/experiment_record.mjs')],input=encoded(payload),text=True,capture_output=True,encoding='utf-8',timeout=10,check=True)
   return json.loads(out.stdout)
  except (OSError,ValueError,subprocess.SubprocessError) as e:raise EngineError('실험 배정을 확인하지 못했습니다. 저장하지 않았으니 다시 시도하세요.') from e
 def experiment(self,rid,mid,token,body=None):
  if os.environ.get('EXPERIMENT_SERVER')!='1':raise ApiError(404,'실험 전용 서버에서만 사용할 수 있습니다.')
  with self.connect() as c:
   c.execute('BEGIN IMMEDIATE' if body is not None else 'BEGIN')
   r=self.room(c,rid);seat=self.authenticate(c,r,token,mid)
   if body is not None:self.occupy(c,seat)
   members=[m['id'] for m in c.execute('SELECT id FROM members WHERE room_id=? ORDER BY rowid',(rid,))]
   assigned=self.experiment_bridge({'roomId':rid,'memberId':mid,'memberIds':members})
   view,_=self.candidate_view(c,r);cs=view['candidates'];bundle_hash=sha(cs) if cs else ''
   pre=c.execute('SELECT payload FROM experiment_pre WHERE member_id=?',(mid,)).fetchone()
   records={(x['kind'],x['letter']):json.loads(x['payload']) for x in c.execute('SELECT kind,letter,payload FROM experiment_records WHERE room_id=? AND member_id=? AND revision=? AND candidate_hash=?',(rid,mid,r['revision'],bundle_hash))}
   if body is not None:
    require(isinstance(body,dict) and isinstance(body.get('kind'),str),'응답 종류가 필요합니다.')
    kind=body['kind'];answers=body.get('answers');letter=body.get('letter','')
    if kind=='pre':
     require(set(body)=={'kind','answers'} and isinstance(answers,dict) and set(answers)=={'consentConfirmed','S1','S2','S3','S4'},'사전 질문 항목을 확인하세요.')
     require(answers['consentConfirmed'] is True and answers['S1'] in ('0','1-2','3-5','6+') and answers['S2'] in ('lead','suggest','follow') and score(answers['S3']) and type(answers['S4']) is bool,'사전 질문을 모두 입력하세요.')
     if pre and json.loads(pre['payload'])!=answers:raise ApiError(409,'사전 응답은 이미 저장되었습니다. 변경은 진행자에게 알려 주세요.')
     c.execute('INSERT INTO experiment_pre VALUES(?,?,?) ON CONFLICT(member_id) DO NOTHING',(mid,encoded(answers),stamp()))
    else:
     require(kind in ('view','candidate','post'),'지원하지 않는 응답입니다.')
     if not pre:raise ApiError(409,'먼저 사전 질문을 저장하세요.')
     require(type(body.get('revision')) is int and isinstance(body.get('candidateHash'),str),'입력 버전·후보 확인값이 필요합니다.')
     if not cs or body['revision']!=r['revision'] or body['candidateHash']!=bundle_hash:raise ApiError(409,'일정이 바뀌었습니다. 현재 일정을 다시 확인한 뒤 평가하세요.')
     if kind=='post':
      require(set(body)=={'kind','revision','candidateHash','answers'} and isinstance(answers,dict) and set(answers)=={'P1','P2','P3','P4','P5'},'마지막 질문 항목을 확인하세요.')
      require(isinstance(answers['P1'],list) and len(answers['P1'])==3 and all(type(x) is str for x in answers['P1']) and set(answers['P1'])==set(LETTERS) and answers['P2'] in LETTERS and score(answers['P3']) and all(isinstance(answers[k],str) and len(answers[k])<=2000 for k in ('P4','P5')),'순위·점수·소감을 확인하세요.')
      if not all(('candidate',x) in records for x in LETTERS):raise ApiError(409,'세 일정의 평가를 먼저 저장하세요.')
      payload={'answers':answers};letter=''
     else:
      require(letter in LETTERS,'일정 A·B·C 중 하나를 지정하세요.')
      require(set(body)==({'kind','revision','candidateHash','letter'} if kind=='view' else {'kind','revision','candidateHash','letter','answers'}),'요청 항목을 확인하세요.')
      slot=next(s for s in assigned['slots'] if s['letter']==letter)
      candidate=next(x for x in cs if x['strategy']==slot['strategy'])
      if kind=='view':
       payload={'displayedAt':stamp(),'explained':slot['explained'],'eventMeaning':'candidate screen visible; not proof of reading'}
      else:
       expected={f'Q{i}' for i in range(1,10 if slot['explained'] else 9)}
       require(isinstance(answers,dict) and set(answers)==expected and all(score(x) for x in answers.values()),'해당 일정의 질문에 1~5점으로 모두 답해 주세요.')
       if ('view',letter) not in records:raise ApiError(409,'먼저 해당 일정 화면을 열어 살펴봐 주세요.')
       subs=[json.loads(x['payload']) for x in c.execute('SELECT s.payload FROM submissions s JOIN members m ON m.id=s.member_id WHERE m.room_id=? ORDER BY m.rowid',(rid,))]
       canonical=self.experiment_bridge({'roomId':rid,'memberId':mid,'memberIds':members,'candidate':candidate,'submissions':subs})
       payload={**canonical,'answers':answers,'displayEvent':records['view',letter], 'candidate':candidate,
        'inputSnapshot':next(s for s in subs if s['memberId']==mid),'protocol':'h4-2026-11-v1'}
     # View is first exposure. Answers are idempotent; edits after saving require operator intervention.
     prior=records.get((kind,letter))
     if prior and kind!='view' and prior.get('answers')!=answers:raise ApiError(409,'이미 저장한 응답입니다. 변경은 진행자에게 알려 주세요.')
     c.execute('INSERT INTO experiment_records VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',(rid,mid,r['revision'],bundle_hash,kind,letter,encoded(payload),stamp()))
   # Never send strategies, scores or other participants' answers to the survey UI.
  if body is not None:return self.experiment(rid,mid,token)
  self.occupy_after_read(seat)
  return {'roomId':rid,'memberId':mid,'revision':r['revision'],'candidateHash':bundle_hash,'seat':assigned['seat'],
   'slots':[{k:s[k] for k in ('letter','order','explained')} for s in assigned['slots']],
   'pre':json.loads(pre['payload']) if pre else None,
   'answers':{l:records['candidate',l]['answers'] for l in LETTERS if ('candidate',l) in records},
   'viewed':[l for l in LETTERS if ('view',l) in records],
   'post':records.get(('post',''),{}).get('answers'),'candidatesReady':bool(cs)}
