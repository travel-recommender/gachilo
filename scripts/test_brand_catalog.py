import copy
import json
import unittest
from decimal import Decimal
import sys
from publish_brand_catalog import ROOT, REGISTRY, apply, read, publish

sys.path.insert(0, str(ROOT / 'backend'))
from place_catalog import project, catalog


class BrandCatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.registry = read(REGISTRY)
        cls.source = read(ROOT / cls.registry['catalog_input'])
        cls.result = apply(cls.source, cls.registry)
        cls.rows = {r['place']['place_id']: r for r in cls.result['places']}

    def test_published_result_is_reproducible(self):
        self.assertEqual(publish(check=True)['reviewed_places'], 238)

    def test_all_original_facts_profiles_and_review_status_remain_unchanged(self):
        before = copy.deepcopy(self.source)
        result = apply(self.source, self.registry)
        self.assertEqual(self.source, before)
        for old, new in zip(before['places'], result['places']):
            new['place'].pop('brand_id'); new['place'].pop('branch_group_id')
            new['field_sources'].pop('brand_id', None); new['field_sources'].pop('branch_group_id', None)
            self.assertEqual(new, old)

    def test_closed_branch_keeps_identity_but_is_not_promoted(self):
        row = self.rows['osm_node_2546559085']
        self.assertEqual(row['place']['brand_id'], 'ichiran')
        self.assertIn('permanently_closed', row['review']['recommendation_blockers'])
        self.assertFalse(row['review']['schedule_ready'])

    def test_food_and_retail_formats_do_not_collapse(self):
        p = lambda pid: self.rows[pid]['place']
        a, b, c = (p('branch_551_' + x) for x in ['honten', 'namba_walk', 'takashimaya_osaka'])
        self.assertEqual(a['brand_id'], c['brand_id'])
        self.assertEqual(a['branch_group_id'], b['branch_group_id'])
        self.assertNotEqual(a['branch_group_id'], c['branch_group_id'])
        self.assertNotEqual(p('branch_zara_shinsaibashi')['branch_group_id'], p('branch_zara_man_shinsaibashi')['branch_group_id'])

    def test_similar_names_and_parent_buildings_are_not_brands(self):
        for pair in self.registry['explicit_non_matches']:
            a, b = (self.rows[pid]['place'] for pid in pair['place_ids'])
            self.assertFalse(a['brand_id'] is not None and a['brand_id'] == b['brand_id'])
        self.assertIsNone(self.rows['onsen_spasuminoe']['place']['brand_id'])

    def test_public_api_exposes_identity_without_hiding_estimated_prices(self):
        row = self.rows['branch_doutor_shinsaibashi_station']
        value = project(row, Decimal('9'))
        self.assertEqual(value['brand_id'], 'doutor')
        self.assertEqual(value['cost_status'], 'estimate')
        self.assertEqual(project(row, None)['cost_status'], 'exchange_rate_required')
        found = catalog(query='이치란 아베노', rate='9')['places']
        self.assertEqual(found[0]['brand_id'], 'ichiran')

    def test_duplicate_unknown_or_unreviewed_ids_fail_closed(self):
        for change in ['duplicate', 'unknown', 'missing']:
            registry = copy.deepcopy(self.registry)
            if change == 'duplicate':registry['brands'][1]['members'][0]['place_id'] = 'osaka_026'
            if change == 'unknown':registry['brands'][0]['members'][0]['place_id'] = 'unknown'
            if change == 'missing':registry['ungrouped_place_ids'].pop()
            with self.assertRaises(ValueError):apply(self.source, registry)

    def test_replacement_group_cannot_mix_meal_and_takeout(self):
        registry = copy.deepcopy(self.registry)
        g = next(g for g in registry['brands'] if g['brand_id'] == '551_horai')
        g['members'][-1]['branch_group_id'] = g['members'][0]['branch_group_id']
        with self.assertRaisesRegex(ValueError, 'meal role'):apply(self.source, registry)


if __name__ == '__main__':unittest.main()
