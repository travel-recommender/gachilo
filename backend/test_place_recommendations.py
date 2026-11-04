"""Synthetic counts and temporary HTTP/SQLite only; no real-user popularity."""
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

from api_errors import ApiError
from co_picks import DEMO_DATASET, REAL_DATASET
from engine import EngineError
from place_recommendations import area_key, rank_places
from server import Store, make_server


def place(pid, area='난바', category='food'):
    return {'id': pid, 'name': pid, 'area': area, 'areaKey': area, 'category': category}


class RankingTests(unittest.TestCase):
    def test_count_then_affinity_then_stable_id_and_no_duplicates(self):
        places = {p['id']: p for p in [place('s'), place('b'), place('a'), place('far', '우메다', 'cafe')]}
        counts = {'pairs': [{'placeIds': ['s', pid], 'listCount': n} for pid, n in [('a', 3), ('b', 3), ('far', 4)]]}
        got = rank_places('s', places, counts, set(places), set(), 10)
        self.assertEqual([x['placeId'] for x in got], ['far', 'a', 'b'])
        self.assertEqual([x['coPickCount'] for x in got], [4, 3, 3])
        self.assertTrue(all(x['reason'] == 'co_pick' for x in got))

    def test_sparse_fills_area_category_then_area_then_category(self):
        places = {p['id']: p for p in [place('s'), place('both'), place('area', category='cafe'),
                                      place('category', '우메다'), place('unrelated', '우메다', 'cafe')]}
        got = rank_places('s', places, {'pairs': []}, set(places), set(), 10)
        self.assertEqual([x['placeId'] for x in got], ['both', 'area', 'category'])
        self.assertEqual([x['reason'] for x in got], ['same_area_category', 'same_area', 'same_category'])
        self.assertTrue(all(x['coPickCount'] == 0 for x in got))

    def test_filter_before_top_n_and_fill(self):
        places = {p['id']: p for p in [place('s'), place('saved'), place('closed'), place('ok'), place('last')]}
        counts = {'pairs': [{'placeIds': ['s', p], 'listCount': 20} for p in ['saved', 'closed']]}
        got = rank_places('s', places, counts, {'s', 'saved', 'ok', 'last'}, {'saved'}, 1)
        self.assertEqual([x['placeId'] for x in got], ['last'])

    def test_missing_metadata_is_not_a_match(self):
        places = {p['id']: p for p in [place('s', None, None), place('other', None, None)]}
        self.assertEqual(rank_places('s', places, {'pairs': []}, set(places), set(), 3), [])

    def test_area_normalizes_verified_address_ward_across_old_new_rows(self):
        old = {'area': '大阪市中央区'}
        branch = {'area': '난바·도톤보리', 'address': '大阪府 大阪市中央区 道頓堀１丁目'}
        self.assertEqual(area_key(old), area_key(branch))
        self.assertNotEqual(area_key(old), area_key({'area': '大阪市北区'}))
        self.assertIsNone(area_key({}))


class RecommendationStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = Path(self.tmp.name) / 'test.sqlite3'
        self.demo = json.loads((Path(__file__).parent / 'engine/catalog.json').read_text())
        self.store = Store(self.db, self.demo)
        self.room = self.create()

    def create(self, dataset=DEMO_DATASET):
        return self.store.create({'startDate': '2026-11-10', 'endDate': '2026-11-11',
                                  'dataset': dataset, 'memberNames': ['A', 'B', 'C']})

    def save(self, index, ids, room=None):
        room = room or self.room
        m = room['members'][index]
        self.store.save_longlist(room['roomId'], m['id'], m['submissionToken'], {'longlist': ids})

    def recommend(self, body=None, room=None):
        room = room or self.room
        m = room['members'][0]
        return self.store.recommend_places(room['roomId'], m['id'], m['submissionToken'],
                                           body or {'placeId': 'glico'})

    def test_live_counts_exclude_own_room_threshold_and_refresh(self):
        # Own room cannot be used to probe other rooms with injected votes.
        for i in range(3):
            self.save(i, ['glico', 'kuromon'])
        self.assertTrue(all(x['coPickCount'] == 0 for x in self.recommend()['recommendations']))
        self.save(0, ['glico'])
        other = self.create()
        for i in range(3):
            self.save(i, ['glico', 'kuromon'], other)
            self.save(i, ['kuromon', 'glico'], other)
            got = self.recommend()['recommendations']
            if i < 2:
                self.assertTrue(all(x['coPickCount'] == 0 for x in got))
        self.assertEqual(got[0]['placeId'], 'kuromon')
        self.assertEqual(got[0]['coPickCount'], 3)
        self.save(1, [], other)
        self.assertTrue(all(x['coPickCount'] == 0 for x in self.recommend()['recommendations']))

    def test_foreign_corruption_is_skipped_and_only_count_logged(self):
        other = self.create()
        with self.store.connect() as c:
            c.execute('INSERT INTO longlists VALUES(?,?,?)', (other['members'][0]['id'], '{private-corrupt-value', 'test'))
        with self.assertLogs('co_picks', level='WARNING') as logs:
            got = self.recommend()
        self.assertIsInstance(got['recommendations'], list)
        self.assertEqual(got['eligibility'], 'at_least_one_trip_date')
        self.assertEqual(len(logs.output), 1)
        self.assertIn('1개 제외', logs.output[0])
        self.assertNotIn('private-corrupt', logs.output[0])
        self.assertNotIn(other['roomId'], logs.output[0])

    def test_request_reuses_initialized_catalog_and_only_counts_source(self):
        with patch('pathlib.Path.read_text', side_effect=AssertionError('request reread catalog')), \
             patch('co_picks.combinations', side_effect=AssertionError('all-pairs work')):
            self.assertTrue(self.recommend()['recommendations'])

    def test_server_and_unsaved_exclusions_are_both_applied(self):
        self.save(0, ['glico', 'hozenji'])
        self.save(1, ['glico', 'hozenji', 'kuromon'])
        got = self.recommend({'placeId': 'glico', 'limit': 10, 'excludePlaceIds': ['kuromon', 'kuromon', 'custom_x']})
        self.assertTrue({'glico', 'hozenji', 'kuromon'}.isdisjoint(x['placeId'] for x in got['recommendations']))
        self.assertEqual(got['countUnit'], 'room_member_list')
        self.assertEqual(got['eligibility'], 'demo_unverified')

    def test_legacy_submission_excluded_but_explicit_empty_p3_wins(self):
        m = self.room['members'][0]
        self.store.submit(self.room['roomId'], m['id'], m['submissionToken'],
                          {'longlist': ['hozenji'], 'picks': [], 'must': None, 'veto': None,
                           'budgetPerDay': 50000, 'stepLimit': 10000, 'activeMin': 480})
        self.assertNotIn('hozenji', [x['placeId'] for x in self.recommend()['recommendations']])
        self.save(0, [])
        self.assertEqual(self.recommend()['recommendations'][0]['placeId'], 'hozenji')

    def test_global_dataset_counts_but_no_cross_member_pairs(self):
        other = self.create()
        self.save(1, ['glico'], other)
        self.save(2, ['kuromon'], other)
        self.assertTrue(all(x['coPickCount'] == 0 for x in self.recommend()['recommendations']))
        for i in range(3):
            self.save(i, ['glico', 'kuromon'], other)
        self.assertEqual(self.recommend()['recommendations'][0]['placeId'], 'kuromon')
        # Even legacy dirty IDs from a different dataset cannot influence demo counts.
        real = self.create(REAL_DATASET)
        with self.store.connect() as c:
            c.execute('INSERT INTO longlists VALUES(?,?,?)', (real['members'][1]['id'], '["glico","umeda_sky"]', 'test'))
        self.assertEqual(self.recommend()['recommendations'][0]['coPickCount'], 3)

    def test_auth_is_member_specific_and_precedes_work(self):
        a, b = self.room['members'][:2]
        foreign = self.create()['members'][0]
        with patch('place_recommendations.source_counts_from_connection') as loader:
            for token in ['', 'bad', self.room['ownerToken'], b['submissionToken'], foreign['submissionToken']]:
                with self.subTest(token=bool(token)), self.assertRaises(ApiError) as caught:
                    self.store.recommend_places(self.room['roomId'], a['id'], token, {'placeId': 'glico'})
                self.assertEqual(caught.exception.status, 403)
            loader.assert_not_called()

    def test_validation_limits_and_unknown_source(self):
        for body in [[], {}, {'placeId': None}, {'placeId': 'x' * 101}, {'placeId': 'not_known'},
                     {'placeId': 'osaka_001'}, {'placeId': 'custom_x'},
                     *[{'placeId': 'glico', 'limit': v} for v in [0, 11, True, '3', 1.5, None]],
                     *[{'placeId': 'glico', 'excludePlaceIds': v} for v in [None, 'glico', [''] , [1], ['a'] * 31]],
                     {'placeId': 'glico', 'extra': 1}]:
            with self.subTest(body=body), self.assertRaises(ApiError) as caught:
                m = self.room['members'][0]
                self.store.recommend_places(self.room['roomId'], m['id'], m['submissionToken'], body)
            self.assertEqual(caught.exception.status, 400)

    def test_reads_do_not_mutate_lists_submissions_or_results(self):
        self.save(0, ['glico'])
        self.save(1, ['glico', 'kuromon'])
        with self.store.connect() as c:
            before = '\n'.join(c.iterdump())
        self.recommend()
        with self.store.connect() as c:
            self.assertEqual('\n'.join(c.iterdump()), before)

    def test_corrupt_data_is_503_not_fabricated_fallback(self):
        with self.store.connect() as c:
            c.execute('INSERT INTO longlists VALUES(?,?,?)', (self.room['members'][1]['id'], '{broken', 'test'))
        with self.assertRaises(ApiError) as caught:
            self.recommend()
        self.assertEqual(caught.exception.status, 503)
        self.assertNotIn('broken', caught.exception.message)

    def test_real_filter_all_recommendations_and_fail_closed_without_worker(self):
        real = self.create(REAL_DATASET)
        self.save(1, ['osaka_001', 'osaka_009'], real)
        with self.assertRaises(EngineError):
            self.recommend({'placeId': 'osaka_001'}, real)
        self.store.date_availability = lambda start, end: ['osaka_009']
        got = self.recommend({'placeId': 'osaka_001'}, real)
        self.assertEqual([x['placeId'] for x in got['recommendations']], ['osaka_009'])
        self.assertEqual(got['eligibility'], 'at_least_one_trip_date')
        self.store.date_availability = lambda *_: []
        self.assertEqual(self.recommend({'placeId': 'osaka_001'}, real)['recommendations'], [])

    def test_revoked_token_during_date_check_is_rejected(self):
        real = self.create(REAL_DATASET)
        def worker(*_):
            with self.store.connect() as c:
                c.execute('UPDATE members SET token_hash=? WHERE id=?', ('revoked', real['members'][0]['id']))
            return ['osaka_009']
        self.store.date_availability = worker
        with self.assertRaises(ApiError) as caught:
            self.recommend({'placeId': 'osaka_001'}, real)
        self.assertEqual(caught.exception.status, 403)


class RecommendationHttpTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / 'test.sqlite3'
        self.server = make_server(self.db, port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.tmp.cleanup()

    def req(self, method, path, body=None, token='', origin='http://localhost:3000'):
        req = urllib.request.Request(self.base + path, method=method,
            headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Origin': origin},
            data=json.dumps(body).encode() if body is not None else None)
        try:
            response = urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            response = e
        with response:
            return response.status, json.load(response), response.headers

    def room(self, dataset=DEMO_DATASET, start='2026-11-10', end='2026-11-11'):
        return self.req('POST', '/rooms', {'startDate': start, 'endDate': end,
            'memberNames': ['A', 'B'], 'dataset': dataset})[1]

    def test_demo_http_top_n_exclusions_and_no_identity_leak(self):
        room = self.room(); a, b = room['members']; rid = room['roomId']
        self.req('PUT', f"/rooms/{rid}/longlists/{b['id']}", {'longlist': ['glico', 'kuromon']}, b['submissionToken'])
        path = f"/rooms/{rid}/recommendations/{a['id']}"
        code, got, headers = self.req('POST', path, {'placeId': 'glico'}, a['submissionToken'])
        self.assertEqual(code, 200)
        self.assertEqual(len(got['recommendations']), 3)
        self.assertTrue(all(x['coPickCount'] == 0 for x in got['recommendations']))
        self.assertEqual(headers['Cache-Control'], 'no-store')
        raw = json.dumps(got)
        for secret in [rid, a['id'], b['id'], a['submissionToken'], 'memberNames', 'longlist']:
            self.assertNotIn(secret, raw)
        got = self.req('POST', path, {'placeId': 'glico', 'excludePlaceIds': ['kuromon'], 'limit': 1}, a['submissionToken'])[1]
        self.assertEqual(len(got['recommendations']), 1)
        self.assertNotEqual(got['recommendations'][0]['placeId'], 'kuromon')
        self.assertEqual(self.req('POST', path, {'placeId': 'glico'}, a['submissionToken'], 'https://bad.test')[0], 403)
        self.assertEqual(self.req('POST', path, {'placeId': 'glico'})[0], 403)
        self.assertEqual(self.req('POST', path, {'placeId': 'glico', 'limit': True}, a['submissionToken'])[0], 400)
        self.assertEqual(self.req('GET', path, token=a['submissionToken'])[0], 404)

    def test_actual_real_catalog_and_engine_dates_gate_both_ranks_and_fallback(self):
        room = self.room(REAL_DATASET); a, b = room['members']; rid = room['roomId']
        self.req('PUT', f"/rooms/{rid}/longlists/{b['id']}",
                 {'longlist': ['osaka_001', 'branch_ichiran_shinsaibashi', 'branch_wanaka_dotonbori']}, b['submissionToken'])
        code, got, _ = self.req('POST', f"/rooms/{rid}/recommendations/{a['id']}",
                               {'placeId': 'osaka_001', 'limit': 10}, a['submissionToken'])
        self.assertEqual(code, 200)
        allowed = self.req('GET', f'/rooms/{rid}/schedulable', token=a['submissionToken'])[1]['placeIds']
        self.assertTrue(set(x['placeId'] for x in got['recommendations']) <= set(allowed))
        # Review-expired trip: return fewer/zero, never search-only padding.
        future = self.room(REAL_DATASET, '2027-01-01', '2027-01-02'); m = future['members'][0]
        code, got, _ = self.req('POST', f"/rooms/{future['roomId']}/recommendations/{m['id']}",
                               {'placeId': 'osaka_001'}, m['submissionToken'])
        self.assertEqual(code, 200)
        self.assertEqual(got['recommendations'], [])

    def test_worker_failure_503_then_recovers_and_bad_auth_never_runs_worker(self):
        room = self.room(REAL_DATASET); m = room['members'][0]
        path = f"/rooms/{room['roomId']}/recommendations/{m['id']}"; body = {'placeId': 'osaka_001'}
        with patch('server.subprocess.run', side_effect=OSError('node unavailable')) as worker:
            self.assertEqual(self.req('POST', path, body, 'bad')[0], 403)
            worker.assert_not_called()
            self.assertEqual(self.req('POST', path, body, m['submissionToken'])[0], 503)
        code, got, _ = self.req('POST', path, body, m['submissionToken'])
        self.assertEqual(code, 200)
        self.assertIsInstance(got['recommendations'], list)
