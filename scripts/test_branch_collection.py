import copy
import json
import tempfile
import unittest
from pathlib import Path

from import_branch_collection import BASE, COLLECTION, build_preview, write_preview


class BranchCollectionTests(unittest.TestCase):
    def setUp(self):
        self.base = json.loads(BASE.read_text(encoding='utf-8'))
        self.collection = json.loads(COLLECTION.read_text(encoding='utf-8'))

    def test_expands_without_overwriting_existing_records(self):
        original = copy.deepcopy(self.base)
        preview, proposals, summary = build_preview(self.base, self.collection)
        self.assertEqual(self.base, original)
        self.assertEqual(preview['places'][:150], original['places'])
        self.assertEqual((summary['collection_count'], summary['added_count'], summary['preview_count']), (58, 55, 205))
        self.assertEqual(len(proposals['updates']), 3)
        self.assertEqual({p['place_id'] for p in proposals['updates']},
                         {'osaka_026', 'osaka_022', 'osaka_draft_f1ba0aa6ab58'})
        self.assertFalse(proposals['applied'])
        self.assertEqual(summary['held_count'], 2)
        self.assertNotIn('category_quotas', preview)

    def test_no_guessed_runtime_fields_or_promotion(self):
        preview, _, _ = build_preview(self.base, self.collection)
        for record in preview['places'][150:]:
            self.assertFalse(record['review']['schedule_ready'])
            self.assertIn('branch_collection_review_required', record['review']['recommendation_blockers'])
            for field in ('latitude', 'longitude', 'cost', 'covered', 'stay_min', 'bag_load', 'website'):
                self.assertIsNone(record['place'][field])
        source = next(r for r in self.collection['rows'] if r['collection_id'] == 'branch_fukutaro_honten')
        result = next(r for r in preview['places'] if r['place']['place_id'] == source['collection_id'])
        self.assertEqual(result['review']['branch_collection']['reference_cost_jpy'], 1080)
        self.assertEqual(result['review']['branch_collection'], source)
        self.assertEqual(result['field_sources']['address']['urls'], source['source_url'].split())
        shop = next(r for r in preview['places'][150:] if r['place']['category'] == '쇼핑')
        self.assertIsNone(shop['place']['cost'])

    def test_same_brand_and_tenant_branches_are_kept_separate(self):
        preview, _, _ = build_preview(self.base, self.collection)
        ids = {r['place']['place_id'] for r in preview['places']}
        for cid in ('branch_bape_osaka', 'branch_bape_cdg_osaka', 'branch_cdg_osaka',
                    'branch_wanaka_dotonbori', 'branch_wanaka_sennichimae'):
            self.assertIn(cid, ids)
        self.assertEqual(len(ids), len(preview['places']))

    def test_repeat_import_is_idempotent_and_conflicts_fail(self):
        first, _, _ = build_preview(self.base, self.collection)
        again, _, summary = build_preview(first, self.collection)
        self.assertEqual(again['places'], first['places'])
        self.assertEqual(summary['added_count'], 0)
        self.assertEqual(summary['unchanged_candidate_count'], 55)
        first['places'][-1]['place']['address'] = 'user edit'
        with self.assertRaisesRegex(ValueError, 'existing record differs'):
            build_preview(first, self.collection)

    def test_duplicate_or_unknown_update_is_rejected(self):
        for mutation in ('duplicate', 'missing_target', 'duplicate_target'):
            data = copy.deepcopy(self.collection)
            if mutation == 'duplicate':
                data['rows'].append(copy.deepcopy(data['rows'][0]))
            else:
                edits = [r for r in data['rows'] if r['action'] == '보완']
                edits[1]['existing_place_id'] = 'unknown' if mutation == 'missing_target' else edits[0]['existing_place_id']
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                build_preview(self.base, data)

    def test_invalid_evidence_and_nonfinite_numbers_fail(self):
        for key, value in [('schedule_ready', True), ('source_url', 'javascript:alert(1)'),
                           ('checked_at', '2026-02-30'), ('source_kind', 'category_rule_estimate'),
                           ('reference_cost_jpy', True), ('reference_cost_jpy', float('nan')),
                           ('stay_min', -1), ('category', 'anything')]:
            data = copy.deepcopy(self.collection)
            data['rows'][0][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                build_preview(self.base, data)

    def test_new_rows_are_not_capped_at_150_or_58(self):
        data = copy.deepcopy(self.collection)
        row = copy.deepcopy(data['rows'][0])
        row.update(collection_id='branch_test_new_location', name_ko='별도 지점 시험')
        data['rows'].append(row)
        preview, _, summary = build_preview(self.base, data)
        self.assertEqual(summary['preview_count'], 206)
        self.assertEqual(len(preview['places']), 206)

    def test_existing_output_and_input_files_are_preserved(self):
        before = BASE.read_bytes(), COLLECTION.read_bytes()
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'review'
            summary = write_preview(BASE, COLLECTION, output)
            saved = {p.name: p.read_bytes() for p in output.iterdir()}
            with self.assertRaises(FileExistsError):
                write_preview(BASE, COLLECTION, output)
            self.assertEqual(saved, {p.name: p.read_bytes() for p in output.iterdir()})
            self.assertEqual(summary['preview_count'], 205)
        self.assertEqual(before, (BASE.read_bytes(), COLLECTION.read_bytes()))

    def test_review_metadata_and_dedicated_scheduling_blockers(self):
        preview, proposals, _ = build_preview(self.base, self.collection)
        records = {r['place']['place_id']: r for r in preview['places']}
        self.assertEqual(len(preview['area_schemes_by_place_id']), 205)
        self.assertEqual(preview['area_schemes_by_place_id']['osaka_022'], 'administrative_ward')
        for row in self.collection['rows']:
            self.assertEqual(row['area_scheme'], 'tourism_editorial_v1')
            self.assertEqual(row['area_basis'], 'manual_editorial_boundary_unconfirmed')
            if row['action'] == '보완':
                continue
            record = records[row['collection_id']]
            blockers = record['review']['recommendation_blockers']
            self.assertIn('area_scheme_unconfirmed', blockers)
            self.assertEqual(record['review']['meal_role'], row['meal_role'])
            self.assertEqual(record['review']['within'], row['within'])
            self.assertEqual('meal_role_not_full_meal' in blockers, row['meal_role'] in ('takeout', 'snack'))
            self.assertEqual('facility_relation_unconfirmed' in blockers, row['within'] is not None)
        roles = [r['meal_role'] for r in self.collection['rows']]
        self.assertEqual((roles.count('meal'), roles.count('takeout'), roles.count('snack')), (12, 1, 2))
        for update in proposals['updates']:
            change = update['name_change']
            self.assertEqual(change['from'], update['current_place']['name_ko'])
            self.assertEqual(change['to'], update['proposed_collection']['name_ko'])
            self.assertEqual(change['changed'], change['from'] != change['to'])
            self.assertEqual(change['requires_review'], change['changed'])
        self.assertIn('이치란 도톤보리 본관', proposals['held'][1]['next'])

    def test_facilities_do_not_merge_same_address_or_different_buildings(self):
        rows = {r['collection_id']: r for r in self.collection['rows']}
        within = lambda cid: rows['branch_' + cid]['within']
        self.assertEqual(within('pokemon_osaka_dx')['parent_place_id'], 'osaka_022')
        self.assertEqual(within('bape_hankyu_mens')['parent_place_id'], 'branch_hankyu_mens_osaka')
        self.assertEqual(within('551_takashimaya_osaka')['parent_place_id'], 'osaka_021')
        self.assertEqual(within('nintendo_osaka')['facility_id'], within('pokemon_osaka')['facility_id'])
        self.assertNotEqual(within('daimaru_umeda')['facility_id'], within('pokemon_osaka')['facility_id'])
        self.assertEqual(within('daimaru_umeda')['building_id'], within('pokemon_osaka')['building_id'])
        self.assertNotEqual(within('muji_grandfront')['building_id'], within('porter_osaka')['building_id'])
        self.assertNotEqual(within('montbell_daimaru_shinsaibashi')['facility_id'], within('pokemon_osaka_dx')['facility_id'])
        self.assertIsNone(within('montbell_daimaru_shinsaibashi')['parent_place_id'])
        self.assertNotEqual(within('muji_namba_skyo')['facility_id'], within('montbell_namba_city')['facility_id'])

    def test_category_role_area_and_facility_contracts_are_validated(self):
        for key, value in [('category', '복합문화'), ('engine_category_id', 'unknown'),
                           ('meal_role', None), ('meal_role', 'lunch'),
                           ('area_scheme', 'administrative_ward'), ('area_basis', '')]:
            data = copy.deepcopy(self.collection)
            data['rows'][0][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                build_preview(self.base, data)
        data = copy.deepcopy(self.collection)
        tenant = next(r for r in data['rows'] if r.get('within'))
        tenant['within']['parent_place_id'] = 'missing_parent'
        with self.assertRaisesRegex(ValueError, 'parent'):
            build_preview(self.base, data)
        for row in self.collection['rows']:
            if row['category'] == '체험·오락':
                self.assertEqual(row['engine_category_id'], 'activity')

    def test_each_source_url_is_validated_and_preserved_separately(self):
        preview, _, _ = build_preview(self.base, self.collection)
        record = next(r for r in preview['places'] if r['place']['place_id'] == 'branch_fukutaro_honten')
        self.assertEqual(record['field_sources']['address']['urls'], ['https://2951.jp/', 'https://2951.jp/menu.html'])
        data = copy.deepcopy(self.collection)
        data['rows'][0]['source_url'] += '\njavascript:alert(1)'
        with self.assertRaisesRegex(ValueError, 'source'):
            build_preview(self.base, data)


if __name__ == '__main__':
    unittest.main()
