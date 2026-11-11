"""HTTP/SQLite H4 records with the real assignment bridge. External calls disabled."""
import json,os,unittest
from unittest.mock import patch
import test_candidates as base
from server import Store
from engine import Engine
class ExperimentResponsesTests(unittest.TestCase):
 req=base.SharedCandidatesTests.req
 submit_all=base.SharedCandidatesTests.submit_all
 calculate=base.SharedCandidatesTests.calculate
 def setUp(self):
  self.mode=patch.dict(os.environ,{'EXPERIMENT_SERVER':'1'});self.mode.start();base.SharedCandidatesTests.setUp(self)
  self.member=self.room['members'][0];self.ep=self.path+'/experiment/'+self.member['id'];self.token=self.member['submissionToken']
  self.pre={'kind':'pre','answers':{'consentConfirmed':True,'S1':'1-2','S2':'suggest','S3':3,'S4':False}}
 def tearDown(self):base.SharedCandidatesTests.tearDown(self);self.mode.stop()
 def get(self):return self.req('GET',self.ep,token=self.token)
 def put(self,b):return self.req('PUT',self.ep,b,self.token)
 def ready(self):
  self.assertEqual(self.put(self.pre)[0],200);self.submit_all();self.assertEqual(self.calculate()[0],200);return self.get()[1]
 def response(self,s,slot,kind='candidate'):
  b={'kind':kind,'letter':slot['letter'],'revision':s['revision'],'candidateHash':s['candidateHash']}
  if kind=='candidate':b['answers']={f'Q{i}':3 for i in range(1,10 if slot['explained'] else 9)}
  return b
 def test_disabled_and_private_auth(self):
  with patch.dict(os.environ,{'EXPERIMENT_SERVER':'0'}):self.assertEqual(self.get()[0],404)
  for token in ('',self.owner,self.room['members'][1]['submissionToken']):self.assertEqual(self.req('GET',self.ep,token=token)[0],403)
  s=self.get()[1];self.assertEqual(s['seat'],1);self.assertNotIn('strategy',json.dumps(s))
 def test_pre_validation_idempotence(self):
  for change in ({'consentConfirmed':False},{'S1':[]},{'S3':True},{'S4':'yes'}):self.assertEqual(self.put({'kind':'pre','answers':{**self.pre['answers'],**change}})[0],400)
  self.assertEqual(self.put(self.pre)[0],200);self.assertEqual(self.put(self.pre)[0],200)
  self.assertEqual(self.put({'kind':'pre','answers':{**self.pre['answers'],'S3':4}})[0],409)
 def test_pre_candidates_and_display_required(self):
  self.submit_all();self.calculate();s=self.get()[1];slot=s['slots'][0]
  self.assertEqual(self.put(self.response(s,slot,'view'))[0],409)
  self.put(self.pre);self.assertEqual(self.put(self.response(s,slot))[0],409)
  self.assertEqual(self.put({**self.response(s,slot,'view'),'candidateHash':'stale'})[0],409)
  self.assertEqual(self.put(self.response(s,slot,'view'))[0],200);self.assertEqual(self.put(self.response(s,slot))[0],200)
 def test_q9_scores_and_canonical_record(self):
  s=self.ready()
  for slot in s['slots']:
   self.put(self.response(s,slot,'view'));correct=self.response(s,slot);bad=json.loads(json.dumps(correct))
   if slot['explained']:bad['answers'].pop('Q9')
   else:bad['answers']['Q9']=3
   self.assertEqual(self.put(bad)[0],400)
   for value in (True,0,6,'3'):self.assertEqual(self.put({**correct,'answers':{**correct['answers'],'Q1':value}})[0],400)
   self.assertEqual(self.put(correct)[0],200);self.assertEqual(self.put(correct)[0],200)
   self.assertEqual(self.put({**correct,'answers':{**correct['answers'],'Q1':4}})[0],409)
  with self.store.connect() as c:rows=[json.loads(r[0]) for r in c.execute("SELECT payload FROM experiment_records WHERE kind='candidate'")]
  self.assertEqual(len(rows),3)
  for r in rows:
   self.assertEqual(r['automatic']['memberId'],self.member['id']);self.assertEqual(r['automatic']['pickRate'],1)
   self.assertEqual(r['candidate']['strategy'],r['strategy']);self.assertIn('group',r)
 def test_final_after_three_and_restart(self):
  s=self.ready();post={'kind':'post','revision':s['revision'],'candidateHash':s['candidateHash'],'answers':{'P1':['C','A','B'],'P2':'C','P3':4,'P4':'동선','P5':''}}
  self.assertEqual(self.put(post)[0],409)
  for slot in s['slots']:self.put(self.response(s,slot,'view'));self.put(self.response(s,slot))
  self.assertEqual(self.put({**post,'answers':{**post['answers'],'P1':['A','A','B']}})[0],400);self.assertEqual(self.put(post)[0],200)
  store=Store(self.db,Engine().catalog);store.experiment_node=Engine().node
  self.assertEqual(store.experiment(self.rid,self.member['id'],self.token)['post'],post['answers'])
 def test_revision_invalidates_current_answers_keeps_history(self):
  s=self.ready();slot=s['slots'][0];self.put(self.response(s,slot,'view'));self.put(self.response(s,slot))
  self.req('PUT',self.path+'/submissions/'+self.member['id'],{**self.body,'budgetPerDay':99999},self.token)
  self.assertEqual(self.put(self.response(s,slot))[0],409);self.assertEqual(self.get()[1]['answers'],{})
  with self.store.connect() as c:self.assertEqual(c.execute("SELECT count(*) FROM experiment_records WHERE kind='candidate'").fetchone()[0],1)
 def test_other_participant_room_isolation(self):
  self.put(self.pre);m=self.room['members'][1];self.assertIsNone(self.req('GET',self.path+'/experiment/'+m['id'],token=m['submissionToken'])[1]['pre'])
  room=self.req('POST','/rooms',{'startDate':'2026-11-16','endDate':'2026-11-19','memberNames':['a','b','c']})[1]
  self.assertEqual(self.req('GET','/rooms/'+room['roomId']+'/experiment/'+self.member['id'],token=self.token)[0],403)
 def test_owner_cannot_select(self):
  self.ready();self.assertEqual(self.req('PUT',self.path+'/selection',{'strategy':'fairness','revision':3,'selectionVersion':0},self.owner)[0],409)

 def test_cannot_add_experiment_seat(self):
  self.assertEqual(self.req('POST',self.path+'/join',{'name':'extra','pin':'1234'},self.room['inviteToken'])[0],409)
