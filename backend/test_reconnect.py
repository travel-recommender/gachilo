"""Three independent clients, persisted identities, and private-input boundaries."""
import concurrent.futures
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from server import make_server


class ReconnectTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / 'trips.sqlite3'
        self.start_server()

    def start_server(self):
        self.server = make_server(self.db, port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def tearDown(self):
        self.stop_server()
        self.tmp.cleanup()

    def req(self, method, path, token='', body=None, origin='http://localhost:3000'):
        request = urllib.request.Request(self.base + path, method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Origin': origin})
        try:
            response = urllib.request.urlopen(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response), response.headers

    def create(self, dataset='prototype_demo_36'):
        status, room, _ = self.req('POST', '/rooms', body={
            'startDate': '2026-10-10', 'endDate': '2026-10-10',
            'memberNames': ['조은', '윤진', '혜인'], 'dataset': dataset})
        self.assertEqual(status, 201)
        return room

    def submission_path(self, room, member):
        return f"/rooms/{room['roomId']}/submissions/{member['id']}"

    def input(self, place, budget=75000):
        return {'longlist': [place], 'picks': [place], 'must': place, 'veto': None,
                'budgetPerDay': budget, 'stepLimit': 15000, 'activeMin': 720}

    def test_three_clients_reconnect_after_server_restart_share_result(self):
        room = self.create()
        inputs = [self.input(p, 50000 + i * 10000) for i, p in enumerate(['glico', 'umeda_sky', 'kuromon'])]
        with concurrent.futures.ThreadPoolExecutor(3) as pool:
            responses = list(pool.map(lambda pair: self.req('PUT', self.submission_path(room, pair[0]),
                pair[0]['submissionToken'], pair[1]), zip(room['members'], inputs)))
        self.assertTrue(all(r[0] == 200 for r in responses))
        self.stop_server()
        self.start_server()
        for member, expected in zip(room['members'], inputs):
            status, data, headers = self.req('GET', self.submission_path(room, member), member['submissionToken'])
            self.assertEqual(status, 200)
            self.assertEqual(data['submission'], dict(expected, memberId=member['id']))
            self.assertEqual(data['revision'], 3)
            self.assertEqual(headers['Cache-Control'], 'no-store')
        root = '/rooms/' + room['roomId']
        status, calculated, _ = self.req('POST', root + '/calculate', room['ownerToken'], {'strategy': 'fairness'})
        self.assertEqual(status, 200)
        self.assertEqual(calculated['status'], 'ready')
        for member in room['members']:
            status, data, _ = self.req('GET', root + '/results', member['submissionToken'])
            self.assertEqual(status, 200)
            self.assertEqual(data, calculated)
            self.assertNotIn('budgetPerDay', json.dumps(data))
            self.assertNotIn('submissionToken', json.dumps(data))
        member = room['members'][0]
        self.req('PUT', self.submission_path(room, member), member['submissionToken'], self.input('hozenji'))
        for member in room['members']:
            data = self.req('GET', root + '/results', member['submissionToken'])[1]
            self.assertEqual(data['revision'], 4)
            self.assertIsNone(data['result'])

    def test_private_input_denies_owner_other_member_other_room_and_missing_token(self):
        room, other = self.create(), self.create()
        member = room['members'][0]
        path = self.submission_path(room, member)
        self.req('PUT', path, member['submissionToken'], self.input('glico'))
        for token in ['', room['ownerToken'], room['members'][1]['submissionToken'], other['members'][0]['submissionToken']]:
            with self.subTest(token_kind=token == room['ownerToken']):
                status, data, _ = self.req('GET', path, token)
                self.assertEqual(status, 403)
                self.assertEqual(set(data), {'error'})
        wrong_path = f"/rooms/{other['roomId']}/submissions/{member['id']}"
        self.assertEqual(self.req('GET', wrong_path, member['submissionToken'])[0], 403)
        self.assertEqual(self.req('GET', path, member['submissionToken'], origin='https://untrusted.example')[0], 403)

    def test_unsubmitted_identity_is_empty_not_someone_elses_input(self):
        room = self.create()
        a, b = room['members'][:2]
        self.req('PUT', self.submission_path(room, a), a['submissionToken'], self.input('glico'))
        status, data, _ = self.req('GET', self.submission_path(room, b), b['submissionToken'])
        self.assertEqual(status, 200)
        self.assertIsNone(data['submission'])
        self.assertEqual(data['memberId'], b['id'])

    def test_room_metadata_matches_frontend_v2_and_hides_inputs_and_tokens(self):
        for dataset in ['prototype_demo_36', 'osaka_review_150']:
            room = self.create(dataset)
            path = '/rooms/' + room['roomId']
            for token in [room['ownerToken'], room['members'][0]['submissionToken']]:
                status, data, _ = self.req('GET', path, token)
                self.assertEqual(status, 200)
                self.assertEqual(data['members'], [{'id': m['id'], 'name': m['name']} for m in room['members']])
                self.assertNotIn('Token', json.dumps(data))
                self.assertNotIn('picks', json.dumps(data))
                self.assertEqual(data.get('dataset', 'prototype_demo_36'), dataset)
            self.assertEqual(self.req('GET', path)[0], 403)
        self.assertEqual(self.req('GET', '/rooms/nonexistent', room['ownerToken'])[0], 404)

    def test_invite_page_and_modules_no_referrer_or_cache(self):
        for path in ['/join', '/join/', '/session.mjs', '/polling.mjs']:
            with urllib.request.urlopen(self.base + path) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers['Referrer-Policy'], 'no-referrer')
                self.assertEqual(response.headers['Cache-Control'], 'no-store')
                self.assertTrue(response.read())


if __name__ == '__main__':
    unittest.main()
