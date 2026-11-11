"""Export saved candidate/assignment evidence; survey answers stay in Google Forms."""
import argparse,csv,json,sqlite3,subprocess
from pathlib import Path
import experiment_support as support

def export(bundle,group,out,node=None):
 support.verify(bundle)
 if out.exists():raise ValueError('출력 폴더가 이미 있습니다. 새 경로를 지정하세요.')
 source=support.group_dir(bundle,group)/'trips.sqlite3'
 if not source.is_file():raise ValueError('그룹 DB가 없습니다.')
 node=support.node_binary(node);rows=[];details=[]
 config=json.loads((bundle/'experiment-config.json').read_text())
 with sqlite3.connect(source.resolve().as_uri()+'?mode=ro',uri=True) as db:
  db.row_factory=sqlite3.Row;db.execute('BEGIN')
  for row in db.execute('SELECT cr.* FROM candidate_results cr JOIN rooms r ON r.id=cr.room_id WHERE cr.revision=r.revision'):
   members=db.execute('SELECT id,name FROM members WHERE room_id=? ORDER BY rowid',(row['room_id'],)).fetchall()
   subs=[json.loads(x[0]) for x in db.execute('SELECT s.payload FROM submissions s JOIN members m ON m.id=s.member_id WHERE m.room_id=? ORDER BY m.rowid',(row['room_id'],))]
   for member in members:
    for candidate in json.loads(row['payload']):
     payload={'roomId':row['room_id'],'memberId':member['id'],'memberIds':[m['id'] for m in members],'candidate':candidate,'submissions':subs}
     computed=json.loads(subprocess.check_output([node,str(support.ROOT/'backend/engine/experiment_record.mjs')],input=json.dumps(payload),text=True,timeout=10))
     identity={'group_id':group,'mode':config['mode'],'participant_code':member['name'],'room_id':row['room_id'],'revision':row['revision'],'letter':computed['letter'],'strategy':computed['strategy'],'display_order':computed['order'],'explained':computed['explained']}
     rows.append({**identity,**{k:v for k,v in computed['automatic'].items() if k!='memberId'},**computed['metrics']})
     details.append({**identity,'candidate':candidate,'groupMetrics':computed['group']})
 out.mkdir(parents=True,mode=0o700)
 columns=list(dict.fromkeys(k for r in rows for k in r)) or ['group_id','participant_code','letter']
 def safe(v):
  if isinstance(v,(list,dict)):v=json.dumps(v,ensure_ascii=False)
  return "'"+v if isinstance(v,str) and v.lstrip()[:1] in ('=','+','-','@') else v
 with (out/'candidate_metrics.csv').open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=columns);w.writeheader();w.writerows({k:safe(v) for k,v in r.items()} for r in rows)
 (out/'evidence.json').write_text(json.dumps(details,ensure_ascii=False,indent=2))
 (out/'config.json').write_text(json.dumps(config,ensure_ascii=False,indent=2))
 for p in out.iterdir():p.chmod(0o600)
 return len(rows)
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--bundle',required=True,type=Path);p.add_argument('--group',required=True);p.add_argument('--out',required=True,type=Path);p.add_argument('--node');a=p.parse_args();print(f'{export(a.bundle,a.group,a.out,a.node)}개 참가자×일정 근거 내보내기 완료. Google 설문 응답은 포함하지 않습니다.')
