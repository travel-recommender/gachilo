import csv
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
import requests
import collect_osaka_places as collector

class CollectionTests(unittest.TestCase):
    def test_success_saves_and_preserves_existing_raw(self):
        response=Mock();response.json.return_value={'elements':[{'id':123}]}
        with tempfile.TemporaryDirectory() as folder, patch.object(collector.requests,'post',return_value=response) as post:
            output=Path(folder)/'raw.json'
            collector.collect(output)
            original=output.read_bytes()
            self.assertIn(b'123',original)
            with self.assertRaises(FileExistsError): collector.collect(output)
            self.assertEqual(original,output.read_bytes());self.assertEqual(post.call_count,1)
    def test_all_failures_do_not_create_file(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(collector.requests,'post',side_effect=requests.RequestException):
            output=Path(folder)/'raw.json'
            with self.assertRaises(RuntimeError): collector.collect(output)
            self.assertFalse(output.exists())
    def test_invalid_json_uses_second_server(self):
        bad=Mock();bad.json.return_value={'error':'bad'}
        good=Mock();good.json.return_value={'elements':[]}
        with tempfile.TemporaryDirectory() as folder, patch.object(collector.requests,'post',side_effect=[bad,good]) as post:
            collector.collect(Path(folder)/'raw.json')
            self.assertEqual(post.call_count,2)
    def test_route_catalog_contains_demo_stops_without_network(self):
        with patch('requests.get', side_effect=AssertionError('network not expected')):
            import calculate_routes as routes
        self.assertTrue(routes.CSV_PATH.is_file())
        for name in ['오사카성','도톤보리 글리코 사인','구로몬시장','쓰텐카쿠']:
            self.assertIsNotNone(routes.find_place(name))
