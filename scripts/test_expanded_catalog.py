import copy
import json
import sys
import unittest

from build_expanded_catalog import ROOT, BASE, OUTPUT, COLLECTIONS, EVIDENCE, SUPPORT, expand, read
sys.path.insert(0, str(ROOT / 'backend'))
from place_catalog import catalog


class ExpandedCatalogTests(unittest.TestCase):
    def test_published_catalog_matches_offline_build_and_preserves_every_original_record(self):
        base, final = read(BASE), read(OUTPUT)
        rebuilt = expand(base, [read(p) for p in COLLECTIONS], read(EVIDENCE))
        self.assertEqual(final['places'], rebuilt['places'])
        self.assertEqual(final['places'][:205], base['places'])
        for key in ('update_proposals', 'invalidated_calendar_ids', 'branch_verification_summary'):
            self.assertEqual(final[key], base[key])
        self.assertEqual(len(final['places']), 225)
        self.assertEqual(len({r['place']['place_id'] for r in final['places']}), 225)

    def test_research_prices_coordinates_and_routes_do_not_approve_a_schedule(self):
        profiles=read(ROOT/'data/final/osaka_profiles_20261026.json')['places']
        for r in read(OUTPUT)['places'][205:]:
            with self.subTest(place=r['place']['place_id']):
                self.assertFalse(r['review']['schedule_ready'])
                self.assertTrue(r['review']['recommendation_blockers'])
                self.assertNotIn(r['place']['place_id'], profiles)
                for field in ('latitude', 'longitude', 'cost', 'stay_min'):
                    self.assertIsNone(r['place'][field])
        sushi=next(r for r in read(OUTPUT)['places'] if r['place']['place_id']=='branch_sushiro_namba_amza')
        self.assertEqual(sushi['review']['branch_collection']['reference_cost_jpy'],150)
        self.assertIsNone(sushi['place']['cost'])  # plate price != meal budget

    def test_alias_queries_and_pagination_reach_all_new_records(self):
        cases={'스벅':'branch_starbucks_ebisubashi','Doutor':'branch_doutor_umeda_city',
               '코코이찌방야':'branch_coco_namba_ebisubashi','마쓰야':'branch_matsuya_nankai_namba',
               '비어드 파파':'branch_beardpapa_namba_walk','유니버설':'branch_usj','해유관':'branch_kaiyukan'}
        for query,pid in cases.items():
            self.assertIn(pid, {p['place_id'] for p in catalog(query,path=OUTPUT)['places']})
        first=catalog(path=OUTPUT);second=catalog(path=OUTPUT,offset=first['next_offset'])
        self.assertEqual([len(first['places']),len(second['places'])],[150,75])
        self.assertIsNone(second['next_offset'])
        self.assertEqual(catalog(path=OUTPUT,offset=225)['places'],[])

    def test_snacks_and_support_do_not_become_full_meals_or_tourism_stops(self):
        rows=read(COLLECTIONS[1])['rows']
        snacks=[r for r in rows if r['meal_role']=='snack']
        self.assertEqual(len(snacks),4)
        support=read(SUPPORT)['items']
        self.assertEqual(len(support),5)
        ids={r['place']['place_id'] for r in read(OUTPUT)['places']}
        for r in support:
            self.assertNotIn(r['support_id'],ids)
            self.assertFalse(r['automatic_itinerary_stop'])

    def test_duplicate_ids_and_promoted_research_are_rejected(self):
        base=read(BASE);collections=[read(p) for p in COLLECTIONS];evidence=read(EVIDENCE)
        broken=copy.deepcopy(collections);broken[0]['rows'][0]['collection_id']='branch_gu_shinsaibashi'
        with self.assertRaises(ValueError):expand(base,broken,evidence)
        broken=copy.deepcopy(collections);broken[1]['rows'][0]['schedule_ready']=True
        with self.assertRaises(ValueError):expand(base,broken,evidence)
        broken=copy.deepcopy(evidence);next(iter(broken['places'].values()))['entrance_verified']=True
        with self.assertRaises(ValueError):expand(base,collections,broken)


if __name__=='__main__':unittest.main()
