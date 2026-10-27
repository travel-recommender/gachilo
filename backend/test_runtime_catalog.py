"""Service startup uses the published catalog, independently of a developer shell."""
import json, unittest
from unittest.mock import patch
from place_catalog import ROOT, DATA, PROFILES, catalog, runtime_paths

class RuntimeCatalogTests(unittest.TestCase):
    def test_published_defaults_and_expansion_search(self):
        with patch.dict('os.environ',{'REAL_CATALOG_PATH':'','REAL_PROFILES_PATH':''}):
            paths=runtime_paths()
        self.assertEqual(paths,(DATA,PROFILES))
        self.assertEqual(catalog()['total'],205)
        for q,pid in [('이치란 아베노','branch_ichiran_abeno'),('이치란 신사이바시','branch_ichiran_shinsaibashi')]:
            self.assertIn(pid,{p['place_id'] for p in catalog(query=q)['places']})
        profiles=json.loads(PROFILES.read_text(encoding='utf-8'))['places']
        self.assertIn('branch_ichiran_shinsaibashi',profiles)
        held=next(p for p in catalog(query='와나카 도톤보리')['places'] if p['place_id']=='branch_wanaka_dotonbori')
        self.assertIsNone(held['cost_krw'])
        self.assertTrue(held['planning']['review_required'])

    def test_a_partial_override_cannot_mix_catalog_versions(self):
        for catalog_path,profiles_path in [('custom.json',''),('','custom.json')]:
            with patch.dict('os.environ',{'REAL_CATALOG_PATH':catalog_path,'REAL_PROFILES_PATH':profiles_path}):
                with self.assertRaisesRegex(ValueError,'함께'):runtime_paths()
