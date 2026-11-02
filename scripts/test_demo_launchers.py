import json, os, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import demo_server as server
from demo_osrm import lima_home
from demo_runtime import settings, executable

class DemoLauncherTests(unittest.TestCase):
 def test_invalid_runtime_does_not_block_server_stop_or_status(self):
  import runpy
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);path=root/'.local/demo/runtime.json';path.parent.mkdir(parents=True)
   for invalid in ['{"NODE_BINARY":', '{"NODE_BINARY":false}']:
    path.write_text(invalid)
    for action in ['stop','api-stop','status']:
     with self.subTest(config=invalid,action=action),patch('demo_runtime.settings',side_effect=lambda _:settings(root)) as read,patch('pathlib.Path.exists',return_value=False),patch('socket.socket'),patch('urllib.request.urlopen',side_effect=OSError('offline')),patch('sys.argv',['demo_server.py',action]):
      runpy.run_path(str(Path(server.__file__)),run_name='__main__')
      read.assert_not_called()
 def test_invalid_json_is_a_friendly_start_error_without_spawning(self):
  import runpy
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);path=root/'.local/demo/runtime.json';path.parent.mkdir(parents=True)
   path.write_text('{"NODE_BINARY":')
   for action in ['start','api-start']:
    with self.subTest(action=action),patch('demo_runtime.settings',side_effect=lambda _:settings(root)),patch('sys.argv',['demo_server.py',action]),patch('subprocess.Popen') as spawn:
     with self.assertRaisesRegex(SystemExit,'runtime.json.*JSON.*확인'):
      runpy.run_path(str(Path(server.__file__)),run_name='__main__')
     spawn.assert_not_called()
 def test_null_runtime_paths_use_defaults_without_creating_none_link(self):
  import demo_osrm as osrm
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);path=root/'.local/demo/runtime.json';path.parent.mkdir(parents=True)
   vm=root/'vm';(vm/'gachilo-osrm').mkdir(parents=True);(vm/'gachilo-osrm/lima.yaml').write_text('{}')
   path.write_text(json.dumps({'LIMA_HOME':str(vm),'LIMACTL':None,'OSRM_LIMA_LINK':None}))
   with patch.dict(os.environ,{},clear=True):config=settings(root)
   self.assertNotIn('LIMACTL',config);self.assertNotIn('OSRM_LIMA_LINK',config)
   with patch.object(osrm,'ROOT',root),patch.object(osrm,'settings',return_value=config),patch.object(osrm,'executable',return_value='/bin/limactl') as tool,patch.object(osrm,'lima_home',wraps=lima_home) as home,patch.object(osrm.subprocess,'run') as run,patch('sys.argv',['demo_osrm.py','start']):
    osrm.main()
   tool.assert_called_once_with(None,'limactl');home.assert_called_once_with(vm.resolve(),None,'start')
   self.assertEqual(run.call_count,2)
   self.assertEqual(run.call_args.kwargs['env']['LIMA_HOME'],str(vm.resolve()))
 def test_boolean_runtime_flags_are_lowercase_but_path_booleans_are_rejected(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);path=root/'.local/demo/runtime.json';path.parent.mkdir(parents=True)
   path.write_text(json.dumps({'FLAG_ON':True,'FLAG_OFF':False}))
   with patch.dict(os.environ,{},clear=True):
    self.assertEqual(settings(root),{'FLAG_ON':'true','FLAG_OFF':'false'})
    for key in ['NODE_BINARY','LIMACTL','LIMA_HOME','OSRM_LIMA_LINK','OSRM_VM_NAME','OSRM_CONTAINER_NAME']:
     path.write_text(json.dumps({key:False}))
     with self.assertRaisesRegex(SystemExit,key):settings(root)
 def test_numeric_runtime_values_reach_child_process_as_strings(self):
  import runpy, subprocess, sys
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);path=root/'.local/demo/runtime.json';path.parent.mkdir(parents=True)
   path.write_text(json.dumps({'JPY_TO_KRW':9.5,'OSRM_TIMEOUT_MS':2000,'DEMO_DATASET':'prototype_demo_36'}))
   with patch.dict(os.environ,{},clear=True),patch('demo_runtime.settings',side_effect=lambda _:settings(root)),patch('demo_runtime.executable',return_value=''):
    configure=runpy.run_path(str(Path(server.__file__)))['configure'];configure();env=configure.__globals__['ENV']
   result=subprocess.run([sys.executable,'-c','import os; print(os.environ["JPY_TO_KRW"], os.environ["OSRM_TIMEOUT_MS"])'],env=env,capture_output=True,text=True,check=True)
   self.assertEqual(result.stdout.strip(),'9.5 2000')
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
  with patch.object(server,'configure'),patch.object(server.sys,'argv',['demo_server.py','api-start']),patch.object(server,'NODE',''),patch.object(server,'api') as api:
   with self.assertRaisesRegex(SystemExit,'Node.js 24'):server.main()
   api.assert_not_called()
 def test_api_restart_uses_configured_node_without_web_build(self):
  with patch.object(server,'configure'),patch.object(server.sys,'argv',['demo_server.py','api-start']),patch.object(server,'NODE','/configured/node'),patch.object(server.subprocess,'check_output',return_value='24.1.0'),patch.object(server,'api') as api,patch.object(server.subprocess,'run') as run:
   server.main();api.assert_called_once();run.assert_not_called()
 def test_stop_attempts_both_services_after_one_fails(self):
  with patch.object(server.sys,'argv',['demo_server.py','stop']),patch.object(server,'stop',side_effect=[SystemExit('web slow'),None]) as stop:
   with self.assertRaisesRegex(SystemExit,'web slow'):server.main()
   self.assertEqual([c.args[0] for c in stop.call_args_list],['web','api'])
 def test_owned_but_unhealthy_is_not_reported_ready(self):
  with patch.object(server,'owned',return_value={'pid':123}),patch.object(server,'healthy',return_value=False),patch.object(server.subprocess,'Popen') as spawn:
   with self.assertRaisesRegex(SystemExit,'stop 후 다시 시작'):server.start('web',[],123,'http://test','marker')
   spawn.assert_not_called()
 def test_config_applies_dataset_routing_and_fx_without_dot_path(self):
  import runpy
  with patch('demo_runtime.settings',return_value={'DEMO_DATASET':'osaka_review_150','OSRM_FOOT_URL':'http://127.0.0.1:9999','OSRM_TIMEOUT_MS':1234,'JPY_TO_KRW':'9.5'}),patch('demo_runtime.executable',return_value=''),patch.dict(os.environ,{'PATH':'/bin'},clear=True):
   configure=runpy.run_path(str(Path(server.__file__)))['configure'];configure();env=configure.__globals__['ENV']
   self.assertEqual(env['PATH'],'/bin')
   self.assertEqual(env['NEXT_PUBLIC_DATASET'],'osaka_review_150')
   self.assertEqual(env['OSRM_FOOT_URL'],'http://127.0.0.1:9999')
   self.assertEqual(env['OSRM_TIMEOUT_MS'],'1234')
   self.assertEqual(env['JPY_TO_KRW'],'9.5')
 def test_lima_command_failure_is_an_explicit_friendly_failure(self):
  import demo_osrm as osrm
  with tempfile.TemporaryDirectory() as tmp:
   vm=Path(tmp);(vm/'gachilo-osrm').mkdir();(vm/'gachilo-osrm/lima.yaml').write_text('{}')
   with patch.object(osrm,'ROOT',vm),patch.object(osrm,'settings',return_value={'LIMA_HOME':tmp}),patch.object(osrm,'executable',return_value='/bin/limactl'),patch('sys.argv',['demo_osrm.py','status']),patch.object(osrm.subprocess,'run',side_effect=osrm.subprocess.CalledProcessError(1,['limactl'])):
    with self.assertRaisesRegex(SystemExit,'OSRM status 실행을 확인하지 못했습니다'):osrm.main()
 def test_osrm_control_ignores_unrelated_invalid_settings(self):
  import demo_osrm as osrm
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);path=root/'.local/demo/runtime.json';path.parent.mkdir(parents=True)
   vm=root/'vm';(vm/'custom-osrm').mkdir(parents=True);(vm/'custom-osrm/lima.yaml').write_text('{}')
   path.write_text(json.dumps({'NODE_BINARY':1,'OSRM_CONTAINER_NAME':False,'LIMA_HOME':str(vm),'OSRM_VM_NAME':'custom-osrm'}))
   for action in ['stop','status']:
    with self.subTest(action=action),patch.dict(os.environ,{},clear=True),patch.object(osrm,'ROOT',root),patch.object(osrm,'executable',return_value='/bin/limactl'),patch.object(osrm.subprocess,'run') as run,patch('sys.argv',['demo_osrm.py',action]):
     osrm.main()
     self.assertEqual(run.call_args.args[0],['/bin/limactl','stop' if action=='stop' else 'list','custom-osrm'])
     self.assertEqual(run.call_args.kwargs['env']['LIMA_HOME'],str(vm.resolve()))
   self.assertFalse((root/'.local/demo/osrm.json').exists())
 def test_osrm_saved_target_survives_bad_runtime_and_ignores_retargeting(self):
  import demo_osrm as osrm
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);path=root/'.local/demo/runtime.json';path.parent.mkdir(parents=True)
   vm=root/'vm';(vm/'custom-osrm').mkdir(parents=True);(vm/'custom-osrm/lima.yaml').write_text('{}')
   link=root/'short-link'
   path.write_text(json.dumps({'LIMACTL':'/configured/limactl','LIMA_HOME':str(vm),'OSRM_VM_NAME':'custom-osrm','OSRM_LIMA_LINK':str(link)}))
   with patch.dict(os.environ,{},clear=True),patch.object(osrm,'ROOT',root),patch.object(osrm,'executable',return_value='/configured/limactl'),patch.object(osrm.subprocess,'run') as run,patch('sys.argv',['demo_osrm.py','start']):
    osrm.main();self.assertEqual(run.call_count,2)
   self.assertTrue((root/'.local/demo/osrm.json').is_file())
   for invalid in ['{bad json', '{"NODE_BINARY":1}', '{"LIMA_HOME":"/unrelated"}']:
    path.write_text(invalid)
    for action in ['stop','status']:
     with self.subTest(config=invalid,action=action),patch.object(osrm,'ROOT',root),patch.object(osrm,'executable',return_value='/configured/limactl'),patch.object(osrm.subprocess,'run') as run,patch('sys.argv',['demo_osrm.py',action]),patch.object(osrm,'settings') as read:
      osrm.main();read.assert_not_called()
      self.assertEqual(run.call_args.args[0],['/configured/limactl','stop' if action=='stop' else 'list','custom-osrm'])
      self.assertEqual(run.call_args.kwargs['env']['LIMA_HOME'],str(link))
   link.unlink();link.symlink_to(root/'unrelated')
   with patch.object(osrm,'ROOT',root),patch.object(osrm,'executable',return_value='/configured/limactl'),patch.object(osrm.subprocess,'run') as run,patch('sys.argv',['demo_osrm.py','stop']):
    with self.assertRaisesRegex(SystemExit,'링크가 깨졌거나'):osrm.main()
    run.assert_not_called()
 def test_osrm_corrupt_config_without_record_requires_explicit_target(self):
  import demo_osrm as osrm
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);path=root/'.local/demo/runtime.json';path.parent.mkdir(parents=True);path.write_text('{bad json')
   vm=root/'vm';(vm/'custom-osrm').mkdir(parents=True);(vm/'custom-osrm/lima.yaml').write_text('{}')
   for action in ['stop','status']:
    with self.subTest(action=action),patch.dict(os.environ,{},clear=True),patch.object(osrm,'ROOT',root),patch.object(osrm.subprocess,'run') as run,patch('sys.argv',['demo_osrm.py',action]):
     with self.assertRaisesRegex(SystemExit,'LIMACTL.*LIMA_HOME.*OSRM_VM_NAME'):osrm.main()
     run.assert_not_called()
    env={'LIMACTL':'/configured/limactl','LIMA_HOME':str(vm),'OSRM_VM_NAME':'custom-osrm'}
    with patch.dict(os.environ,env,clear=True),patch.object(osrm,'ROOT',root),patch.object(osrm,'executable',return_value='/configured/limactl'),patch.object(osrm.subprocess,'run') as run,patch('sys.argv',['demo_osrm.py',action]):
     osrm.main();self.assertEqual(run.call_args.args[0][-1],'custom-osrm')
 def test_osrm_invalid_saved_target_never_falls_back_to_other_vm(self):
  import demo_osrm as osrm
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);path=root/'.local/demo/osrm.json';path.parent.mkdir(parents=True)
   for invalid in ['{bad', '{}', '{"LIMACTL":true}']:
    path.write_text(invalid)
    with self.subTest(config=invalid),patch.object(osrm,'ROOT',root),patch.object(osrm.subprocess,'run') as run,patch('sys.argv',['demo_osrm.py','stop']):
     with self.assertRaisesRegex(SystemExit,'실행 기록'):osrm.main()
     run.assert_not_called()
 def test_osrm_complete_environment_recovers_stale_or_corrupt_record(self):
  import demo_osrm as osrm
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);record=root/'.local/demo/osrm.json';record.parent.mkdir(parents=True)
   (record.parent/'runtime.json').write_text('{bad runtime')
   vm=root/'moved-vm';(vm/'moved-osrm').mkdir(parents=True);(vm/'moved-osrm/lima.yaml').write_text('{}')
   link=root/'new-link';link.symlink_to(vm)
   stale=json.dumps({'LIMACTL':'/old/limactl','LIMA_HOME':str(root/'old-vm'),'OSRM_VM_NAME':'old-osrm','OSRM_LIMA_LINK':str(root/'old-link')})
   for saved in [stale,'{bad record']:
    for use_link in [False,True]:
     for action in ['stop','status']:
      record.write_text(saved)
      env={'LIMACTL':'/new/limactl','LIMA_HOME':str(vm),'OSRM_VM_NAME':'moved-osrm'}
      if use_link:env['OSRM_LIMA_LINK']=str(link)
      with self.subTest(saved=saved,link=use_link,action=action),patch.dict(os.environ,env,clear=True),patch.object(osrm,'ROOT',root),patch.object(osrm,'executable',side_effect=lambda value,name: value if value=='/new/limactl' else '') as tool,patch.object(osrm.subprocess,'run') as run,patch('sys.argv',['demo_osrm.py',action]):
       osrm.main()
       tool.assert_called_once_with('/new/limactl','limactl')
       self.assertEqual(run.call_args.args[0],['/new/limactl','stop' if action=='stop' else 'list','moved-osrm'])
       self.assertEqual(run.call_args.kwargs['env']['LIMA_HOME'],str(link if use_link else vm.resolve()))
       self.assertEqual(record.read_text(),saved)
       self.assertFalse((root/'old-link').exists())
 def test_osrm_incomplete_override_preserves_record_and_explains_recovery(self):
  import demo_osrm as osrm
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);record=root/'.local/demo/osrm.json';record.parent.mkdir(parents=True)
   stale=json.dumps({'LIMACTL':'/old/limactl','LIMA_HOME':str(root/'old-vm'),'OSRM_VM_NAME':'old-osrm','OSRM_LIMA_LINK':None})
   for saved in [stale,'{bad record']:
    record.write_text(saved)
    for env in [{},{'LIMACTL':'/new/limactl'},{'LIMACTL':'/new/limactl','LIMA_HOME':'/new-vm','OSRM_VM_NAME':' '}]:
     for action in ['stop','status']:
      with self.subTest(saved=saved,env=env,action=action),patch.dict(os.environ,env,clear=True),patch.object(osrm,'ROOT',root),patch.object(osrm,'executable',return_value=''),patch.object(osrm.subprocess,'run') as run,patch('sys.argv',['demo_osrm.py',action]):
       with self.assertRaisesRegex(SystemExit,r'osrm.json.*LIMACTL.*LIMA_HOME.*OSRM_VM_NAME.*모두'):
        osrm.main()
       run.assert_not_called();self.assertEqual(record.read_text(),saved)
 def test_osrm_start_checks_only_osrm_settings(self):
  import demo_osrm as osrm
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);path=root/'.local/demo/runtime.json';path.parent.mkdir(parents=True)
   vm=root/'vm';(vm/'custom-osrm').mkdir(parents=True);(vm/'custom-osrm/lima.yaml').write_text('{}')
   config={'LIMACTL':'/configured/limactl','LIMA_HOME':str(vm),'OSRM_VM_NAME':'custom-osrm','OSRM_CONTAINER_NAME':'custom-foot','NODE_BINARY':24,'UNRELATED':['bad type']}
   path.write_text(json.dumps(config))
   with patch.dict(os.environ,{},clear=True),patch.object(osrm,'ROOT',root),patch.object(osrm,'executable',return_value='/configured/limactl'),patch.object(osrm.subprocess,'run') as run,patch('sys.argv',['demo_osrm.py','start']):
    osrm.main()
    self.assertEqual([c.args[0] for c in run.call_args_list],[['/configured/limactl','start','--tty=false','custom-osrm'],['/configured/limactl','shell','--workdir=/mnt/osrm-data','custom-osrm','nerdctl','start','custom-foot']])
   record=root/'.local/demo/osrm.json';saved=record.read_text()
   for key in ['LIMACTL','LIMA_HOME','OSRM_VM_NAME','OSRM_CONTAINER_NAME','OSRM_LIMA_LINK']:
    path.write_text(json.dumps({**config,key:False}))
    with self.subTest(key=key),patch.dict(os.environ,{},clear=True),patch.object(osrm,'ROOT',root),patch.object(osrm.subprocess,'run') as run,patch('sys.argv',['demo_osrm.py','start']):
     with self.assertRaisesRegex(SystemExit,key):osrm.main()
     run.assert_not_called();self.assertEqual(record.read_text(),saved)
if __name__=='__main__':unittest.main()
