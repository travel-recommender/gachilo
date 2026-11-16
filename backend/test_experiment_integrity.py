"""Offline HTTP regression checks for fixed experiment inputs and one-room storage."""
import concurrent.futures
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch
from server import Store, make_server, ApiError
from engine import Engine

class ExperimentIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.env=patch.dict(os.environ,{'EXPERIMENT_SERVER':'1','SOMSOM_API_KEY':'','AI_MOCK':'','GOOGLE_PLACES_API_KEY':''})
        self.env.start();self.addCleanup(self.env.stop)
        self.db=Path(self.tmp.name)/'trips.sqlite3'
        self.server=make_server(self.db,port=0)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.addCleanup(self.close_server)
        self.base=f'http://127.0.0.1:{self.server.server_port}'
        self.room_body={'startDate':'2026-11-16','endDate':'2026-11-19','memberNames':['T-01','T-02','T-03']}
        self.room=self.req('POST','/rooms',self.room_body)[1]
        self.rid=self.room['roomId'];self.path='/rooms/'+self.rid
        self.ids=[p['id'] for p in Engine().catalog][:6]
        self.body={'longlist':self.ids,'picks':self.ids[:5],'must':self.ids[0],'veto':None,'budgetPerDay':100000,'stepLimit':30000,'activeMin':720}
    def close_server(self):
        self.server.shutdown();self.server.server_close();self.thread.join()
    def req(self,method,path,body=None,token=''):
        req=urllib.request.Request(self.base+path,method=method,data=json.dumps(body).encode() if body is not None else None,headers={'Origin':'http://localhost:3000','Content-Type':'application/json','Authorization':'Bearer '+token})
        try:
            with urllib.request.urlopen(req,timeout=30) as response:return response.status,json.load(response)
        except urllib.error.HTTPError as error:
            with error:return error.code,json.load(error)
    def submit(self,m,body=None):
        return self.req('PUT',self.path+'/submissions/'+m['id'],self.body if body is None else body,m['submissionToken'])
    def test_ready_candidates_survive_edits_and_restarted_store(self):
        for m in self.room['members']:
            self.assertEqual(self.req('PUT',self.path+'/longlists/'+m['id'],{'longlist':self.ids},m['submissionToken'])[0],200)
            self.assertEqual(self.submit(m)[0],200)
        code,ready=self.req('POST',self.path+'/calculate',{'strategies':['average','least_misery','fairness'],'revision':3},self.room['ownerToken'])
        self.assertEqual(code,200,ready);self.assertEqual(len(ready['candidates']),3)
        before=self.db.read_bytes()
        for m in self.room['members']:
            self.assertEqual(self.submit(m,{**self.body,'budgetPerDay':20000})[0],409)
            self.assertEqual(self.req('PUT',self.path+'/longlists/'+m['id'],{'longlist':self.ids[::-1]},m['submissionToken'])[0],409)
            self.assertEqual(self.req('GET',self.path+'/results',token=m['submissionToken'])[1],ready)
        self.assertEqual(self.db.read_bytes(),before)
        self.assertEqual(Store(self.db).result(self.rid,self.room['ownerToken']),ready)
    def test_experiment_counts_are_enforced_by_api_without_client(self):
        m=self.room['members'][0]
        for ids in [[],self.ids[:5],self.ids[:5]+self.ids[:1]]:
            self.assertEqual(self.req('PUT',self.path+'/longlists/'+m['id'],{'longlist':ids},m['submissionToken'])[0],400)
        for fields in [{'longlist':self.ids[:5]},{'picks':self.ids[:4]},{'picks':self.ids}]:
            self.assertEqual(self.submit(m,{**self.body,**fields})[0],400)
        self.assertEqual(self.submit(m)[0],200)
        self.assertEqual(self.submit(m,{**self.body,'budgetPerDay':20000})[0],200) # Retry/change before publication remains available.
    def test_second_room_rejected_without_changing_database(self):
        before=self.db.read_bytes()
        self.assertEqual(self.req('POST','/rooms',self.room_body)[0],409)
        self.assertEqual(self.db.read_bytes(),before)
    def test_simultaneous_bootstrap_creates_exactly_one_room(self):
        store=Store(Path(self.tmp.name)/'parallel.sqlite3')
        def create(_):
            try:store.create(self.room_body);return 201
            except ApiError as e:return e.status
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(sorted(pool.map(create,range(4))),[201,409,409,409])
    def test_normal_mode_can_create_multiple_rooms_and_use_short_lists(self):
        with patch.dict(os.environ,{'EXPERIMENT_SERVER':'0'}):
            self.assertEqual(self.req('POST','/rooms',self.room_body)[0],201)
            m=self.room['members'][0]
            self.assertEqual(self.submit(m,{**self.body,'longlist':self.ids[:1],'picks':self.ids[:1]})[0],200)

if __name__=='__main__':unittest.main()
