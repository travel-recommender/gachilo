"""Service startup uses the published catalog, independently of a developer shell."""
import json, unittest
from unittest.mock import patch
from place_catalog import ROOT, DATA, PROFILES, catalog, runtime_paths

class RuntimeCatalogTests(unittest.TestCase):
    def test_published_defaults_and_expansion_search(self):
        with patch.dict('os.environ',{'REAL_CATALOG_PATH':'','REAL_PROFILES_PATH':''}):
            paths=runtime_paths()
        self.assertEqual(paths,(DATA,PROFILES))
        self.assertEqual(catalog()['total'],225)
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

    def test_query_searches_the_same_names_exposed_to_web(self):
        import tempfile
        from decimal import Decimal
        raw=json.loads(DATA.read_text(encoding='utf-8'))
        record=raw['places'][-1]
        record['review']['branch_collection']={'brand':'UniqueReviewBrand','official_name':'OfficialReviewName','aliases':' Alias One | AliasTwo | Alias One || '}
        with tempfile.TemporaryDirectory() as tmp:
            path=__import__('pathlib').Path(tmp)/'catalog.json'
            path.write_text(json.dumps({'places':[record]}))
            for query in ['uniquereviewbrand','officialreviewname','alias one','aliastwo']:
                self.assertEqual(catalog(query=query,path=path,rate=Decimal('9.2'))['total'],1)
            names=catalog(path=path,rate=Decimal('9.2'))['places'][0]['search_names']
            self.assertEqual(names.count('Alias One'),1)
            self.assertNotIn('',names)

    def test_excluded_ids_rejected_without_erasing_existing_data(self):
        import tempfile
        from pathlib import Path
        from server import Store
        from api_errors import ApiError
        with tempfile.TemporaryDirectory() as tmp:
            store=Store(Path(tmp)/'db.sqlite3')
            room=store.create({'dataset':'osaka_review_150','startDate':'2026-11-02','endDate':'2026-11-04','memberNames':['A','B']})
            member=room['members'][0];rid=room['roomId'];mid=member['id'];token=member['submissionToken']
            excluded=next(iter(store.excluded_real_ids));valid='branch_ichiran_shinsaibashi'
            store.save_longlist(rid,mid,token,{'longlist':[valid]})
            with self.assertRaises(ApiError):store.save_longlist(rid,mid,token,{'longlist':[excluded]})
            self.assertEqual(store.pool(rid,token)['placeIds'],[valid])
            body={'longlist':[valid],'picks':[valid],'must':valid,'veto':excluded,'budgetPerDay':50000,'stepLimit':15000,'activeMin':600}
            store.submit(rid,mid,token,body)  # old/excluded places may still be vetoed
            before=store.result(rid,token)['revision']
            with self.assertRaises(ApiError):store.submit(rid,mid,token,{**body,'picks':[excluded],'must':excluded,'veto':None})
            self.assertEqual(store.result(rid,token)['revision'],before)
            with store.connect() as c:
                c.execute('UPDATE longlists SET ids=? WHERE member_id=?',(json.dumps([valid,excluded]),mid))
            self.assertEqual(store.pool(rid,token)['placeIds'],[valid])
            with store.connect() as c:
                self.assertIn(excluded,json.loads(c.execute('SELECT ids FROM longlists WHERE member_id=?',(mid,)).fetchone()['ids']))
