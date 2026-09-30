import unittest,json,copy,ast
from unittest.mock import patch
from decimal import Decimal
from pathlib import Path
from place_catalog import cost_krw,exchange_rate,project,catalog,DATA,get_luggage_score,exchange_rate_metadata

class CatalogTests(unittest.TestCase):
 def test_utf8_catalog_with_cp949_default(self):
  original = Path.read_text
  def cp949_default(path, encoding=None, errors=None):
   return original(path, encoding=encoding or 'cp949', errors=errors)
  with patch.object(Path, 'read_text', cp949_default):
   result=catalog(query='도톤보리 글리코 사인',rate='9.5')
  self.assertEqual(result['total'],1)
  self.assertEqual(result['places'][0]['name_ko'],'도톤보리 글리코 사인')
 def test_exchange_rate_provenance_is_not_invented(self):
  with patch.dict('os.environ',{},clear=True):
   missing=exchange_rate_metadata(None)
   self.assertIsNone(missing['as_of']);self.assertIsNone(missing['source'])
   partial=exchange_rate_metadata(Decimal('9.5'))
   self.assertEqual(partial['provenance_status'],'incomplete')
   self.assertFalse(partial['live_quote'])
  with patch.dict('os.environ',{'JPY_TO_KRW_AS_OF':'2026-09-30','JPY_TO_KRW_SOURCE':'team-reviewed test quote'},clear=True):
   result=catalog(rate='9.5')['exchange_rate']
   self.assertEqual(result['as_of'],'2026-09-30')
   self.assertEqual(result['source'],'team-reviewed test quote')
   self.assertEqual(result['provenance_status'],'documented')
   self.assertEqual(exchange_rate_metadata(None)['provenance_status'],'unconfigured')
  for bad in ('2026-02-30','20260930','yesterday'):
   with patch.dict('os.environ',{'JPY_TO_KRW_AS_OF':bad},clear=True):
    with self.assertRaisesRegex(ValueError,'YYYY-MM-DD'):exchange_rate_metadata(Decimal('9.5'))
 def test_conversion_missing_zero_and_rounding(self):
  self.assertIsNone(cost_krw(None,Decimal('9.5')))
  self.assertEqual(cost_krw(0,None),0)
  self.assertIsNone(cost_krw(100,None))
  self.assertEqual(cost_krw(101,Decimal('9.5')),960)
  for value in ('NaN','Infinity','0','-1','oops'):
   with self.assertRaises(ValueError):exchange_rate(value)
 def test_shopping_is_not_a_free_meal(self):
  records=json.loads(DATA.read_text(encoding='utf-8'))['places']
  shop=next(r for r in records if r['place']['category']=='쇼핑')
  out=project(shop,Decimal('9.5'))
  self.assertIsNone(out['cost_krw']);self.assertEqual(out['cost_status'],'not_applicable_shopping')
  unknown=copy.deepcopy(records[0]);unknown['place']['category']='식사';unknown['place']['name_ko']='test';unknown['place']['cost']=None
  self.assertEqual(project(unknown,Decimal('9.5'))['cost_status'],'unknown')
 def test_all_150_rules_preserve_source_and_safety(self):
  records=json.loads(DATA.read_text(encoding='utf-8'))['places'];result=catalog(rate='9.5')
  self.assertEqual(len(result['places']),150)
  for r in records:
   self.assertTrue(r['place']['name_ko']);self.assertGreater(r['place']['stay_min'],0)
   self.assertEqual(r['place']['bag_load'],get_luggage_score(r['place']))
  self.assertTrue(all(not p['planning']['schedule_ready'] for p in result['places']))
  self.assertTrue(any('google_maps_permanently_closed' in p['planning']['review_required'] for p in result['places']))
  self.assertEqual(catalog(query='없는이름987',rate='9')['total'],0)
  self.assertTrue(all(p['category']=='카페' for p in catalog(category='카페',rate='9')['places']))
 def test_legacy_luggage_function_parity(self):
  source=Path(__file__).resolve().parents[1]/'scripts/recommend_itinerary.py'
  tree=ast.parse(source.read_text(encoding='utf-8'));nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='get_luggage_score' or isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='LIGHT_SHOPPING_PLACES' for t in n.targets)]
  env={};exec(compile(ast.Module(body=nodes,type_ignores=[]),str(source),'exec'),env)
  for r in json.loads(DATA.read_text(encoding='utf-8'))['places']:self.assertEqual(get_luggage_score(r['place']),env['get_luggage_score'](r['place']))

if __name__=='__main__':unittest.main()
