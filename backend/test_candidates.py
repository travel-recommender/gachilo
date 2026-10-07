"""Real HTTP clients and SQLite. All tests are offline; no model requests."""
import concurrent.futures
import copy
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch
from server import Store, make_server, ApiError
from candidate_engine import CandidateEngine
from engine import Engine, EngineError

STRATEGIES = ['average', 'least_misery', 'fairness']


class SharedCandidatesTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'SOMSOM_API_KEY':'','AI_MOCK':''})
        self.env.start()
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name)/'trips.sqlite3'
        self.server = make_server(self.db,port=0)
        self.thread = threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'
        self.room = self.req('POST','/rooms',{'startDate':'2026-10-07','endDate':'2026-10-08','memberNames':['Owner','Guest1','Guest2']})[1]
        self.rid = self.room['roomId']
        self.path = '/rooms/'+self.rid
        self.owner = self.room['ownerToken']
        self.store = Store(self.db,Engine().catalog)
        self.body = {'longlist':['glico','umeda_sky'],'picks':['glico'],'must':'glico','veto':None,'budgetPerDay':50000,'stepLimit':10000,'activeMin':480}

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
        self.tmp.cleanup(); self.env.stop()

    def req(self,method,path,body=None,token=''):
        request = urllib.request.Request(self.base+path,method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'Content-Type':'application/json','Authorization':'Bearer '+token,'Origin':'http://localhost:3000'})
        try:
            with urllib.request.urlopen(request,timeout=15) as response:return response.status,json.load(response)
        except urllib.error.HTTPError as error:
            try:return error.code,json.load(error)
            finally:error.close()

    def submit_all(self):
        for i,m in enumerate(self.room['members']):
            place=['glico','umeda_sky','osaka_castle'][i]
            body={**self.body,'longlist':[place],'picks':[place],'must':place,'budgetPerDay':50000+i*10000}
            self.assertEqual(self.req('PUT',self.path+'/submissions/'+m['id'],body,m['submissionToken'])[0],200)

    def calculate(self,revision=3,token=None):
        return self.req('POST',self.path+'/calculate',{'strategies':STRATEGIES,'revision':revision},self.owner if token is None else token)

    def select(self,strategy='fairness',version=0,revision=3,token=None):
        return self.req('PUT',self.path+'/selection',{'strategy':strategy,'revision':revision,'selectionVersion':version},self.owner if token is None else token)

    def test_three_clients_same_candidates_selection_and_restart(self):
        self.submit_all()
        code,payload=self.calculate()
        self.assertEqual(code,200);self.assertEqual(payload['status'],'awaiting_selection')
        self.assertIsNone(payload['result']);self.assertEqual(len(payload['candidates']),3)
        self.assertEqual(self.select(token=self.room['members'][1]['submissionToken'])[0],403)
        code,selected=self.select()
        self.assertEqual(code,200);self.assertEqual(selected['status'],'ready')
        self.assertEqual(selected['selectedStrategy'],'fairness');self.assertEqual(selected['selectionVersion'],1)
        for member in self.room['members']:
            self.assertEqual(self.req('GET',self.path+'/results',token=member['submissionToken'])[1],selected)
            self.assertEqual(Store(self.db).result(self.rid,member['submissionToken']),selected)
        encoded=json.dumps(selected)
        for private in [self.owner]+[m['id'] for m in self.room['members']]+['participants','mustOf','budgetPerDay']:
            self.assertNotIn(private,encoded)
        self.assertEqual(self.select()[1],selected) # Idempotent retry after response loss.
        self.assertEqual(self.select('average',0)[0],409)
        self.assertEqual(self.select('average',1)[1]['selectionVersion'],2)
        self.assertEqual(self.calculate()[1]['selectedStrategy'],'average') # Cached calculation preserves selection.

    def test_permission_missing_submissions_and_supported_dataset(self):
        self.assertEqual(self.calculate()[0],409)
        self.submit_all()
        self.assertEqual(self.calculate(token=self.room['members'][0]['submissionToken'])[0],403)
        self.assertEqual(self.calculate(token='')[0],403)
        self.assertEqual(self.req('GET',self.path+'/results',token='wrong')[0],403)
        self.assertEqual(self.calculate(2)[0],409)
        with self.store.connect() as c:c.execute("UPDATE rooms SET dataset='osaka_review_150' WHERE id=?",(self.rid,))
        self.assertEqual(self.calculate()[0],400)

    def test_auto_calculation_concurrency_coalesces_and_caches(self):
        self.submit_all()
        real=CandidateEngine.calculate;started=threading.Event();release=threading.Event()
        def slow(engine,snapshot):
            self.assertEqual([s['picks'] for s in snapshot['submissions']],[['glico'],['umeda_sky'],['osaka_castle']])
            started.set();self.assertTrue(release.wait(5));return real(engine,snapshot)
        with patch.object(CandidateEngine,'calculate',autospec=True,side_effect=slow) as mocked:
            with concurrent.futures.ThreadPoolExecutor() as pool:
                first=pool.submit(self.calculate)
                try:
                    self.assertTrue(started.wait(5))
                    code,busy=self.calculate()
                    self.assertEqual(code,202);self.assertEqual(busy['status'],'calculating');self.assertEqual(busy['candidates'],[])
                finally:release.set()
                self.assertEqual(first.result()[0],200)
            self.assertEqual(self.calculate()[0],200);self.assertEqual(mocked.call_count,1)

    def test_changed_input_discards_whole_bundle_and_selection(self):
        self.submit_all(); self.calculate(); self.select()
        member=self.room['members'][0]
        self.req('PUT',self.path+'/submissions/'+member['id'],self.body,member['submissionToken'])
        current=self.req('GET',self.path+'/results',token=self.owner)[1]
        self.assertEqual(current['revision'],4);self.assertEqual(current['candidates'],[])
        self.assertIsNone(current['selectedStrategy']);self.assertIsNone(current['result'])
        self.assertEqual(self.select()[0],409)
        state,job=self.store.begin_candidates(self.rid,self.owner,4)
        snapshot=self.store.snapshot(self.rid,self.owner)
        output=CandidateEngine(Engine().node).calculate(snapshot)
        self.store.submit(self.rid,member['id'],member['submissionToken'],self.body)
        with self.assertRaises(ApiError) as failure:self.store.finish_candidates(self.rid,self.owner,4,job,output)
        self.assertEqual(failure.exception.status,409)
        self.assertEqual(self.store.result(self.rid,self.owner)['candidates'],[])

    def test_failure_has_no_partial_candidates_and_is_retryable(self):
        self.submit_all()
        with patch.object(CandidateEngine,'calculate',side_effect=EngineError('offline')):
            self.assertEqual(self.calculate()[0],503)
        self.assertEqual(self.store.result(self.rid,self.owner)['status'],'awaiting_result')
        output=CandidateEngine(Engine().node).calculate(self.store.snapshot(self.rid,self.owner))
        bad=copy.deepcopy(output);bad['candidates'][0]['submissions']=['private']
        with patch.object(CandidateEngine,'calculate',return_value=bad):self.assertEqual(self.calculate()[0],503)
        self.assertEqual(self.store.result(self.rid,self.owner)['candidates'],[])
        self.assertEqual(self.calculate()[0],200)

    def test_expired_worker_cannot_overwrite_replacement_and_legacy_cannot_clobber_bundle(self):
        self.submit_all()
        _,old=self.store.begin_candidates(self.rid,self.owner,3)
        with self.store.connect() as c:c.execute('UPDATE candidate_jobs SET expires=0')
        _,new=self.store.begin_candidates(self.rid,self.owner,3)
        output=CandidateEngine(Engine().node).calculate(self.store.snapshot(self.rid,self.owner))
        with self.assertRaises(ApiError):self.store.finish_candidates(self.rid,self.owner,3,old,output)
        self.store.abandon_candidates(self.rid,old)
        self.assertEqual(self.store.result(self.rid,self.owner)['status'],'calculating')
        self.store.finish_candidates(self.rid,self.owner,3,new,output)
        self.assertEqual(self.req('POST',self.path+'/calculate',{'strategy':'fairness'},self.owner)[0],409)
        self.assertEqual(self.req('POST',self.path+'/results',{'revision':3,'result':{'strategy':'average','days':[],'summary':'old client'}},self.owner)[0],409)


if __name__=='__main__':unittest.main()
