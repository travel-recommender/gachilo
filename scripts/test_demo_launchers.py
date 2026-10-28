import json, os, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import demo_server as server
from demo_osrm import lima_home
from demo_runtime import settings, executable

class DemoLauncherTests(unittest.TestCase):
 def test_config_paths_and_environment_precedence(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);path=root/'.local/demo/runtime.json';path.parent.mkdir(parents=True)
   path.write_text(json.dumps({'NODE_BINARY':'/config/node','LIMA_HOME':'/config/lima'}))
   with patch.dict(os.environ,{'NODE_BINARY':'/env/node'},clear=True):
    self.assertEqual(settings(root)['NODE_BINARY'],'/env/node')
    self.assertEqual(settings(root)['LIMA_HOME'],'/config/lima')
   with patch('demo_runtime.shutil.which',return_value='/bin/node') as which:
    self.assertEqual(executable(None,'node'),'/bin/node');which.assert_called_once_with('node')
 def test_full_width_process_matching_handles_long_paths(self):
  from types import SimpleNamespace
  record={'pid':123,'marker':'marker'}
  with patch.object(server,'record',return_value=record),patch.object(server.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=str(server.ROOT)+' '*1000+'marker')) as run:
   self.assertEqual(server.owned('api'),record)
   self.assertIn('-ww',run.call_args[0][0])
 def test_slow_stop_is_failure_and_retains_record(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(server,'STATE',Path(tmp)),patch.object(server,'owned',return_value={'pid':123,'marker':'x'}),patch.object(server,'occupied',return_value=True),patch.object(server.os,'killpg'),patch.object(server.time,'sleep'):
   record=Path(tmp)/'api.json';record.write_text('{}')
   with self.assertRaisesRegex(SystemExit,'종료를 확인하지 못했습니다'):server.stop('api')
   self.assertTrue(record.exists())
 def test_verified_stop_clears_only_process_record(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(server,'STATE',Path(tmp)),patch.object(server,'owned',side_effect=[{'pid':123,'marker':'x'},None,None]),patch.object(server,'occupied',return_value=False),patch.object(server.os,'killpg'):
   record=Path(tmp)/'api.json';record.write_text('{}');db=Path(tmp)/'keep.sqlite3';db.write_text('keep')
   server.stop('api');self.assertFalse(record.exists());self.assertEqual(db.read_text(),'keep')
 def test_status_and_stop_do_not_create_links(self):
  with tempfile.TemporaryDirectory() as tmp:
   vm=Path(tmp)/'vm';vm.mkdir();link=Path(tmp)/'link'
   for action in ['status','stop']:
    with self.assertRaises(SystemExit):lima_home(vm,link,action)
    self.assertFalse(link.is_symlink())
   self.assertEqual(lima_home(vm,link,'start'),link);self.assertTrue(link.samefile(vm))
   self.assertEqual(lima_home(vm,link,'status'),link)
 def test_dangling_or_unrelated_paths_are_not_overwritten(self):
  with tempfile.TemporaryDirectory() as tmp:
   vm=Path(tmp)/'vm';vm.mkdir();link=Path(tmp)/'link';missing=Path(tmp)/'missing'
   link.symlink_to(missing)
   with self.assertRaises(SystemExit):lima_home(vm,link,'start')
   self.assertEqual(link.readlink(),missing)
 def test_api_restart_requires_node_because_engine_needs_it(self):
  with patch.object(server.sys,'argv',['demo_server.py','api-start']),patch.object(server,'NODE',''),patch.object(server,'api') as api:
   with self.assertRaisesRegex(SystemExit,'Node.js 24'):server.main()
   api.assert_not_called()
 def test_api_restart_uses_configured_node_without_web_build(self):
  with patch.object(server.sys,'argv',['demo_server.py','api-start']),patch.object(server,'NODE','/configured/node'),patch.object(server.subprocess,'check_output',return_value='24.1.0'),patch.object(server,'api') as api,patch.object(server.subprocess,'run') as run:
   server.main();api.assert_called_once();run.assert_not_called()
if __name__=='__main__':unittest.main()
