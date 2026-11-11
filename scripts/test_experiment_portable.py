import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch, Mock

import experiment_network as network
import experiment_start as starter
import experiment_support as support


class PortableTests(unittest.TestCase):
    def test_mac_ignores_loopback_and_keeps_separate_adapter_addresses(self):
        self.assertEqual(network.parse_ifconfig('lo0: flags\n\tinet 127.0.0.1 netmask 0xff\nen0: flags\n\tinet 192.168.0.4 netmask 0xff\nutun0: flags\n\tinet 10.3.4.5 netmask 0xff'), [('192.168.0.4', 'en0'), ('10.3.4.5', 'utun0')])

    def test_windows_handles_single_adapter_json_and_korean_names(self):
        self.assertEqual(network.parse_windows('\ufeff{"IPAddress":"172.29.8.87","InterfaceAlias":"Wi-Fi"}'), [('172.29.8.87','Wi-Fi')])
        self.assertEqual(network.parse_windows(json.dumps([{'IPAddress':'192.168.1.7','InterfaceAlias':'무선 네트워크'},{'IPAddress':'169.254.1.2','InterfaceAlias':'끊김'}])), [('192.168.1.7','무선 네트워크')])

    def test_multiple_adapters_require_selection_instead_of_picking_vpn(self):
        with patch.object(network, 'discover', return_value=[('10.0.0.5','VPN'),('192.168.1.4','Wi-Fi')]), patch('builtins.input',side_effect=['','0','2']):
            self.assertEqual(network.choose_host(), '192.168.1.4')

    def test_host_changes_between_runs_and_rejects_public_or_injected_hosts(self):
        with patch.object(network, 'discover', side_effect=[[('192.168.1.4','Wi-Fi')],[('172.29.8.87','Wi-Fi')]]):
            self.assertNotEqual(network.choose_host(), network.choose_host())
        for bad in ('127.0.0.1','0.0.0.0','8.8.8.8','::1','192.168.1.4; echo secret'):
            with self.subTest(bad=bad), patch.object(network,'discover',return_value=[]), self.assertRaises(ValueError):
                network.choose_host(bad)

    def test_no_network_does_not_fall_back_to_last_machine_address(self):
        with patch.object(network,'discover',return_value=[]), self.assertRaisesRegex(ValueError,'Wi-Fi'):
            network.choose_host()

    def test_unassigned_private_address_cannot_start(self):
        with patch.object(network.socket,'socket') as sock:
            sock.return_value.__enter__.return_value.bind.side_effect=OSError('not assigned')
            with self.assertRaisesRegex(ValueError,'이 노트북'):
                network.ensure_local('192.168.1.4')

    def test_windows_discovery_uses_json_without_installing_or_changing_network(self):
        with patch.object(network.sys,'platform','win32'), patch.object(network.subprocess,'check_output',return_value='[{"IPAddress":"192.168.1.9","InterfaceAlias":"Wi-Fi"}]') as command, patch.object(network.socket,'socket',side_effect=OSError):
            self.assertEqual(network.discover(), [('192.168.1.9','Wi-Fi')])
            self.assertEqual(command.call_args.args[0][0], 'powershell.exe')
            self.assertIn('Get-NetIPAddress', command.call_args.args[0][-1])

    def test_windows_environment_retains_os_requirements_but_not_paid_or_debug_settings(self):
        with patch.dict(os.environ, {'SystemRoot':'C:\\Windows','TEMP':'C:\\Temp','SOMSOM_API_KEY':'secret','NODE_OPTIONS':'evil'}):
            env=support.offline_env(Path('/tmp/fixed'), '/node')
        self.assertEqual(env['SystemRoot'], 'C:\\Windows')
        self.assertEqual(env['TEMP'], 'C:\\Temp')
        self.assertEqual(env['SOMSOM_API_KEY'], '')
        self.assertNotIn('NODE_OPTIONS', env)
        self.assertEqual(env['PYTHONUTF8'], '1')

    def test_windows_lock_locks_and_unlocks_same_first_byte(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)
            api=types.SimpleNamespace(LK_NBLCK=2,LK_UNLCK=0,locking=Mock())
            with patch.object(support.os,'name','nt'), patch.object(support,'msvcrt',api,create=True):
                with support.group_lock(folder):
                    pass
            self.assertEqual([c.args[1:] for c in api.locking.call_args_list], [(2,1),(0,1)])

    def test_duplicate_windows_launcher_fails_before_yield(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)
            api=types.SimpleNamespace(LK_NBLCK=2,LK_UNLCK=0,locking=Mock(side_effect=OSError('locked')))
            with patch.object(support.os,'name','nt'), patch.object(support,'msvcrt',api,create=True), self.assertRaisesRegex(ValueError,'이미 실행'):
                with support.group_lock(folder):
                    self.fail('duplicate entered')

    def test_current_group_resume_keeps_existing_db_and_switches_only_network(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(starter,'ROOT',Path(directory)):
            local=Path(directory)/'.local';previous=local/'experiments/one-yunjin-live';previous.mkdir(parents=True)
            (previous/'manifest.json').write_text('{"commit":"same"}')
            (previous/'trips.sqlite3').write_bytes(b'preserve-user-data')
            (local/'experiment-last.json').write_text('{"yunjin-live":"one-yunjin-live"}')
            with patch.object(starter.support,'clean_commit',return_value='same'), patch.object(starter,'choose',return_value='resume'):
                result=starter.choose_bundle('yunjin','live')
            self.assertEqual(result[0], previous)
            self.assertEqual((previous/'trips.sqlite3').read_bytes(),b'preserve-user-data')

    def test_new_groups_and_rehearsal_have_distinct_storage(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(starter,'ROOT',Path(directory)):
            paths=[starter.choose_bundle(g,m,'friends')[0] for g,m in [('yunjin','live'),('hyein','live'),('joeun','live'),('yunjin','rehearsal')]]
            self.assertEqual(len(set(paths)),4)
            for bad in ('../other','/tmp/other','a/b',''):
                with self.assertRaises(ValueError):starter.choose_bundle('yunjin','live',bad)

    def test_live_requires_key_and_does_not_silently_use_mock(self):
        with patch.object(support,'node_binary',return_value='/node'), patch.dict(os.environ,{'GOOGLE_PLACES_API_KEY':'','LIVE_CHECK_MOCK':'pass','SOMSOM_API_KEY':'secret'}), patch.object(starter.sys.stdin,'isatty',return_value=False):
            with self.assertRaisesRegex(ValueError,'GOOGLE_PLACES_API_KEY'):starter.launch_env('live')
            env=starter.launch_env('rehearsal')
            self.assertNotIn('GOOGLE_PLACES_API_KEY',env)
            self.assertNotIn('LIVE_CHECK_MOCK',env)

    def test_live_key_only_goes_to_child_environment(self):
        with patch.object(support,'node_binary',return_value='/node'), patch.dict(os.environ,{'GOOGLE_PLACES_API_KEY':'secret-key','LIVE_CHECK_MOCK':'pass'}), patch.object(starter.getpass,'getpass') as prompt:
            env=starter.launch_env('live')
        self.assertEqual(env['GOOGLE_PLACES_API_KEY'],'secret-key')
        self.assertNotIn('LIVE_CHECK_MOCK',env)
        prompt.assert_not_called()

    def test_npm_is_run_through_node_instead_of_windows_shell(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory);cli=folder/'node_modules/npm/bin/npm-cli.js';cli.parent.mkdir(parents=True);cli.write_text('')
            with patch.object(starter.shutil,'which',return_value=None):
                self.assertEqual(starter.npm_cli(str(folder/'node.exe')),cli)


if __name__=='__main__':unittest.main()
