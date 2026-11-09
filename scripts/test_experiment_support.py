import json
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

import experiment_support as support


class ExperimentSupportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        data = self.root / 'data'
        data.mkdir()
        (data / 'runtime_catalog.json').write_text(json.dumps({
            'catalog': 'catalog.json', 'profiles': 'profiles.json', 'version': 'test'}))
        (data / 'catalog.json').write_text(json.dumps({'places': [{'place': {'place_id': 'one'}}]}))
        (data / 'profiles.json').write_text('{"places": {}}')
        self.root_patch = patch.object(support, 'ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.commit_patch = patch.object(support, 'clean_commit', return_value='fixed-commit')
        self.commit_patch.start()
        self.addCleanup(self.commit_patch.stop)
        self.bundle = self.root / 'bundle'
        support.prepare(self.bundle)

    def database(self, group='rehearsal'):
        directory = support.group_dir(self.bundle, group)
        directory.mkdir(parents=True)
        path = directory / 'trips.sqlite3'
        with closing(sqlite3.connect(path)) as db:
            for name in support.TABLES:
                db.execute(f'CREATE TABLE {name} (id TEXT)')
            db.execute("INSERT INTO rooms VALUES ('private-room-value')")
            db.commit()
        support.write_json(directory / 'rehearsal.json', {'rate': '9', 'port': 8111})
        return path

    def test_prepare_freezes_sources_without_changing_originals(self):
        original = self.root / 'data/catalog.json'
        original.write_text('{"places": []}')
        manifest = support.verify(self.bundle, code=True)
        self.assertEqual(manifest['catalog_rows'], 1)
        self.assertEqual(manifest['travel_dates'], None)
        self.assertEqual(manifest['recommendation_card_policy'], 'pending_team_decision')
        self.assertEqual(len(support.read_json(self.bundle / 'catalog.json')['places']), 1)

    def test_prepare_never_overwrites_existing_bundle(self):
        before = support.digest(self.bundle / 'manifest.json')
        with self.assertRaises(FileExistsError):
            support.prepare(self.bundle)
        self.assertEqual(before, support.digest(self.bundle / 'manifest.json'))

    def test_corrupted_data_blocks_verification(self):
        (self.bundle / 'profiles.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, '데이터가 준비 이후'):
            support.verify(self.bundle)

    def test_changed_commit_blocks_execution_but_not_recovery(self):
        with patch.object(support, 'clean_commit', return_value='new-code'):
            with self.assertRaisesRegex(ValueError, '코드와 다릅니다'):
                support.verify(self.bundle, code=True)
            support.verify(self.bundle)

    def test_dirty_checkout_rejected(self):
        self.commit_patch.stop()
        with patch.object(support, 'git', return_value=' M backend/server.py'):
            with self.assertRaisesRegex(ValueError, '커밋'):
                support.clean_commit()

    def test_group_paths_cannot_escape_or_use_symlinks(self):
        for group in ('../escape', '/tmp/escape', '.', 'a/b', ''):
            with self.subTest(group=group), self.assertRaises(ValueError):
                support.group_dir(self.bundle, group)
        (self.bundle / 'groups').symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            support.group_dir(self.bundle, 'group1')

    def test_group_server_lock_rejects_second_launcher(self):
        path = self.database().parent
        with support.group_lock(path):
            with self.assertRaisesRegex(ValueError, '이미 실행 중'):
                with support.group_lock(path):
                    self.fail('second server started')
        with support.group_lock(path):
            pass

    def test_missing_db_does_not_create_empty_database(self):
        missing = self.root / 'missing.sqlite3'
        with self.assertRaises(ValueError):
            support.database_summary(missing)
        self.assertFalse(missing.exists())

    def test_wrong_or_corrupt_database_is_rejected(self):
        path = self.root / 'wrong.sqlite3'
        with closing(sqlite3.connect(path)) as db:
            db.execute('CREATE TABLE unrelated (x TEXT)')
        with self.assertRaisesRegex(ValueError, 'DB 구조'):
            support.database_summary(path)
        path.write_bytes(b'broken sqlite')
        with self.assertRaises(sqlite3.DatabaseError):
            support.database_summary(path)

    def test_summary_contains_counts_not_participant_values(self):
        result = support.database_summary(self.database())
        self.assertEqual(result['counts']['rooms'], 1)
        self.assertNotIn('private-room-value', json.dumps(result))

    def test_backup_includes_committed_wal_and_excludes_uncommitted_rows(self):
        source = self.database()
        out = self.root / 'backup.sqlite3'
        with closing(sqlite3.connect(source)) as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute("INSERT INTO rooms VALUES ('committed')")
            db.commit()
            db.execute("INSERT INTO rooms VALUES ('uncommitted')")
            result = support.backup(self.bundle, 'rehearsal', out)
            self.assertEqual(result['counts']['rooms'], 2)
            db.rollback()
        self.assertEqual(support.database_summary(out)['counts']['rooms'], 2)
        self.assertEqual(out.stat().st_mode & 0o777, 0o600)

    def test_backup_never_overwrites_source_or_existing_destination(self):
        source = self.database()
        original = support.digest(source)
        with self.assertRaisesRegex(ValueError, '이미 있습니다'):
            support.backup(self.bundle, 'rehearsal', source)
        self.assertEqual(original, support.digest(source))

    def test_restore_preserves_original_and_requires_new_group(self):
        source = self.database()
        original = support.digest(source)
        out = self.root / 'backup.sqlite3'
        support.backup(self.bundle, 'rehearsal', out)
        support.restore(self.bundle, out, 'recovered')
        self.assertEqual(original, support.digest(source))
        recovered = support.group_dir(self.bundle, 'recovered')
        self.assertEqual(support.database_summary(recovered / 'trips.sqlite3')['counts']['rooms'], 1)
        self.assertEqual(support.read_json(recovered / 'rehearsal.json'), {'rate': '9', 'port': 8111})
        with self.assertRaises(FileExistsError):
            support.restore(self.bundle, out, 'recovered')
        with self.assertRaises(FileExistsError):
            support.restore(self.bundle, out, 'rehearsal')

    def test_restore_rejects_modified_or_different_bundle_backup(self):
        self.database()
        out = self.root / 'backup.sqlite3'
        support.backup(self.bundle, 'rehearsal', out)
        with closing(sqlite3.connect(out)) as db:
            db.execute("INSERT INTO rooms VALUES ('modified')")
            db.commit()
        with self.assertRaisesRegex(ValueError, '해시'):
            support.restore(self.bundle, out, 'recovered')
        self.assertFalse(support.group_dir(self.bundle, 'recovered').exists())
        out2 = self.root / 'backup2.sqlite3'
        support.backup(self.bundle, 'rehearsal', out2)
        manifest = support.read_json(self.bundle / 'manifest.json')
        manifest['commit'] = 'other'
        (self.bundle / 'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, '버전'):
            support.restore(self.bundle, out2, 'recovered')

    def test_rehearsal_env_drops_inherited_paid_and_debug_settings(self):
        with patch.dict(os.environ, {'SOMSOM_API_KEY': 'private', 'AI_MOCK': '1',
                                     'NODE_OPTIONS': '--require=evil.js', 'OSRM_FOOT_URL': 'https://external',
                                     'JPY_TO_KRW': '999', 'WEATHER_ENABLED': '1'}):
            env = support.offline_env(self.bundle, '/test/node')
        self.assertEqual(env['SOMSOM_API_KEY'], '')
        self.assertEqual(env['WEATHER_ENABLED'], '0')
        self.assertEqual(env['OSRM_FOOT_URL'], '')
        self.assertEqual(env['AI_MOCK'], '')
        self.assertNotIn('NODE_OPTIONS', env)
        self.assertNotIn('JPY_TO_KRW', env)

    def test_invalid_dates_do_not_run_node(self):
        for start, end in [('2026-11-30', '2026-11-01'), ('2026-11-01', '2026-12-31'),
                           ('2026-02-30', '2026-03-01')]:
            with self.subTest(start=start), patch.object(support.subprocess, 'run') as run:
                with self.assertRaises(ValueError):
                    support.audit(self.bundle, start, end, '/test/node')
                run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
