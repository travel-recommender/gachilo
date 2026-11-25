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

    def test_reservation_and_outdoor_warnings_are_visible_in_search(self):
        tower=next(p for p in catalog(query='쓰텐카쿠')['places'] if p['place_id']=='osaka_002')
        self.assertIn('직접 예약',tower['reservation_notice'])
        self.assertIn('예약', ' '.join(tower['visit_conditions']))
        museum=next(p for p in catalog(query='보온병 기념관')['places'] if p['place_id']=='osaka_draft_50b7a6cc608f')
        self.assertIn('예약',museum['reservation_notice'])
        self.assertIn('2일 전',museum['reservation_notice'])
        self.assertIn('자동 일정 배치는 방문일 조건 확인 결과에 따라 보류',museum['reservation_notice'])
        self.assertIn('entry_time_reservation_required',museum['planning']['review_required'])
        self.assertIsNone(museum['selection_disabled_reason'])
        for name in ('포켓몬센터 오사카','닌텐도 오사카'):
            shop=next(p for p in catalog(query=name)['places'] if p['name_ko']==name)
            self.assertIn('정리권',shop['reservation_notice'])
            self.assertIsNone(shop['selection_disabled_reason'])
        self.assertNotIn('예약 완료를 입력받기 전에는 자동 배정 보류', ' '.join(tower['visit_conditions']))
        park=next(p for p in catalog(query='게마 공원')['places'] if p['place_id']=='osaka_draft_03cde684bd96')
        self.assertIn('선택한 날짜',park['visit_notice'])
