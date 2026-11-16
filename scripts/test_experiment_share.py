import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

import experiment_share as share


class Upstream(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_GET(self):
        self.server.seen.append((self.path, dict(self.headers)))
        body = json.dumps({'group': self.server.group, 'path': self.path}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers(); self.wfile.write(body)
    do_POST = do_GET
    do_PUT = do_GET


class SharedTests(unittest.TestCase):
    def setUp(self):
        self.servers=[]
        self.server=share.SharedServer(('127.0.0.1',0),share.SharedGateway)
        self.origin=f'http://127.0.0.1:{self.server.server_port}'
        cfg={'origin':self.origin,'mode':'rehearsal','tokens':{},'upstreams':{},'joins':{},'rooms':{}}
        for group in share.GROUPS:
            up=ThreadingHTTPServer(('127.0.0.1',0),Upstream);up.group=group;up.seen=[]
            self.servers.append(up);threading.Thread(target=up.serve_forever,daemon=True).start()
            cfg['tokens'][group]=(group+'-'*32)[:32]
            cfg['upstreams'][group]=f'http://127.0.0.1:{up.server_port}'
            cfg['rooms'][group]='room-'+group
            cfg['joins'][group]=f'/join/?room=room-{group}&k=invite-{group}'
        self.server.config=cfg
        threading.Thread(target=self.server.serve_forever,daemon=True).start()
    def tearDown(self):
        for s in [self.server]+self.servers:s.shutdown();s.server_close()
    def request(self,path,group=None,method='GET',headers=None,body=None):
        h=dict(headers or {})
        if group:h['Cookie']=share.COOKIE+'='+self.server.config['tokens'][group]
        c=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=3)
        c.request(method,path,body,h);r=c.getresponse();result=(r.status,dict(r.getheaders()),r.read());c.close();return result
    def test_each_link_opens_only_its_participant_selector(self):
        for group in share.GROUPS:
            token=self.server.config['tokens'][group]
            status,headers,_=self.request(f'/g/{group}/{token}/')
            self.assertEqual(status,303)
            self.assertEqual(headers['Location'],self.server.config['joins'][group])
            self.assertIn('HttpOnly',headers['Set-Cookie'])
            self.assertIn('SameSite=Lax',headers['Set-Cookie'])
            status,_,body=self.request('/backend/rooms/room-'+group+'/results',group,headers={'Authorization':'Bearer participant'})
            self.assertEqual(status,200);self.assertEqual(json.loads(body)['group'],group)
    def test_other_group_room_is_blocked_before_upstream(self):
        self.assertEqual(self.request('/backend/rooms/room-hyein/results','joeun')[0],403)
        self.assertTrue(all(not s.seen for s in self.servers))
    def test_no_cookie_or_wrong_entry_key_cannot_see_rooms(self):
        for path in ['/entry/','/join/?room=room-hyein','/backend/api/places']:
            self.assertEqual(self.request(path)[0],403)
        self.assertEqual(self.request('/g/joeun/not-a-valid-key/')[0],404)
        self.assertTrue(all(not s.seen for s in self.servers))
    def test_setup_links_never_forward_inputs_or_expose_invites(self):
        self.server.config['mode']='setup';g='hyein';token=self.server.config['tokens'][g]
        status,_,body=self.request(f'/g/{g}/{token}/')
        self.assertEqual(status,200);self.assertIn('준비'.encode(),body);self.assertNotIn(b'invite-',body)
        self.assertEqual(self.request('/backend/rooms/room-hyein/calculate',g,method='POST',body='{}')[0],503)
        self.assertTrue(all(not s.seen for s in self.servers))
    def test_host_origin_and_encoded_traversal_are_rejected(self):
        self.assertEqual(self.request('/healthz',headers={'Host':'other.example'})[0],403)
        self.assertEqual(self.request('/healthz',headers={'Origin':'https://evil.example'})[0],403)
        for path in ['/../private','/%2e%2e/private','/\\private','http://evil.example/']:
            self.assertIn(self.request(path,'joeun')[0],(400,403))
    def test_clients_cannot_create_rooms_or_upload_results(self):
        for path in ['/backend/rooms','/backend/rooms/','/backend/rooms/room-joeun/results','/backend/rooms/room-joeun/selection']:
            self.assertEqual(self.request(path,'joeun',method='POST',body='{}')[0],409)
        self.assertTrue(all(not s.seen for s in self.servers))
    def test_auth_is_forwarded_only_to_group_but_gate_cookie_is_not(self):
        self.request('/backend/rooms/room-yunjin/results?test=1','yunjin',headers={'Authorization':'Bearer participant'})
        seen=self.servers[2].seen
        self.assertEqual(len(seen),1);self.assertEqual(seen[0][0],'/backend/rooms/room-yunjin/results?test=1')
        self.assertEqual(seen[0][1]['Authorization'],'Bearer participant')
        self.assertNotIn('Cookie',seen[0][1]);self.assertEqual(seen[0][1]['Origin'],self.server.config['upstreams']['yunjin'])
        self.assertFalse(self.servers[0].seen or self.servers[1].seen)
    def test_https_sets_secure_cookie_and_health_reveals_no_private_data(self):
        self.server.config['origin']='https://experiment.example'
        token=self.server.config['tokens']['joeun']
        status,headers,_=self.request(f'/g/joeun/{token}/',headers={'Host':'experiment.example'})
        self.assertEqual(status,303);self.assertIn('; Secure',headers['Set-Cookie'])
        status,_,body=self.request('/healthz',headers={'Host':'experiment.example'})
        self.assertEqual(body,b'{"ok":true}')
    def test_public_addresses_must_be_https_no_credentials_or_path(self):
        for bad in ['http://example.com','https://u:p@example.com','https://example.com/path','https://example.com?q=1','https://example.com#x']:
            with self.assertRaises(ValueError):share.origin(bad)
        self.assertEqual(share.origin('https://example.com/'),'https://example.com')
    def test_restarting_reuses_group_keys_without_touching_existing_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'records.sqlite3').write_bytes(b'existing')
            first=share.group_tokens(root);second=share.group_tokens(root)
            self.assertEqual(first,second);self.assertEqual(len(set(first.values())),3)
            self.assertEqual((root/'records.sqlite3').read_bytes(),b'existing')
            self.assertEqual((root/'public-groups.json').stat().st_mode&0o777,0o600)

if __name__=='__main__':unittest.main()
