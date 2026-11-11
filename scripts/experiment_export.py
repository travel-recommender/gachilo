"""Export one group from a consistent read transaction. Never expose this through LAN HTTP."""
import argparse,csv,json,sqlite3
from pathlib import Path
import experiment_support as support

def export(bundle,group,out):
 support.verify(bundle)
 if out.exists():raise ValueError('출력 폴더가 이미 있습니다. 새 경로를 지정하세요.')
 source=support.group_dir(bundle,group)/'trips.sqlite3'
 if not source.is_file():raise ValueError('그룹 DB가 없습니다.')
 rows=[];details=[];mode=json.loads((bundle/'experiment-config.json').read_text())['mode']
 with sqlite3.connect(source.resolve().as_uri()+'?mode=ro',uri=True) as db:
  db.row_factory=sqlite3.Row;db.execute('BEGIN')
  for row in db.execute("SELECT * FROM experiment_records WHERE kind='candidate' ORDER BY room_id,member_id,revision,letter"):
   payload=json.loads(row['payload']);pre=db.execute('SELECT payload FROM experiment_pre WHERE member_id=?',(row['member_id'],)).fetchone()
   post=db.execute("SELECT payload FROM experiment_records WHERE kind='post' AND room_id=? AND member_id=? AND revision=? AND candidate_hash=?",(row['room_id'],row['member_id'],row['revision'],row['candidate_hash'])).fetchone()
   current=db.execute('SELECT revision FROM rooms WHERE id=?',(row['room_id'],)).fetchone()[0]
   identity={'group_id':group,'mode':mode,'room_id':row['room_id'],'participant_id':row['member_id'],'seat':payload['seat'],'candidate_id':payload['strategy'],'display_letter':row['letter'],'revision':row['revision'],'candidate_hash':row['candidate_hash'],'current_revision':current,'is_current_revision':row['revision']==current,'display_order':payload['order'],'explained':payload['explained'],'displayed_at':payload['displayEvent']['displayedAt'],'saved_at':row['updated']}
   flat={**identity,**{k:v for k,v in payload['automatic'].items() if k!='memberId'},**{'group_'+k:v for k,v in payload['group'].items()},**payload['metrics'],**json.loads(pre[0]),**payload['answers'],**(json.loads(post[0])['answers'] if post else {})}
   rows.append(flat);details.append({**identity,**payload})
 out.mkdir(parents=True,mode=0o700)
 columns=list(dict.fromkeys(k for r in rows for k in r)) or ['group_id','participant_id','candidate_id']
 def safe(v):
  if isinstance(v,(list,dict)):v=json.dumps(v,ensure_ascii=False)
  if isinstance(v,str) and v.lstrip()[:1] in ('=','+','-','@'):return "'"+v
  return v
 with (out/'responses.csv').open('w',encoding='utf-8-sig',newline='') as f:
  writer=csv.DictWriter(f,fieldnames=columns);writer.writeheader();writer.writerows({k:safe(v) for k,v in r.items()} for r in rows)
 (out/'evidence.json').write_text(json.dumps(details,ensure_ascii=False,indent=2))
 (out/'config.json').write_text((bundle/'experiment-config.json').read_text())
 for p in out.iterdir():p.chmod(0o600)
 return len(rows)
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--bundle',required=True,type=Path);p.add_argument('--group',required=True);p.add_argument('--out',required=True,type=Path);a=p.parse_args();print(f'{export(a.bundle,a.group,a.out)}개 참가자×일정 응답 내보내기 완료 (모의/실제 및 revision 구분 필요)')
