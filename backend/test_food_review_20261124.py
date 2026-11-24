import unittest
from decimal import Decimal
from place_catalog import catalog

class FoodReviewApiTests(unittest.TestCase):
    def test_search_exposes_reviewed_meals_and_budget_uncertainty(self):
        for name in ('비스트로 요시카와', '모리모리 스시', '카사블랑카 난바 리버사이드'):
            item=next(p for p in catalog(query=name,rate=Decimal('9.5'))['places'] if p['name_ko']==name)
            self.assertEqual(item['cost_status'],'estimate')
            self.assertIsNotNone(item['cost_krw'])
            self.assertIsNone(item['selection_disabled_reason'])
            self.assertEqual(item['coordinate_basis'],'openstreetmap_node_reference_not_entrance')
            self.assertTrue(item['cost_basis'])
        cake=next(p for p in catalog(query='리쿠로 오지상 다이마루 우메다점',rate=Decimal('9.5'))['places'] if p['place_id']=='branch_rikuro_daimaru_umeda')
        self.assertEqual(cake['cost_status'],'estimate')
        self.assertEqual(cake['coordinate_basis'],'reviewed_building_reference_not_entrance')
        self.assertIn('1개',cake['cost_basis'])
        self.assertIn('osaka_draft_1cdebcaa6534',{p['place_id'] for p in catalog(query='라멘',rate=Decimal('9.5'),limit=240)['places']})

    def test_indefinite_closure_is_not_claimed_permanent(self):
        item=next(p for p in catalog(query='비나인')['places'] if p['name_ko']=='비나인')
        self.assertIn('official_indefinite_closure',item['planning']['review_required'])
        self.assertNotIn('google_maps_permanently_closed',item['planning']['review_required'])

    def test_second_review_is_searchable_with_budget_estimates(self):
        for name in ('머시 비건 팩토리','사이지키 채식요리','중앙시장 엔도 스시',
                     '리쿠로 오지상 난바 본점','코코이치방야 난바 에비스바시점',
                     '비어드파파 난바워크점','비드프랑스 벤텐초점','호젠지 미즈카케차야'):
            item=next(p for p in catalog(query=name,rate=Decimal('9.5'))['places'] if p['name_ko']==name)
            self.assertEqual(item['cost_status'],'estimate',name)
            self.assertIsNone(item['selection_disabled_reason'],name)
            self.assertTrue(item['cost_basis'],name)
