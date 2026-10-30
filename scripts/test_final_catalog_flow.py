import os,sys,json,tempfile,threading,urllib.request,urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
for key in ('REAL_CATALOG_PATH','REAL_PROFILES_PATH'):os.environ.pop(key,None)
os.environ.update(NODE_BINARY=os.environ.get('NODE_BINARY','node'),JPY_TO_KRW='8.6253',JPY_TO_KRW_AS_OF='2026-09-30',JPY_TO_KRW_SOURCE='하나은행 https://kebhana.com/cont/mall/mall15/mall1501/index.jsp',OSRM_FOOT_URL='',SOMSOM_API_KEY='',AI_MOCK='')
sys.path.insert(0,str(ROOT/'backend'))
from server import make_server,Store
from candidate_engine import CandidateEngine
from engine import Engine

with tempfile.TemporaryDirectory() as tmp:
 db=Path(tmp)/'test.sqlite3';server=make_server(db,port=0)
 thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 def req(method,path,body=None,token=''):
  request=urllib.request.Request(f'http://127.0.0.1:{server.server_port}'+path,data=None if body is None else json.dumps(body).encode(),method=method,headers={'Content-Type':'application/json','Authorization':'Bearer '+token,'Origin':'http://localhost:3000'})
  with urllib.request.urlopen(request,timeout=150) as response:return json.load(response)
 try:
  page1=req('GET','/api/places?limit=150');page2=req('GET','/api/places?offset=150&limit=150')
  assert page1['total']==225 and len(page2['places'])==75
  assert req('GET','/api/places?offset=225')['places']==[]
  for query in ['?offset=-1','?offset=bad','?limit=151']:
   try:req('GET','/api/places'+query);raise AssertionError('invalid pagination accepted')
   except urllib.error.HTTPError as error:assert error.code==400
  for q,pid in [('이치란 아베노','branch_ichiran_abeno'),('이치란 신사이바시','branch_ichiran_shinsaibashi'),('스벅','branch_starbucks_ebisubashi'),('유니버설','branch_usj'),('스시로','branch_sushiro_namba_amza')]:
   from urllib.parse import quote
   found=req('GET','/api/places?q='+quote(q))
   assert pid in {p['place_id'] for p in found['places']},(q,found)
  branch='branch_ichiran_shinsaibashi'
  held='branch_wanaka_dotonbori'
  room=req('POST','/rooms',{'dataset':'osaka_review_150','startDate':'2026-11-02','endDate':'2026-11-04','memberNames':['검사A','검사B']})
  supplemental=['branch_starbucks_ebisubashi','branch_sushiro_namba_amza','branch_usj','branch_kaiyukan']
  path='/rooms/'+room['roomId'];picks=['osaka_009','osaka_015',branch,held,*supplemental]
  for m in room['members']:
   req('PUT',path+'/longlists/'+m['id'],{'longlist':picks},m['submissionToken'])
  pool=req('GET',path+'/pool',token=room['ownerToken'])
  assert pool['listedCount']==2 and set(pool['placeIds'])==set(picks)
  for m in room['members']:
   req('PUT',path+'/submissions/'+m['id'],{'longlist':picks,'picks':picks,'must':branch,'veto':None,'budgetPerDay':100000,'stepLimit':20000,'activeMin':720},m['submissionToken'])
  result=req('POST',path+'/calculate',{'strategies':['average','least_misery','fairness'],'revision':2},room['ownerToken'])
  assert len(result['candidates'])==3
  for candidate in result['candidates']:
   ids=[pid for d in candidate['days'] for pid in d['placeIds']]
   assert ids and branch in ids and held not in ids
   assert not set(supplemental).intersection(ids)
  selected=req('PUT',path+'/selection',{'strategy':'fairness','revision':2,'selectionVersion':0},room['ownerToken'])
  for m in room['members']:assert req('GET',path+'/results',token=m['submissionToken'])==selected
  assert Store(db).result(room['roomId'],room['ownerToken'])==selected
  print(json.dumps({'catalog':225,'branches':75,'submission_with_new_branch':'accepted','strategies':3,'verified_branch':'scheduled in all 3 candidates','unverified_branch_and_supplements':'excluded','shared_result_and_db_reload':'passed'},ensure_ascii=False))
 finally:server.shutdown();server.server_close();thread.join()
