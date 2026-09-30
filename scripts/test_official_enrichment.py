"""Offline integrity checks for reviewed official-source additions."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
P = ROOT / 'data/week5/live_20260923/processed'

class OfficialEnrichmentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads((P / 'osaka_places_150_fresh.json').read_text(encoding='utf-8'))
        cls.ledger = json.loads((P / cls.data['latest_enrichment_checks_file']).read_text(encoding='utf-8'))
        cls.records = {r['place']['place_id']: r for r in cls.data['places']}

    def test_identity_coordinates_and_blockers_preserved(self):
        self.assertEqual(len(self.records), 150)
        self.assertEqual(len(self.data['places']), 150)
        self.assertEqual(set(self.records), {x['place_id'] for x in self.ledger['preserved_identity']})
        for x in self.ledger['preserved_identity']:
            r = self.records[x['place_id']]
            for k in ('latitude', 'longitude', 'category'):
                self.assertEqual(r['place'][k], x[k])
            self.assertEqual(r['source']['osm_ref'], x['osm_ref'])
            self.assertTrue(set(x['existing_blockers']) <= set(r['review']['recommendation_blockers']))
            self.assertFalse(r['review']['schedule_ready'])

    def test_every_update_has_evidence_and_matches_final_value(self):
        latest = {}
        for c in self.ledger['changes']:
            key = (c['place_id'], c['field'])
            if key in latest:
                self.assertEqual(c['before'], latest[key]['after'])
            latest[key] = c
            if c['field'] != 'verified_at':
                self.assertTrue(c['source']['urls'])
                self.assertTrue(all(u.startswith(('https://', 'http://')) for u in c['source']['urls']))
                self.assertTrue(c['source'].get('checked_at'))
        for (id, field), c in latest.items():
            self.assertEqual(self.records[id]['place'][field], c['after'])
            self.assertEqual(self.records[id]['field_sources'][field], c['source'])

    def test_null_counts_and_review_queue_are_current(self):
        missing = {k: sum(r['place'][k] is None for r in self.records.values())
                   for k in self.data['places'][0]['place']}
        stats = self.ledger['statistics']
        self.assertEqual(missing, stats['missing_after'])
        self.assertEqual(sum(stats['missing_before'].values()) - sum(missing.values()), stats['null_fields_filled'])
        queue = json.loads((P / 'place_review_queue.json').read_text(encoding='utf-8'))
        self.assertEqual(queue['statistics'], stats)
        for x in queue['places']:
            r = self.records[x['place_id']]
            self.assertEqual(x['missing_fields'], [k for k,v in r['place'].items() if v is None])
            self.assertEqual(x['blockers'], r['review']['recommendation_blockers'])

    def test_unknown_values_are_not_filled_with_defaults(self):
        self.assertTrue(all(r['field_sources']['bag_load']['kind'] == 'team_rule_estimate' for r in self.records.values()))
        for r in self.records.values():
            p = r['place']
            if p['covered'] is not None:
                self.assertIs(type(p['covered']), bool)
            if p['stay_min'] is not None:
                self.assertGreater(p['stay_min'], 0)
                self.assertTrue(r['field_sources']['stay_min']['note'])
            if p['cost'] is not None:
                self.assertIs(type(p['cost']), int)
                self.assertGreaterEqual(p['cost'], 0)
        self.assertIsNone(self.records['osaka_draft_5fa8876a4657']['place']['cost'])
        self.assertIsNone(self.records['osaka_draft_74dbaeea6a02']['place']['opening_hours'])

if __name__ == '__main__':
    unittest.main()
