"""Real-catalogue three-candidate API. Local HTTP/SQLite and Node; no paid services."""
import copy
import json
import os
import subprocess
import unittest
from unittest.mock import patch
import test_server
import test_real_engine
from candidate_engine import CandidateEngine
from engine import Engine, EngineError
from server import Store, ApiError

STRATEGIES=['average','least_misery','fairness']

class RealCandidatesTests(unittest.TestCase):
    req=test_server.ApiTests.req
    room=test_real_engine.RealRoomTests.room
    save=test_real_engine.RealRoomTests.save

    def setUp(self):
        self.env=patch.dict(os.environ,{**test_real_engine.FX,'OSRM_FOOT_URL':'','SOMSOM_API_KEY':'','AI_MOCK':''})
        self.env.start();self.addCleanup(self.env.stop)
        test_server.ApiTests.setUp(self)

    tearDown=test_server.ApiTests.tearDown

    def ready_room(self,**kwargs):
        room=self.room(count=3,**kwargs)
        for member in room['members']:
            self.assertEqual(self.save(room,member,['osaka_009','osaka_015'],must='osaka_009')[0],200)
        return room

    def calculate(self,room,revision=3,token=None):
        return self.req('POST',f"/rooms/{room['roomId']}/calculate",{'strategies':STRATEGIES,'revision':revision},room['ownerToken'] if token is None else token)

    def test_three_clients_select_persist_and_cache_same_real_candidates(self):
        room=self.ready_room();path=f"/rooms/{room['roomId']}"
        self.assertEqual(self.calculate(room,token=room['members'][1]['submissionToken'])[0],403)
        code,result,_=self.calculate(room)
        self.assertEqual(code,200);self.assertEqual(result['dataset'],'osaka_review_150')
        self.assertEqual(result['status'],'awaiting_selection')
        self.assertIsNone(result['planning'])
        for c in result['candidates']:
            self.assertEqual(c['planning']['scheduled_count'],sum(len(d['placeIds']) for d in c['days']))
            self.assertEqual(c['planning']['exchange_rate']['source'],test_real_engine.FX['JPY_TO_KRW_SOURCE'])
        self.assertEqual([c['strategy'] for c in result['candidates']],STRATEGIES)
        self.assertEqual(self.calculate(room)[1],result)
        selected={'strategy':'fairness','revision':3,'selectionVersion':0}
        self.assertEqual(self.req('PUT',path+'/selection',selected,room['members'][1]['submissionToken'])[0],403)
        code,result,_=self.req('PUT',path+'/selection',selected,room['ownerToken'])
        self.assertEqual(code,200);self.assertEqual(result['status'],'ready')
        self.assertEqual(result['planning'],result['candidates'][2]['planning'])
        self.assertIn(result['planning']['status'],('model_checks_passed','needs_review'))
        self.assertEqual(result['result']['days'],[{'date':d['date'],'placeIds':d['placeIds']} for d in result['candidates'][2]['days']])
        for member in room['members']:
            self.assertEqual(self.req('GET',path+'/results',token=member['submissionToken'])[1],result)
            self.assertEqual(Store(self.db).result(room['roomId'],member['submissionToken']),result)
        encoded=json.dumps(result)
        for private in ['submissions','participants','mustOf','budgetPerDay',room['ownerToken']]+[m['id'] for m in room['members']]:
            self.assertNotIn(private,encoded)
        self.assertEqual(self.req('PUT',path+'/selection',{**selected,'strategy':'average'},room['ownerToken'])[0],409)
        self.save(room,room['members'][0],['osaka_015'])
        self.assertEqual(self.req('GET',path+'/results',token=room['ownerToken'])[1]['candidates'],[])
        self.assertEqual(self.calculate(room)[0],409)
        self.assertEqual(self.calculate(room,revision=4)[0],200)

    def test_150_catalog_ids_submit_then_three_validated_candidates(self):
        room=self.room(count=6,start='2026-10-01',end='2026-10-07')
        places=self.req('GET','/api/places?limit=150')[1]['places'];self.assertEqual(len(places),150)
        ids={p['place_id'] for p in places}
        for i,m in enumerate(room['members']):
            self.assertEqual(self.save(room,m,[p['place_id'] for p in places[i*25:(i+1)*25]])[0],200)
        code,result,_=self.calculate(room,revision=6)
        self.assertEqual(code,200)
        for c in result['candidates']:
            selected=[id for d in c['days'] for id in d['placeIds']]
            self.assertTrue(selected);self.assertLess(len(selected),150)
            self.assertEqual(len(selected),len(set(selected)));self.assertTrue(set(selected)<=ids)
            self.assertIn('초안',c['summary'])

    def test_foreign_ids_bad_times_and_partial_bundles_are_not_published(self):
        room=self.ready_room();store=Store(self.db,Engine().catalog)
        good=CandidateEngine(Engine().node).calculate(store.snapshot(room['roomId'],room['ownerToken']))
        bad=copy.deepcopy(good);day=next(d for d in bad['candidates'][0]['days'] if d['placeIds'])
        day['placeIds'][0]=day['items'][0]['placeId']='glico'
        bad_time=copy.deepcopy(good);bad_time['candidates'][0]['days'][0]['items'][0]['endMin']=1441
        private=copy.deepcopy(good);private['candidates'][0]['planning']['submissions']=['private']
        wrong_count=copy.deepcopy(good);wrong_count['candidates'][0]['planning']['scheduled_count']=999
        for output in [bad,bad_time,private,wrong_count,{'candidates':good['candidates'][:2]}]:
            with patch.object(CandidateEngine,'calculate',return_value=output):
                self.assertEqual(self.calculate(room)[0],503)
            self.assertEqual(store.result(room['roomId'],room['ownerToken'])['candidates'],[])
        self.assertEqual(self.calculate(room)[0],200)

    def test_missing_fx_and_empty_candidates_fail_cleanly_then_retry(self):
        room=self.ready_room()
        with patch.dict(os.environ,{'JPY_TO_KRW_SOURCE':''}):
            code,result,_=self.calculate(room)
        self.assertEqual(code,503);self.assertIn('하나은행',result['error'])
        for m in room['members']:self.save(room,m,['osaka_001'])
        code,result,_=self.calculate(room,revision=6)
        self.assertEqual(code,503);self.assertIn('방문 날짜',result['error'])
        current=Store(self.db).result(room['roomId'],room['ownerToken'])
        self.assertEqual(current['status'],'awaiting_result');self.assertEqual(current['candidates'],[])
        for m in room['members']:self.save(room,m,['osaka_015'])
        self.assertEqual(self.calculate(room,revision=9)[0],200)

    def test_late_real_worker_cannot_publish_after_resubmission(self):
        room=self.ready_room();store=Store(self.db,Engine().catalog);rid=room['roomId'];token=room['ownerToken']
        state,job=store.begin_candidates(rid,token,3)
        output=CandidateEngine(Engine().node).calculate(store.snapshot(rid,token))
        self.save(room,room['members'][0],['osaka_015'])
        with self.assertRaises(ApiError) as failure:store.finish_candidates(rid,token,3,job,output)
        self.assertEqual(failure.exception.status,409)
        self.assertEqual(store.result(rid,token)['candidates'],[])


class CandidateFailureTests(unittest.TestCase):
    def test_marker_survives_node_warnings_without_matching_substrings_or_demo(self):
        with patch.dict(os.environ,test_real_engine.FX):
            for dataset,stderr,actionable in [
                ('osaka_review_150','(node:1) Warning: example\nNO_SCHEDULABLE_REAL_CANDIDATE\n',True),
                ('osaka_review_150','NO_SCHEDULABLE_REAL_CANDIDATE\nWarning: example\n',True),
                ('osaka_review_150','prefix_NO_SCHEDULABLE_REAL_CANDIDATE_suffix',False),
                ('prototype_demo_36','NO_SCHEDULABLE_REAL_CANDIDATE',False),
            ]:
                with self.subTest(dataset=dataset,stderr=stderr), patch('candidate_engine.subprocess.run',side_effect=subprocess.CalledProcessError(1,['node'],stderr=stderr)):
                    with self.assertRaises(EngineError) as failure:CandidateEngine('node').calculate({'dataset':dataset})
                    self.assertEqual('방문 날짜' in str(failure.exception),actionable)
