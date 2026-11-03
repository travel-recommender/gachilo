"""Synthetic rooms only: never seed production popularity with these counts."""
import contextlib
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import co_picks
from co_picks import build_counts, DEMO_DATASET, REAL_DATASET
from server import Store


class CoPickTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = Path(self.tmp.name) / 'trips.sqlite3'
        self.store = Store(self.db)
        self.room = self.create()

    def create(self, dataset=DEMO_DATASET):
        return self.store.create({'startDate': '2026-11-10', 'endDate': '2026-11-11',
                                  'memberNames': ['가상 A', '가상 B', '가상 C'],
                                  'dataset': dataset})

    def save(self, index, ids, room=None):
        room = room or self.room
        member = room['members'][index]
        return self.store.save_longlist(room['roomId'], member['id'],
                                        member['submissionToken'], {'longlist': ids})

    def submit(self, index, ids, picks=None):
        member = self.room['members'][index]
        return self.store.submit(self.room['roomId'], member['id'], member['submissionToken'],
                                 {'longlist': ids, 'picks': picks or [], 'must': None,
                                  'veto': None, 'budgetPerDay': 50000, 'stepLimit': 10000,
                                  'activeMin': 480})

    def counts(self, dataset=DEMO_DATASET):
        return build_counts(self.db, dataset)

    def pairs(self):
        return {tuple(p['placeIds']): p['listCount'] for p in self.counts()['pairs']}

    def test_only_pairs_in_the_same_members_p3_list_count(self):
        self.save(0, ['glico', 'kuromon', 'umeda_sky'])
        self.save(1, ['kuromon', 'glico'])
        self.save(2, ['umeda_sky'])
        self.assertEqual(self.pairs(), {('glico', 'kuromon'): 2,
                                      ('glico', 'umeda_sky'): 1,
                                      ('kuromon', 'umeda_sky'): 1})
        counts = self.counts()
        self.assertEqual(counts['savedListCount'], 3)
        self.assertEqual(counts['nonEmptyListCount'], 3)
        self.assertEqual(counts['pairListCount'], 2)
        self.assertEqual(counts['placeCounts'], [{'placeId': p, 'listCount': 2}
                                               for p in ['glico', 'kuromon', 'umeda_sky']])

    def test_room_union_does_not_invent_a_pair(self):
        self.save(0, ['glico'])
        self.save(1, ['kuromon'])
        self.assertEqual(self.pairs(), {})

    def test_repeated_save_reordering_and_restart_do_not_add_votes(self):
        self.save(0, ['glico', 'kuromon'])
        self.save(0, ['kuromon', 'glico'])
        self.save(0, ['glico', 'kuromon'])
        self.store = Store(self.db)
        self.assertEqual(self.pairs(), {('glico', 'kuromon'): 1})
        self.assertEqual(self.counts()['savedListCount'], 1)

    def test_removal_and_clearing_reduce_counts(self):
        self.save(0, ['glico', 'kuromon', 'umeda_sky'])
        self.save(1, ['glico', 'kuromon'])
        self.save(0, ['glico', 'umeda_sky'])
        self.assertEqual(self.pairs(), {('glico', 'kuromon'): 1, ('glico', 'umeda_sky'): 1})
        self.save(0, [])
        self.save(1, [])
        self.assertEqual(self.pairs(), {})
        self.assertEqual(self.counts()['savedListCount'], 2)
        self.assertEqual(self.counts()['nonEmptyListCount'], 0)

    def test_submission_longlist_is_fallback_not_picks_or_must(self):
        self.submit(0, ['glico', 'kuromon'], picks=['umeda_sky'])
        self.assertEqual(self.pairs(), {('glico', 'kuromon'): 1})
        self.assertEqual(self.counts()['sourceCounts'], {'p3': 0, 'submissionFallback': 1})

    def test_explicit_p3_wins_even_if_submission_is_newer(self):
        self.save(0, ['glico', 'kuromon'])
        self.submit(0, ['glico', 'umeda_sky'])
        self.assertEqual(self.pairs(), {('glico', 'kuromon'): 1})
        self.assertEqual(self.counts()['sourceCounts'], {'p3': 1, 'submissionFallback': 0})

    def test_empty_p3_does_not_resurrect_old_submission(self):
        self.submit(0, ['glico', 'kuromon'])
        self.save(0, [])
        self.assertEqual(self.pairs(), {})
        self.assertEqual(self.counts()['sourceCounts'], {'p3': 1, 'submissionFallback': 0})

    def test_legacy_db_without_p3_table_uses_submissions_without_migration(self):
        self.submit(0, ['glico', 'kuromon'])
        with self.store.connect() as c:
            c.execute('DROP TABLE longlists')
        self.assertEqual(self.pairs(), {('glico', 'kuromon'): 1})
        self.assertEqual(self.counts()['sourceCounts'], {'p3': 0, 'submissionFallback': 1})
        with self.store.connect() as c:
            self.assertIsNone(c.execute("SELECT name FROM sqlite_master WHERE name='longlists'").fetchone())

    def test_missing_required_source_table_is_not_a_successful_empty_count(self):
        with self.store.connect() as c:
            c.execute('DROP TABLE submissions')
        with self.assertRaises(sqlite3.OperationalError):
            self.counts()

    def test_same_named_members_in_different_rooms_are_separate_lists(self):
        other = self.create()
        self.save(0, ['glico', 'kuromon'])
        self.save(0, ['glico', 'kuromon'], other)
        self.assertEqual(self.pairs(), {('glico', 'kuromon'): 2})
        self.assertEqual(self.counts()['countUnit'], 'room_member_list')

    def test_demo_and_real_are_never_combined(self):
        real = self.create(REAL_DATASET)
        real_ids = sorted(co_picks.catalog_ids(REAL_DATASET))[:2]
        self.save(0, ['glico', 'kuromon'])
        self.save(0, real_ids, real)
        real_counts = build_counts(self.db)  # Real data is the default.
        self.assertEqual(real_counts['savedListCount'], 1)
        self.assertEqual(real_counts['pairs'], [{'placeIds': real_ids, 'listCount': 1}])
        self.assertEqual(self.pairs(), {('glico', 'kuromon'): 1})

    def test_unknown_custom_and_retired_ids_do_not_create_votes(self):
        # Simulate retained old input; Store without a demo catalogue permits these.
        self.save(0, ['glico', 'kuromon', 'unknown', 'custom_local'])
        self.assertEqual(self.pairs(), {('glico', 'kuromon'): 1})
        self.assertEqual(self.counts()['ignoredPlaceSelections'], 2)
        with patch('co_picks.catalog_ids', return_value={'glico'}):
            self.assertEqual(self.pairs(), {})
            self.assertEqual(self.counts()['ignoredPlaceSelections'], 3)

    def test_real_catalog_excludes_removed_but_retains_known_search_only(self):
        fixture = Path(self.tmp.name) / 'catalog.json'
        fixture.write_text(json.dumps({'places': [
            {'place': {'place_id': 'removed'}, 'review': {'final_csv': {'record_status': '제외'}}},
            {'place': {'place_id': 'search_only'}, 'review': {'recommendation_blockers': ['hours']}},
        ]}), encoding='utf-8')
        with patch('co_picks.DATA', fixture):
            self.assertEqual(co_picks.catalog_ids(REAL_DATASET), {'search_only'})

    def test_historical_duplicate_ids_count_once_without_self_pair(self):
        self.save(0, ['glico', 'kuromon'])
        with self.store.connect() as c:
            c.execute('UPDATE longlists SET ids=?', ('["glico","glico","kuromon"]',))
        self.assertEqual(self.pairs(), {('glico', 'kuromon'): 1})

    def test_unsubmitted_members_and_empty_database_do_not_get_synthetic_votes(self):
        counts = self.counts()
        self.assertEqual(counts['savedListCount'], 0)
        self.assertEqual(counts['pairs'], [])
        self.assertEqual(counts['placeCounts'], [])
        self.save(0, [])
        self.assertEqual(self.counts()['savedListCount'], 1)

    def test_deleted_source_lists_are_not_retained_in_next_snapshot(self):
        self.save(0, ['glico', 'kuromon'])
        self.assertEqual(len(self.pairs()), 1)
        with self.store.connect() as c:
            c.execute('DELETE FROM longlists')
        self.assertEqual(self.pairs(), {})

    def test_export_omits_identities_and_does_not_modify_database(self):
        self.save(0, ['glico', 'kuromon'])
        with self.store.connect() as c:
            before = list(c.iterdump())
        counts = self.counts()
        raw = json.dumps(counts, ensure_ascii=False)
        self.assertNotIn(self.room['roomId'], raw)
        self.assertNotIn(self.room['ownerToken'], raw)
        for member in self.room['members']:
            for value in member.values():
                self.assertNotIn(value, raw)
        with self.store.connect() as c:
            self.assertEqual(list(c.iterdump()), before)

    def test_live_update_cannot_mix_two_versions_of_room(self):
        with self.store.connect() as c:
            c.execute('PRAGMA journal_mode=WAL')
        self.save(0, ['glico', 'kuromon'])
        self.save(1, ['glico', 'kuromon'])
        decode = co_picks._ids
        changed = False

        def update_during_read(row):
            nonlocal changed
            if not changed:
                changed = True
                with self.store.connect() as writer:
                    writer.execute("UPDATE longlists SET ids='[]'")
            return decode(row)

        with patch('co_picks._ids', side_effect=update_during_read):
            self.assertEqual(self.pairs(), {('glico', 'kuromon'): 2})
        self.assertEqual(self.pairs(), {})

    def test_malformed_input_fails_without_overwriting_last_good_export(self):
        output = Path(self.tmp.name) / 'counts.json'
        output.write_text('previous snapshot', encoding='utf-8')
        self.save(0, ['glico', 'kuromon'])
        for invalid in ['not json', '{}', '[null]', '["glico",1]']:
            with self.subTest(invalid=invalid), self.store.connect() as c:
                c.execute('UPDATE longlists SET ids=?', (invalid,))
            with self.assertRaises(ValueError):
                self.counts()
        with self.assertRaises(SystemExit) as error, contextlib.redirect_stderr(io.StringIO()):
            co_picks.main(['--db', str(self.db), '--dataset', DEMO_DATASET, '--output', str(output)])
        self.assertEqual(error.exception.code, 1)
        self.assertEqual(output.read_text(), 'previous snapshot')

    def test_missing_db_is_error_not_a_new_empty_database(self):
        missing = Path(self.tmp.name) / 'missing.sqlite3'
        with self.assertRaises(sqlite3.OperationalError):
            build_counts(missing)
        self.assertFalse(missing.exists())

    def test_cli_exports_counts_and_refuses_database_as_output(self):
        self.save(0, ['glico', 'kuromon'])
        output = Path(self.tmp.name) / 'exports/co_pick_counts.json'
        with contextlib.redirect_stdout(io.StringIO()):
            co_picks.main(['--db', str(self.db), '--dataset', DEMO_DATASET, '--output', str(output)])
        exported = json.loads(output.read_text())
        self.assertEqual(exported['pairs'], [{'placeIds': ['glico', 'kuromon'], 'listCount': 1}])
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        before = self.db.read_bytes()
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            co_picks.main(['--db', str(self.db), '--output', str(self.db)])
        self.assertEqual(self.db.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
