"""Local HTTP OSRM substitute: verifies the actual Python -> Node server entry points."""
import json
import os
import subprocess
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit
from engine import Engine
from candidate_engine import CandidateEngine


class RoutingIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        calls = self.calls

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                calls.append(self.path)
                coords = [list(map(float, p.split(','))) for p in urlsplit(self.path).path.split('/')[-1].split(';')]
                waypoints = [dict(location=p, distance=2) for p in coords]
                if '/route/' in self.path:
                    data = dict(code='Ok', waypoints=waypoints, routes=[dict(distance=900, duration=720)])
                else:
                    data = dict(code='Ok', sources=waypoints, destinations=waypoints,
                                distances=[[0 if i == j else 900 for j in range(len(coords))] for i in range(len(coords))],
                                durations=[[0 if i == j else 720 for j in range(len(coords))] for i in range(len(coords))])
                body = json.dumps(data).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.http = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.env = patch.dict(os.environ, {'OSRM_FOOT_URL': f'http://127.0.0.1:{self.http.server_port}',
                                          'OSRM_TIMEOUT_MS': '2000', 'SOMSOM_API_KEY': '', 'AI_MOCK': ''})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(self.http.server_close)
        self.addCleanup(self.http.shutdown)
        self.engine = Engine()
        self.assertEqual(self.calls, [])  # Listing the catalogue never queries routes.
        places = ['glico', 'hozenji', 'kuromon']
        self.snapshot = dict(startDate='2026-10-07', endDate='2026-10-07',
                             members=[dict(id='a', name='A'), dict(id='b', name='B')],
                             submissions=[dict(memberId=m, longlist=places, picks=places, must=None, veto=None,
                                               budgetPerDay=100000, stepLimit=20000, activeMin=720) for m in ['a', 'b']])

    def test_single_strategy_invokes_configured_table_before_calculating(self):
        got = self.engine.calculate(self.snapshot, 'average')
        self.assertEqual(len(self.calls), 1)
        self.assertIn('/table/v1/foot/', self.calls[0])
        self.assertRegex(got['summary'], r'OSRM 도보 [1-9]')
        self.assertEqual(set(got), {'strategy', 'days', 'summary'})

    def test_three_candidates_share_one_table_and_keep_existing_contract(self):
        got = CandidateEngine(self.engine.node).calculate(self.snapshot)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(len(got['candidates']), 3)
        for candidate in got['candidates']:
            self.assertRegex(candidate['summary'], r'OSRM 도보 [1-9]')

    def test_query_cli_uses_route_endpoint_and_returns_machine_readable_units(self):
        script = Path(__file__).parents[1] / 'scripts/query_walking_route.mjs'
        result = subprocess.run([self.engine.node, str(script)],
                                input=json.dumps([dict(lat=34.67, lng=135.50), dict(lat=34.671, lng=135.501)]),
                                capture_output=True, text=True, encoding='utf-8', timeout=10, check=True)
        self.assertEqual(json.loads(result.stdout), dict(km=0.9, min=12, source='osrm-foot'))
        self.assertEqual(len(self.calls), 1)
        self.assertIn('/route/v1/foot/', self.calls[0])
