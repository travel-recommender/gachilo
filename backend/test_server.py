import concurrent.futures,json,tempfile,threading,unittest,urllib.request,urllib.error
from pathlib import Path
from server import make_server,Store
class ApiTests(unittest.TestCase):
 def test_planning_reason_module_is_served_to_the_result_screen(self):
  with urllib.request.urlopen(self.base+'/app.js') as response:
   self.assertIn("from '/planning-reasons.mjs'",response.read().decode())
  with urllib.request.urlopen(self.base+'/planning-reasons.mjs') as response:
   self.assertEqual(response.status,200)
   self.assertEqual(response.headers.get_content_type(),'text/javascript')
   self.assertIn('export function planningReasonLines',response.read().decode())
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
 def test_pool_merges_step_one_lists_without_names_or_revision(self):
  room=self.room();a,b,c=room['members'];rid=room['roomId'];pool=f"/rooms/{rid}/pool"
  put=lambda m,ids,token=None:self.req('PUT',f"/rooms/{rid}/longlists/{m['id']}",{'longlist':ids},token or m['submissionToken'])
  self.assertEqual(self.req('GET',pool,token=a['submissionToken'])[1]['listedCount'],0)
  self.assertEqual(put(a,['glico','kuromon'])[0],200);self.assertEqual(put(b,['umeda_sky','glico'])[0],200)
  self.assertEqual(put(c,['glico'],a['submissionToken'])[0],403)
  self.assertEqual(put(a,['no_such_place'])[0],400)
  got=self.req('GET',pool,token=b['submissionToken'])[1]
  self.assertEqual(got['listedCount'],2);self.assertEqual(got['memberCount'],3)
  self.assertEqual(got['placeIds'][0],'glico');self.assertEqual(set(got['placeIds']),{'glico','kuromon','umeda_sky'})
  self.assertEqual(set(got),{'roomId','listedCount','memberCount','placeIds'})
  self.assertEqual(self.req('GET',pool)[0],403)
  # A full submission counts as a list too, and step-1 lists never change the result revision
  self.assertEqual(self.req('GET',f"/rooms/{rid}/results",token=room['ownerToken'])[1]['revision'],0)
  self.submit(room,c);self.assertEqual(self.req('GET',pool,token=c['submissionToken'])[1]['listedCount'],3)
 def test_schedulable_lists_only_places_the_real_engine_can_use_on_trip_dates(self):
  real=self.req('POST','/rooms',{'startDate':'2026-10-01','endDate':'2026-10-03','memberNames':['조은','윤진'],'dataset':'osaka_review_150'})[1]
  path=f"/rooms/{real['roomId']}/schedulable"
  self.assertEqual(self.req('GET',path)[0],403)
  status,got,_=self.req('GET',path,token=real['members'][1]['submissionToken'])
  self.assertEqual(status,200);ids=set(got['placeIds'])
  self.assertIn('osaka_009',ids)  # 오사카성: 검토·운영 확인됨
  self.assertNotIn('osaka_draft_cdb260bb106a',ids)  # Google 지도상 폐업
  self.assertTrue(0<len(ids)<150)
  demo=self.room();self.assertIsNone(self.req('GET',f"/rooms/{demo['roomId']}/schedulable",token=demo['ownerToken'])[1]['placeIds'])
 def test_private_access_and_origin(self):
  room=self.room();a,b=room['members'][:2];path=f"/rooms/{room['roomId']}/results"
  self.assertEqual(self.req('GET',path)[0],403)
  other=self.room();self.assertEqual(self.req('GET',path,token=other['ownerToken'])[0],403)
  fake=dict(b,submissionToken=a['submissionToken']);self.assertEqual(self.submit(room,fake)[0],403)
  code,payload,headers=self.req('GET',path,token=a['submissionToken']);self.assertEqual(code,200);self.assertNotIn('submissions',payload);self.assertEqual(headers['Access-Control-Allow-Origin'],'http://localhost:3000')
  self.assertEqual(self.req('GET',path,token=a['submissionToken'],origin='https://untrusted.example')[0],403)
 def test_shared_invite_claims_each_name_once(self):
  room=self.room();rid=room['roomId'];invite=room['inviteToken'];path=f"/rooms/{rid}/join"
  self.assertEqual(self.req('GET',path)[0],403);self.assertEqual(self.req('GET',path,token=room['ownerToken'])[0],403)
  code,data,_=self.req('GET',path,token=invite)
  self.assertEqual(code,200);self.assertEqual([(m['name'],m['claimed']) for m in data['members']],[('조은',True),('윤진',False),('혜인',False)])
  self.assertNotIn('Token',json.dumps(data))
  creator,yoonjin=room['members'][:2]
  self.assertEqual(self.req('POST',path,{'memberId':creator['id']},invite)[0],409)
  code,seat,_=self.req('POST',path,{'memberId':yoonjin['id']},invite);self.assertEqual(code,200);self.assertEqual(seat['name'],'윤진')
  self.assertEqual(self.req('POST',path,{'memberId':yoonjin['id']},invite)[0],409)
  # The claimed seat gets a fresh token; the creator's copy of the old one stops working.
  self.assertEqual(self.submit(room,dict(yoonjin,submissionToken=seat['submissionToken']))[0],200)
  self.assertEqual(self.submit(room,yoonjin)[0],403)
  self.assertTrue([m for m in self.req('GET',path,token=invite)[1]['members'] if m['name']=='윤진'][0]['claimed'])
 def test_shared_invite_adds_new_name_and_invalidates_result(self):
  room=self.room();rid=room['roomId'];invite=room['inviteToken'];path=f"/rooms/{rid}/join"
  self.assertEqual(self.req('POST',path,{'name':'윤진'},invite)[0],409)
  self.assertEqual(self.req('POST',path,{'name':'민서','memberId':'x'},invite)[0],400)
  code,seat,_=self.req('POST',path,{'name':' 민서 '},invite);self.assertEqual(code,200);self.assertEqual(seat['name'],'민서')
  status=self.req('GET',f"/rooms/{rid}/results",token=room['ownerToken'])[1]
  self.assertEqual((status['memberCount'],status['revision']),(4,1))
  for n in ('도윤','하린'):self.assertEqual(self.req('POST',path,{'name':n},invite)[0],200)
  self.assertEqual(self.req('POST',path,{'name':'일곱'},invite)[0],409)
  self.assertEqual(self.req('POST',path,{'name':'a'},self.room()['inviteToken'])[0],403)
 def test_seat_used_by_personal_link_cannot_be_reclaimed(self):
  room=self.room();rid=room['roomId'];invite=room['inviteToken'];path=f"/rooms/{rid}/join"
  a,b,c=room['members']
  # 제출, 본인 입력 조회, 방 정보 조회 — 어느 쪽이든 개인 토큰을 쓰면 그 자리는 점유된다
  self.assertEqual(self.submit(room,b)[0],200)
  self.assertEqual(self.req('GET',f"/rooms/{rid}/submissions/{c['id']}",token=c['submissionToken'])[0],200)
  claimed={m['name']:m['claimed'] for m in self.req('GET',path,token=invite)[1]['members']}
  self.assertEqual(claimed,{'조은':True,'윤진':True,'혜인':True})
  for m in (b,c):self.assertEqual(self.req('POST',path,{'memberId':m['id']},invite)[0],409)
  # 원래 참여자는 계속 자기 토큰으로 쓸 수 있다
  self.assertEqual(self.req('GET',f"/rooms/{rid}/submissions/{b['id']}",token=b['submissionToken'])[0],200)
 def test_room_meta_with_personal_token_occupies_seat(self):
  room=self.room();rid=room['roomId']
  b=room['members'][1]
  self.assertEqual(self.req('GET',f"/rooms/{rid}",token=b['submissionToken'])[0],200)
  self.assertEqual(self.req('POST',f"/rooms/{rid}/join",{'memberId':b['id']},room['inviteToken'])[0],409)
  # 방장 토큰으로 보는 것은 아무 자리도 점유하지 않는다
  self.req('GET',f"/rooms/{rid}",token=room['ownerToken'])
  self.assertEqual(self.req('POST',f"/rooms/{rid}/join",{'memberId':room['members'][2]['id']},room['inviteToken'])[0],200)
 def test_concurrent_status_reads_by_different_members_never_fail(self):
  # PR #36 재리뷰: 읽기 트랜잭션 안에서 점유 UPDATE로 올라가면 동시 조회끼리 잠금이 충돌해 503이 났다
  room=self.room();rid=room['roomId'];path=f"/rooms/{rid}/results"
  for m in room['members']:self.assertEqual(self.submit(room,m)[0],200)  # 세 자리 모두 점유된 상태
  tokens=[m['submissionToken'] for m in room['members']]*34
  with concurrent.futures.ThreadPoolExecutor(3) as e:codes=list(e.map(lambda t:self.req('GET',path,token=t)[0],tokens))
  self.assertEqual(codes.count(200),len(tokens),codes)
 def test_concurrent_first_reads_occupy_without_lock_errors(self):
  # 아직 점유되지 않은 자리들을 각자 처음 조회할 때도 503 없이 모두 점유된다
  for _ in range(5):
   room=self.room();rid=room['roomId']
   calls=[(f"/rooms/{rid}",m['submissionToken']) for m in room['members'][1:]]*6+[(f"/rooms/{rid}/results",m['submissionToken']) for m in room['members'][1:]]*6
   with concurrent.futures.ThreadPoolExecutor(4) as e:codes=list(e.map(lambda a:self.req('GET',a[0],token=a[1])[0],calls))
   self.assertEqual(set(codes),{200},codes)
   self.assertTrue(all(m['claimed'] for m in self.req('GET',f"/rooms/{rid}/join",token=room['inviteToken'])[1]['members']))
 def test_first_personal_access_and_shared_claim_race(self):
  # 개인 링크 첫 접속과 공용 링크 선택이 겹쳐도: 잠금 오류가 없고, 둘 다 같은 자리를 계속 쓰는 일은 없다
  for _ in range(10):
   room=self.room();rid=room['roomId'];b=room['members'][1]
   with concurrent.futures.ThreadPoolExecutor(2) as e:
    read=e.submit(self.req,'GET',f"/rooms/{rid}",None,b['submissionToken'])
    pick=e.submit(self.req,'POST',f"/rooms/{rid}/join",{'memberId':b['id']},room['inviteToken'])
    rc,pc=read.result()[0],pick.result()[0]
   self.assertIn(rc,(200,403));self.assertIn(pc,(200,409))
   later=self.req('GET',f"/rooms/{rid}",token=b['submissionToken'])[0]
   # 공용 링크로 자리를 가져갔다면 예전 개인 토큰은 더는 못 쓴다. 못 가져갔다면 개인 토큰이 계속 쓰인다
   self.assertEqual(later,403 if pc==200 else 200)
 def test_submit_and_shared_claim_never_both_win(self):
  # 비공개 입력이 생기는 제출은 같은 쓰기 트랜잭션에서 점유한다. 제출과 공용 선택이 둘 다 성공하면 안 된다
  for _ in range(10):
   room=self.room();rid=room['roomId'];b=room['members'][1]
   with concurrent.futures.ThreadPoolExecutor(2) as e:
    sub=e.submit(self.submit,room,b)
    pick=e.submit(self.req,'POST',f"/rooms/{rid}/join",{'memberId':b['id']},room['inviteToken'])
    sc,pc=sub.result()[0],pick.result()[0]
   self.assertIn(sc,(200,403));self.assertIn(pc,(200,409))
   self.assertFalse(sc==200 and pc==200)
 def pin_room(self):
  return self.req('POST','/rooms',{'startDate':'2026-10-01','endDate':'2026-10-02','memberNames':['조은','윤진','혜인'],'ownerPin':'1234'})[1]
 def test_rejoin_with_pin_restores_seat_and_signs_out_old_device(self):
  room=self.pin_room();rid=room['roomId'];k=room['inviteToken'];b=room['members'][1]
  code,seat,_=self.req('POST',f"/rooms/{rid}/join",{'memberId':b['id'],'pin':'4821'},k);self.assertEqual(code,200)
  self.assertEqual(self.submit(room,dict(b,submissionToken=seat['submissionToken']))[0],200)
  info=self.req('GET',f"/rooms/{rid}/join",token=k)[1]
  self.assertEqual([m['hasPin'] for m in info['members']],[True,True,False]);self.assertNotIn('pin',json.dumps(info).lower().replace('haspin',''))
  code,again,_=self.req('POST',f"/rooms/{rid}/rejoin",{'memberId':b['id'],'pin':'4821'},k)
  self.assertEqual(code,200);self.assertEqual(again['name'],'윤진');self.assertNotIn('ownerToken',again)
  # 새 기기 토큰으로 본인 입력이 복원되고, 이전 기기 토큰은 끊긴다
  self.assertEqual(self.req('GET',f"/rooms/{rid}/submissions/{b['id']}",token=again['submissionToken'])[1]['submission']['must'],'glico')
  self.assertEqual(self.req('GET',f"/rooms/{rid}/submissions/{b['id']}",token=seat['submissionToken'])[0],403)
 def test_rejoin_round_trip_between_two_devices(self):
  # A에서 고름 → B가 PIN으로 재접속(A 끊김) → A가 PIN으로 다시 재접속(B 끊김)
  room=self.pin_room();rid=room['roomId'];k=room['inviteToken'];b=room['members'][1];path=f"/rooms/{rid}/submissions/{b['id']}"
  a1=self.req('POST',f"/rooms/{rid}/join",{'memberId':b['id'],'pin':'4821'},k)[1]['submissionToken']
  b1=self.req('POST',f"/rooms/{rid}/rejoin",{'memberId':b['id'],'pin':'4821'},k)[1]['submissionToken']
  self.assertEqual(self.req('GET',path,token=a1)[0],403)
  code,seat,_=self.req('POST',f"/rooms/{rid}/rejoin",{'memberId':b['id'],'pin':'4821'},k);self.assertEqual(code,200)
  self.assertEqual(self.req('GET',path,token=seat['submissionToken'])[0],200)
  self.assertEqual(self.req('GET',path,token=b1)[0],403)
  self.assertEqual(self.req('GET',path,token=a1)[0],403)
 def test_rejoin_wrong_pin_counts_down_and_locks(self):
  room=self.pin_room();rid=room['roomId'];k=room['inviteToken'];b=room['members'][1]
  self.req('POST',f"/rooms/{rid}/join",{'memberId':b['id'],'pin':'4821'},k)
  for left in (4,3,2,1):
   code,body,_=self.req('POST',f"/rooms/{rid}/rejoin",{'memberId':b['id'],'pin':'0000'},k)
   self.assertEqual(code,403);self.assertIn(f'{left}번',body['error'])
  self.assertEqual(self.req('POST',f"/rooms/{rid}/rejoin",{'memberId':b['id'],'pin':'0000'},k)[0],429)
  # 잠긴 동안에는 맞는 PIN도 막힌다
  self.assertEqual(self.req('POST',f"/rooms/{rid}/rejoin",{'memberId':b['id'],'pin':'4821'},k)[0],429)
  from datetime import datetime,timezone,timedelta
  with Store(self.db).connect() as c:c.execute('UPDATE members SET pin_locked_until=? WHERE id=?',((datetime.now(timezone.utc)-timedelta(seconds=1)).isoformat(),b['id']))
  self.assertEqual(self.req('POST',f"/rooms/{rid}/rejoin",{'memberId':b['id'],'pin':'4821'},k)[0],200)
 def test_owner_rejoin_returns_new_owner_token(self):
  room=self.pin_room();rid=room['roomId'];k=room['inviteToken'];owner=room['members'][0]
  code,seat,_=self.req('POST',f"/rooms/{rid}/rejoin",{'memberId':owner['id'],'pin':'1234'},k)
  self.assertEqual(code,200);self.assertIn('ownerToken',seat)
  path=f"/rooms/{rid}/results"
  self.assertEqual(self.req('GET',path,token=seat['ownerToken'])[0],200)
  # 이전 방장 토큰으로는 방장 작업(계산)을 할 수 없다
  self.assertEqual(self.req('POST',f"/rooms/{rid}/calculate",{'strategies':['average','least_misery','fairness'],'revision':0},room['ownerToken'])[0],403)
 def test_rejoin_rules_and_pin_format(self):
  room=self.pin_room();rid=room['roomId'];k=room['inviteToken'];b,c=room['members'][1:]
  self.assertEqual(self.req('POST',f"/rooms/{rid}/rejoin",{'memberId':b['id'],'pin':'1111'},k)[0],409)  # 아직 아무도 안 고른 이름
  self.req('POST',f"/rooms/{rid}/join",{'memberId':c['id']},k)  # PIN 없이 고른 자리
  self.assertEqual(self.req('POST',f"/rooms/{rid}/rejoin",{'memberId':c['id'],'pin':'1111'},k)[0],409)
  for bad in ('123','12a4',1234,'12345'):
   self.assertEqual(self.req('POST',f"/rooms/{rid}/join",{'memberId':b['id'],'pin':bad},k)[0],400)
  self.assertEqual(self.req('POST','/rooms',{'startDate':'2026-10-01','endDate':'2026-10-02','memberNames':['a','b'],'ownerPin':'12'})[0],400)
  self.assertEqual(self.req('POST',f"/rooms/{rid}/rejoin",{'memberId':b['id'],'pin':'1111'},room['ownerToken'])[0],403)  # 초대 토큰이 아님
 def test_duplicate_names_rejected_at_creation(self):
  self.assertEqual(self.req('POST','/rooms',{'startDate':'2026-10-01','endDate':'2026-10-02','memberNames':['혜인',' 혜인']})[0],400)
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
