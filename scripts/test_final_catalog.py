import copy, csv, json, unittest, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from build_final_catalog import ROOT, BASE, COLLECTION, PROFILES, OUTPUT, FINAL_PROFILES, merge
from place_catalog import catalog, project, exchange_rate
from apply_branch_verification import apply_verification, PATH as VERIFICATION

class FinalCatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data=json.loads(OUTPUT.read_text(encoding='utf-8'));cls.profiles=json.loads(FINAL_PROFILES.read_text(encoding='utf-8'))

    def test_all_205_reachable_without_duplicates(self):
        pages=[catalog(path=OUTPUT,offset=i,rate='8.6253') for i in (0,150)]
        self.assertEqual([p['total'] for p in pages],[205,205])
        self.assertEqual([len(p['places']) for p in pages],[150,55])
        self.assertEqual([p['next_offset'] for p in pages],[150,None])
        self.assertEqual(len({r['place_id'] for p in pages for r in p['places']}),205)

    def test_branch_review_keeps_original_facts_and_explicit_estimates(self):
        branches=[r for r in self.data['places'] if r['place']['place_id'].startswith('branch_')]
        self.assertEqual(len(branches),55)
        eligible=[r for r in branches if r['review']['branch_verification']['status']=='eligible_for_dated_demo']
        self.assertEqual(len(eligible),51)
        for r in branches:
            p=project(r,None);v=r['review']['branch_verification']
            self.assertFalse(p['planning']['schedule_ready'])
            self.assertEqual(p['latitude'],v['coordinates']['latitude'])
            self.assertEqual(p['longitude'],v['coordinates']['longitude'])
            self.assertTrue(v['source_urls'])
            self.assertTrue(r['review']['branch_collection'])
            if v['status']=='eligible_for_dated_demo':
                self.assertEqual(r['review']['recommendation_blockers'],[])
                self.assertTrue(34<p['latitude']<35 and 135<p['longitude']<136)
                self.assertIn(p['place_id'],self.profiles['places'])
                self.assertIn('demo',r['field_sources']['stay_min']['kind'])
            else:
                self.assertTrue(r['review']['recommendation_blockers'])
                self.assertIsNone(p['cost_krw'])
        self.assertGreater(catalog('GU',path=OUTPUT)['total'],0)
        self.assertGreater(catalog('돈키호테',path=OUTPUT)['total'],1)
        estimate=next(r for r in branches if r['place']['place_id']=='branch_fukutaro_umeda')
        self.assertEqual(project(estimate,exchange_rate('8.6253'))['cost_status'],'estimate')
        self.assertIn('평균예산',project(estimate,exchange_rate('8.6253'))['cost_basis'])

    def test_overlay_fails_closed_for_changed_sources_or_missing_required_facts(self):
        v=json.loads(VERIFICATION.read_text(encoding='utf-8'));raw=COLLECTION.read_bytes()
        with self.assertRaises(ValueError): apply_verification(self.data,self.profiles,raw+b' ',v)
        broken=copy.deepcopy(v);broken['places'].pop('branch_gu_shinsaibashi')
        with self.assertRaises(ValueError): apply_verification(self.data,self.profiles,raw,broken)
        for key,value in [('cost_jpy',None),('remaining',['price_unconfirmed'])]:
            broken=copy.deepcopy(v);broken['places']['branch_ichiran_shinsaibashi'][key]=value
            with self.assertRaises(ValueError): apply_verification(self.data,self.profiles,raw,broken)
        broken=copy.deepcopy(v);broken['places']['branch_ichiran_shinsaibashi']['coordinates']['latitude']=None
        with self.assertRaises(ValueError): apply_verification(self.data,self.profiles,raw,broken)

    def test_exclusions_and_categories_retained(self):
        projected=[project(r,None) for r in self.data['places']]
        excluded=[p for p in projected if p['record_status']=='제외']
        self.assertEqual(len(excluded),9)
        self.assertTrue(all(p['selection_disabled_reason'] for p in excluded))
        self.assertEqual(sum(p['category']=='복합문화' for p in projected),1)
        self.assertEqual(sum(p['category']=='체험·오락' for p in projected),6)
        self.assertTrue(all(pid not in self.profiles['places'] for pid in self.data['invalidated_calendar_ids']))

    def test_existing_ids_and_proposals_are_preserved(self):
        base=json.loads(BASE.read_text(encoding='utf-8'));before={r['place']['place_id'] for r in base['places']}
        after={r['place']['place_id'] for r in self.data['places']}
        self.assertTrue(before<=after)
        self.assertEqual(len(self.data['update_proposals']['updates']),3)
        self.assertTrue(all(not p['applied'] for p in self.data['update_proposals']['updates']))

if __name__=='__main__':unittest.main()
