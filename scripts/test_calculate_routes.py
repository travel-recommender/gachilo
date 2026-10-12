"""The example CLI reports Node failures without a traceback or partial total."""
import contextlib
import importlib.util
import io
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('calculate_routes', Path(__file__).with_name('calculate_routes.py'))
routes = importlib.util.module_from_spec(spec)
with contextlib.redirect_stdout(io.StringIO()):
    spec.loader.exec_module(routes)


class RouteExampleTests(unittest.TestCase):
    point = {'name_ko': '장소', 'latitude': '34.67', 'longitude': '135.5'}

    def call(self, **mock_options):
        output = io.StringIO()
        with patch.dict(routes.os.environ, {'NODE_BINARY': 'test-node'}), \
             patch.object(routes.subprocess, 'run', **mock_options), contextlib.redirect_stdout(output):
            result = routes.calculate_walking_route(self.point, self.point)
        return result, output.getvalue()

    def test_node_failure_is_actionable(self):
        result, message = self.call(side_effect=subprocess.CalledProcessError(1, ['node']))
        self.assertIsNone(result)
        self.assertIn('Node 24', message)

    def test_timeout_does_not_raise(self):
        result, message = self.call(side_effect=subprocess.TimeoutExpired(['node'], 10))
        self.assertIsNone(result)
        self.assertIn('시간이 초과', message)

    def test_missing_executable_does_not_raise(self):
        result, message = self.call(side_effect=FileNotFoundError())
        self.assertIsNone(result)
        self.assertIn('NODE_BINARY', message)

    def test_invalid_json_does_not_raise(self):
        result, message = self.call(return_value=subprocess.CompletedProcess(['node'], 0, '{'))
        self.assertIsNone(result)
        self.assertIn('응답 형식', message)

    def test_success_keeps_units_and_provenance(self):
        result, message = self.call(return_value=subprocess.CompletedProcess(['node'], 0,
            '{"km":0.9,"min":12,"source":"osrm-foot"}'))
        self.assertEqual(result, (0.9, 12))
        self.assertIn('osrm-foot', message)

    def test_main_does_not_print_partial_trip_total(self):
        output = io.StringIO()
        with patch.object(routes, 'find_place', return_value=self.point), \
             patch.object(routes, 'calculate_walking_route', side_effect=[(0.9, 12), None]), \
             contextlib.redirect_stdout(output):
            routes.main()
        self.assertIn('중단', output.getvalue())
        self.assertNotIn('총 도보 거리', output.getvalue())


if __name__ == '__main__':
    unittest.main()
