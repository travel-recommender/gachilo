import concurrent.futures,json,tempfile,threading,unittest,urllib.request,urllib.error
from pathlib import Path
from server import make_server,Store
class ApiTests(unittest.TestCase):
 def test_real_catalog_has_explicit_units_and_stays_separate(self):
  from unittest.mock import patch
  with patch.dict('os.environ',{'JPY_TO_KRW':'9.5'}):
   status,data,_=self.req('GET','/api/places?limit=150')
  self.assertEqual(status,200);self.assertEqual(len(data['places']),150)
  self.assertEqual(data['currency'],'KRW');self.assertEqual(data['exchange_rate']['krw_per_jpy'],'9.5')
  self.assertNotIn('cost',data['places'][0]);self.assertIn('cost_krw',data['places'][0])
  self.assertTrue(all(p['stay_min'] and p['bag_load'] is not None for p in data['places']))
  self.assertEqual(self.req('GET','/api/places?limit=0')[0],400)
  self.assertEqual(self.req('GET','/places')[1]['dataset'],'prototype_demo_36')
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.db=Path(self.tmp.name)/'db.sqlite3';self.server=make_server(self.db,port=0);self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start();self.base=f'http://127.0.0.1:{self.server.server_port}'
 def tearDown(self):self.server.shutdown();self.server.server_close();self.thread.join();self.tmp.cleanup()
 def req(self,method,path,body=None,token='',origin='http://localhost:3000'):
  headers={'Content-Type':'application/json','Origin':origin,'Authorization':'Bearer '+token}
  req=urllib.request.Request(self.base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method=method)
  try:
   with urllib.request.urlopen(req) as r:return r.status,json.load(r),r.headers
  except urllib.error.HTTPError as e:
   try:return e.code,json.load(e),e.headers
   finally:e.close()
 def room(self):return self.req('POST','/rooms',{'startDate':'2026-10-01','endDate':'2026-10-02','memberNames':['조은','윤진','혜인']})[1]
 def submit(self,room,m):return self.req('PUT',f"/rooms/{room['roomId']}/submissions/{m['id']}",{'longlist':['glico','umeda_sky'],'picks':['glico'],'must':'glico','veto':None,'budgetPerDay':50000,'stepLimit':10000,'activeMin':480},m['submissionToken'])
 def test_full_flow_persistence_and_stale_result(self):
  room=self.room();path=f"/rooms/{room['roomId']}/results";token=room['ownerToken']
  self.assertEqual(self.req('GET',path,token=token)[1]['status'],'collecting')
  for member in room['members']:self.assertEqual(self.submit(room,member)[0],200)
  pending=self.req('GET',path,token=token)[1];self.assertEqual(pending['status'],'awaiting_result');self.assertIsNone(pending['result'])
  body={'revision':pending['revision'],'result':{'strategy':'fairness','days':[{'date':'2026-10-01','placeIds':['glico']}],'summary':'저장·조회 검사용 예시'}}
  self.assertEqual(self.req('POST',path,body,token)[0],200)
  self.assertEqual(Store(self.db).result(room['roomId'],token)['result'],body['result'])
  self.submit(room,room['members'][0]);self.assertIsNone(self.req('GET',path,token=token)[1]['result'])
  self.assertEqual(self.req('POST',path,body,token)[0],409)
 def test_private_access_and_origin(self):
  room=self.room();a,b=room['members'][:2];path=f"/rooms/{room['roomId']}/results"
  self.assertEqual(self.req('GET',path)[0],403)
  other=self.room();self.assertEqual(self.req('GET',path,token=other['ownerToken'])[0],403)
  fake=dict(b,submissionToken=a['submissionToken']);self.assertEqual(self.submit(room,fake)[0],403)
  code,payload,headers=self.req('GET',path,token=a['submissionToken']);self.assertEqual(code,200);self.assertNotIn('submissions',payload);self.assertEqual(headers['Access-Control-Allow-Origin'],'http://localhost:3000')
  self.assertEqual(self.req('GET',path,token=a['submissionToken'],origin='https://untrusted.example')[0],403)
 def test_room_meta_requires_room_token_and_hides_tokens(self):
  room=self.room();a=room['members'][0];path=f"/rooms/{room['roomId']}"
  self.assertEqual(self.req('GET',path)[0],403)
  self.assertEqual(self.req('GET',path,token=self.room()['ownerToken'])[0],403)
  code,data,_=self.req('GET',path,token=a['submissionToken'])
  self.assertEqual(code,200);self.assertEqual((data['startDate'],data['endDate']),('2026-10-01','2026-10-02'))
  self.assertEqual([m['name'] for m in data['members']],['조은','윤진','혜인'])
  self.assertNotIn('Token',json.dumps(data));self.assertNotIn('ownerToken',data)
 def test_validation_and_concurrent_writes(self):
  self.assertEqual(self.req('POST','/rooms',{'startDate':'2026-10-02','endDate':'2026-10-01','memberNames':['a','b']})[0],400)
  room=self.room()
  with concurrent.futures.ThreadPoolExecutor(3) as e:codes=list(e.map(lambda m:self.submit(room,m)[0],room['members']))
  self.assertEqual(codes,[200]*3)
  result=Store(self.db).result(room['roomId'],room['ownerToken']);self.assertEqual(result['revision'],3);self.assertEqual(result['submittedCount'],3)
 def test_result_rejects_private_input_fields(self):
  room=self.room()
  for m in room['members']:self.submit(room,m)
  code,_,_=self.req('POST',f"/rooms/{room['roomId']}/results",{'revision':3,'result':{'strategy':'fairness','days':[],'summary':'','submissions':[]}},room['ownerToken']);self.assertEqual(code,400)
 def test_calculation_uses_saved_inputs_and_persists(self):
  room=self.room();path=f"/rooms/{room['roomId']}"
  self.assertEqual(self.req('POST',path+'/calculate',{'strategy':'fairness'},room['ownerToken'])[0],409)
  for m in room['members']:self.submit(room,m)
  status,data,_=self.req('POST',path+'/calculate',{'strategy':'fairness'},room['ownerToken'])
  self.assertEqual(status,200);self.assertEqual(data['status'],'ready')
  self.assertEqual(len(data['result']['days']),2)
  self.assertTrue(any('glico' in day['placeIds'] for day in data['result']['days']))
  self.assertEqual(Store(self.db).result(room['roomId'],room['ownerToken'])['result'],data['result'])
  self.assertNotIn('budgetPerDay',json.dumps(data));self.assertNotIn('submissionToken',json.dumps(data))
  m=room['members'][0]
  body={'longlist':['umeda_sky'],'picks':['umeda_sky'],'must':'umeda_sky','veto':'glico','budgetPerDay':75000,'stepLimit':10000,'activeMin':480}
  self.assertEqual(self.req('PUT',path+'/submissions/'+m['id'],body,m['submissionToken'])[0],200)
  self.assertEqual(self.req('GET',path+'/results',token=room['ownerToken'])[1]['status'],'awaiting_result')
  status,data,_=self.req('POST',path+'/calculate',{'strategy':'fairness'},room['ownerToken'])
  self.assertEqual(status,200);self.assertTrue(all('glico' not in day['placeIds'] for day in data['result']['days']))
 def test_unknown_catalog_id_rejected(self):
  room=self.room();m=room['members'][0]
  body={'longlist':['unknown'],'picks':['unknown'],'must':None,'veto':None,'budgetPerDay':50000,'stepLimit':10000,'activeMin':480}
  self.assertEqual(self.req('PUT',f"/rooms/{room['roomId']}/submissions/{m['id']}",body,m['submissionToken'])[0],400)
 def test_new_snapshot_stale_calculation_cannot_overwrite(self):
  room=self.room()
  for m in room['members']:self.submit(room,m)
  store=Store(self.db);snapshot=store.snapshot(room['roomId'],room['ownerToken'])
  self.submit(room,room['members'][0])
  from server import ApiError
  with self.assertRaises(ApiError) as failure:store.save_result(room['roomId'],room['ownerToken'],{'revision':snapshot['revision'],'result':{'strategy':'fairness','days':[],'summary':'old'}})
  self.assertEqual(failure.exception.status,409)
if __name__=='__main__':unittest.main()
