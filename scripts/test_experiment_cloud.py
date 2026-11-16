import http.client
import json
import threading
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import experiment_cloud as cloud
import experiment_share as share
import experiment_support as support
from test_experiment_share import SharedTests


class CloudTests(unittest.TestCase):
    def test_requires_explicit_code_identity_and_no_live_mock(self):
        env={'PUBLIC_ORIGIN':'https://experiment.example','EXPERIMENT_ADMIN_TOKEN':'x'*40,
             'EXPERIMENT_CODE_VERSION':'a'*40,'EXPERIMENT_MODE':'live',
             'GOOGLE_PLACES_API_KEY':'test','SOMSOM_API_KEY':'test'}
        with patch.dict('os.environ',env,clear=True):
            self.assertEqual(cloud.configuration()['active'],{'team'})
            with patch.dict('os.environ',{'LIVE_CHECK_MOCK':'pass'}):
                with self.assertRaises(ValueError):cloud.configuration()
            with patch.dict('os.environ',{'EXPERIMENT_SESSION':'../escape'}):
                with self.assertRaises(ValueError):cloud.configuration()
    def test_freeze_survives_restart_rejects_new_code_or_dates(self):
        cfg={'commit':'a'*40,'mode':'rehearsal','dates':['2026-11-16','2026-11-19']}
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            tokens=share.group_tokens(root,cloud.GROUP_META)
            cloud.freeze_bundle(root,cfg)
            before={p.name:p.read_bytes() for p in root.iterdir() if p.is_file()}
            cloud.freeze_bundle(root,cfg)
            self.assertEqual(tokens,share.group_tokens(root,cloud.GROUP_META))
            self.assertEqual(len(tokens),4)
            self.assertEqual(before,{p.name:p.read_bytes() for p in root.iterdir() if p.is_file()})
            for change in [{'commit':'b'*40},{'dates':['2026-11-17','2026-11-20']},{'mode':'live'}]:
                with self.assertRaises(ValueError):cloud.freeze_bundle(root,{**cfg,**change})
            self.assertEqual(before,{p.name:p.read_bytes() for p in root.iterdir() if p.is_file()})
    def test_partial_session_is_not_reinitialized(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'groups').mkdir()
            with self.assertRaises(ValueError):cloud.freeze_bundle(root,{'commit':'a'*40,'mode':'rehearsal','dates':['2026-11-16','2026-11-19']})


class ActivationTests(SharedTests):
    def test_inactive_group_is_setup_even_with_live_cookie(self):
        self.server.config['active_groups']={'joeun'}
        token=self.server.config['tokens']['hyein']
        self.assertEqual(self.request('/g/hyein/'+token)[0],200)
        self.assertEqual(self.request('/backend/rooms/room-hyein/calculate','hyein',method='POST',body='{}')[0],503)
        self.assertTrue(all(not s.seen for s in self.servers))

class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.server=share.SharedServer(('127.0.0.1',0),cloud.CloudGateway)
        self.origin=f'http://127.0.0.1:{self.server.server_port}'
        self.server.config={'origin':self.origin,'admin':'a'*40,'mode':'setup','session':'test',
            'commit':'b'*40,'dates':['2026-11-16','2026-11-19'],'bundle':Path(self.tmp.name),
            'active_groups':{'team'},'tokens':{g:g+'secret' for g in cloud.GROUPS},'processes':[]}
        threading.Thread(target=self.server.serve_forever,daemon=True).start()
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.tmp.cleanup()
    def request(self,path,headers=None,method='GET'):
        c=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=3)
        c.request(method,path,headers=headers or {})
        r=c.getresponse();result=(r.status,r.read());c.close();return result
    def test_health_is_public_but_private_metadata_requires_admin_and_origin(self):
        code,body=self.request('/healthz',{'Host':'healthcheck.railway.app'})
        self.assertEqual(code,200);self.assertEqual(json.loads(body),{'ok':True})
        for headers in [{},{'Authorization':'Bearer wrong'},{'Authorization':'Bearer '+'a'*40,'Origin':'https://evil.example'}]:
            self.assertEqual(self.request('/admin/status',headers)[0],403)
        code,body=self.request('/admin/status',{'Authorization':'Bearer '+'a'*40})
        self.assertEqual(code,200);self.assertEqual(len(json.loads(body)['groups']),4)
        self.assertEqual(self.request('/admin/status?token=anything',{'Authorization':'Bearer '+'a'*40})[0],404)
        self.assertEqual(self.request('/admin/status',{'Authorization':'Bearer '+'a'*40},'POST')[0],404)
    def test_dead_backend_makes_health_fail(self):
        class Stopped:
            def poll(self):return 1
        self.server.config['processes']=[Stopped()]
        self.assertEqual(self.request('/healthz')[0],503)

if __name__=='__main__':unittest.main()
