import copy, hashlib, importlib.util, json, unittest
from pathlib import Path
from publish_verified_catalog import ROOT, apply, read

class OverlayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.e=read(ROOT/'data/final/catalog_verification_20261104.json')
        cls.data=read(ROOT/cls.e['catalog_input']);cls.profiles=read(ROOT/cls.e['profiles_input'])

    def test_frozen_inputs_and_manual_csv_preserved(self):
        for name,sha in self.e['input_sha256'].items():
            self.assertEqual(hashlib.sha256((ROOT/name).read_bytes()).hexdigest(),sha)
        before=copy.deepcopy(self.data)
        result,_=apply(self.data,self.profiles,self.e)
        self.assertEqual(self.data,before)
        for old in before['places']:
            if old['place']['place_id'] not in self.e['updates']:
                self.assertEqual(next(x for x in result['places'] if x['place']['place_id']==old['place']['place_id']),old)

    def test_unexpected_blockers_fail_promotion(self):
        data=copy.deepcopy(self.data)
        next(x for x in data['places'] if x['place']['place_id']=='osaka_008')['review']['recommendation_blockers'].append('new_unresolved_identity')
        with self.assertRaisesRegex(ValueError,'Unresolved'):apply(data,self.profiles,self.e)

    def test_duplicate_new_id_is_rejected(self):
        e=copy.deepcopy(self.e);e['additions'][0]['place']['place_id']='osaka_008'
        with self.assertRaisesRegex(ValueError,'New collection'):apply(self.data,self.profiles,e)

    def test_public_api_marks_reference_price_without_losing_missing_exchange_rate(self):
        import sys
        sys.path.insert(0,str(ROOT/'backend'))
        from place_catalog import project
        from decimal import Decimal
        result,_=apply(self.data,self.profiles,self.e)
        record=next(x for x in result['places'] if x['place']['place_id']=='branch_doutor_shinsaibashi_station')
        self.assertEqual(project(record,None)['cost_status'],'exchange_rate_required')
        self.assertEqual(project(record,Decimal('9'))['cost_status'],'estimate')
        self.assertIn('참고가',project(record,Decimal('9'))['cost_basis'])

if __name__=='__main__':unittest.main()
