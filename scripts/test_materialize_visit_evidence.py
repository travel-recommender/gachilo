import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from materialize_visit_evidence import ROOT, PACK, read, apply, materialize


class EvidencePackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source_path = ROOT/'data/final/osaka_catalog_20261112.json'
        cls.dataset, cls.pack = read(cls.source_path), read(PACK)

    def test_refresh_preserves_all_place_values_and_original_sources(self):
        original = copy.deepcopy(self.dataset)
        result = apply(self.dataset, self.pack)
        self.assertEqual(self.dataset, original)
        old = {r['place']['place_id']: r for r in original['places']}
        new = {r['place']['place_id']: r for r in result['places']}
        for item in self.pack['field_refreshes']:
            pid, field = item['place_id'], item['field']
            self.assertEqual(new[pid]['field_sources'][field]['previous'],
                             {'value':old[pid]['place'][field], 'source':old[pid]['field_sources'][field]})
            new[pid]['field_sources'][field] = old[pid]['field_sources'][field]
        for item in self.pack['additional_assertions']:
            new[item['place_id']]['review'].pop('visit_evidence')
        self.assertEqual(result['places'], original['places'])

    def test_changed_place_or_source_cannot_be_silently_overwritten(self):
        for mutate in ('place', 'source'):
            dataset = copy.deepcopy(self.dataset)
            row = next(r for r in dataset['places'] if r['place']['place_id']=='osaka_002')
            if mutate == 'place': row['place']['cost'] = 1600
            else: row['field_sources']['cost']['checked_at'] = '2026-11-19'
            with self.assertRaisesRegex(ValueError, 're-review'):
                apply(dataset, self.pack)

    def test_branch_identity_is_not_inferred_from_a_shared_brand(self):
        pack = copy.deepcopy(self.pack)
        entry = next(e for e in pack['field_refreshes'] if e['place_id']=='branch_ichiran_abeno')
        entry['place_id'] = 'branch_ichiran_umeda_shibata'
        with self.assertRaisesRegex(ValueError, 'identity'):
            apply(self.dataset, pack)

    def test_unknown_periods_are_preserved_and_dated_closure_is_one_day(self):
        result = apply(self.dataset, self.pack)
        rows = {r['place']['place_id']:r for r in result['places']}
        self.assertIsNone(rows['osaka_007']['field_sources']['cost']['valid_through'])
        self.assertEqual(rows['osaka_009']['field_sources']['cost']['valid_from'], '2025-04-01')
        closure = rows['osaka_008']['review']['visit_evidence'][-1]
        self.assertEqual((closure['valid_from'], closure['valid_through']), ('2026-11-19','2026-11-19'))
        for pid in ['osaka_001','osaka_005','osaka_006','branch_usj']:
            self.assertEqual(rows[pid], next(r for r in self.dataset['places'] if r['place']['place_id']==pid))

    def test_duplicate_application_and_malformed_provenance_rejected(self):
        with self.assertRaisesRegex(ValueError, 'already applied'):
            apply(apply(self.dataset, self.pack), self.pack)
        for key, value in [('urls',['https://secret@example.org/']),('valid_through','2026-02-30'),('checked_at','2027-01-01')]:
            pack = copy.deepcopy(self.pack)
            pack['field_refreshes'][0][key] = value
            with self.assertRaises(ValueError): apply(self.dataset, pack)

    def test_existing_bundle_never_written_and_invalid_input_leaves_no_output(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp)/'new'
            report = materialize(self.source_path, PACK, out)
            before = (out/'catalog.json').read_bytes()
            self.assertEqual(report['state'], 'prepared_not_activated')
            self.assertEqual(report['refreshed_places'],9)
            with self.assertRaisesRegex(ValueError,'NEW directory'):
                materialize(self.source_path, PACK, out)
            self.assertEqual((out/'catalog.json').read_bytes(),before)
            bad = Path(temp)/'missing'
            with self.assertRaises(FileNotFoundError):
                materialize(Path(temp)/'no-input', PACK, bad)
            self.assertFalse(bad.exists())

    def test_duplicate_assertion_rejected_within_pack_or_existing_catalogue(self):
        pack = copy.deepcopy(self.pack)
        pack['additional_assertions'].append(copy.deepcopy(pack['additional_assertions'][0]))
        with self.assertRaisesRegex(ValueError, 'Repeated dated assertion'): apply(self.dataset, pack)
        dataset = copy.deepcopy(self.dataset)
        item = self.pack['additional_assertions'][0]
        row = next(r for r in dataset['places'] if r['place']['place_id']==item['place_id'])
        row.setdefault('review', {})['visit_evidence'] = [copy.deepcopy(item)]
        with self.assertRaisesRegex(ValueError, 'Repeated dated assertion'): apply(dataset, self.pack)

    def test_failed_second_write_or_publication_leaves_no_partial_output(self):
        original_write, original_rename = Path.write_text, Path.rename
        for phase in ('write', 'publish'):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as temp:
                out = Path(temp)/'new'
                def fail_write(path, *args, **kwargs):
                    if path.name == 'review-report.json': raise OSError('simulated full disk')
                    return original_write(path, *args, **kwargs)
                def fail_rename(path, *args, **kwargs):
                    if path.name == 'review-report.json': raise OSError('simulated publication error')
                    return original_rename(path, *args, **kwargs)
                method, replacement = ('write_text', fail_write) if phase == 'write' else ('rename', fail_rename)
                with patch.object(Path, method, replacement), self.assertRaises(OSError):
                    materialize(self.source_path, PACK, out)
                self.assertFalse(out.exists())
                self.assertEqual(list(Path(temp).iterdir()), [])
                self.assertEqual(materialize(self.source_path, PACK, out)['state'], 'prepared_not_activated')

    def test_destination_created_during_staging_is_preserved(self):
        original_write = Path.write_text
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp)/'new'
            def concurrent(path, *args, **kwargs):
                if path.name == 'review-report.json': out.mkdir()
                return original_write(path, *args, **kwargs)
            with patch.object(Path, 'write_text', concurrent), self.assertRaises(FileExistsError):
                materialize(self.source_path, PACK, out)
            self.assertTrue(out.is_dir())
            self.assertEqual(list(out.iterdir()), [])

    def test_corroborating_source_must_be_a_recorded_url(self):
        pack = copy.deepcopy(self.pack)
        pack['additional_assertions'][0]['reviewed_urls'] = ['https://unrelated.example/']
        with self.assertRaisesRegex(ValueError, 'Corroborating'): apply(self.dataset, pack)


if __name__ == '__main__': unittest.main()
