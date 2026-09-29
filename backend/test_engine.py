import subprocess
import unittest
from unittest.mock import patch
from engine import Engine, EngineError

class EngineTests(unittest.TestCase):
    def test_old_node_fails_before_catalog(self):
        with patch('engine.os.environ', {'NODE_BINARY':'node'}), patch('engine.subprocess.run', return_value=subprocess.CompletedProcess([],0,'v16.20.2\n','')) as run:
            with self.assertRaisesRegex(EngineError,'Node.js 24.*v16.20.2'):
                Engine()
            self.assertEqual(run.call_count,1)
    def test_missing_node_explains_setup(self):
        with patch('engine.os.environ', {}), patch('engine.shutil.which', return_value=None):
            with self.assertRaisesRegex(EngineError,'NODE_BINARY'): Engine()
    def test_options_do_not_become_group_itinerary(self):
        engine=Engine()
        common=['osaka_castle','glico','kuromon']
        subs=[dict(memberId=member,longlist=common+[extra],picks=common+[extra],must=None,veto=None,budgetPerDay=100000,stepLimit=20000,activeMin=600) for member,extra in [('a','hozenji'),('b','umeda_sky')]]
        result=engine.calculate(dict(startDate='2026-10-01',endDate='2026-10-01',members=[dict(id='a',name='A'),dict(id='b',name='B')],submissions=subs),'fairness')
        ids=set(result['days'][0]['placeIds'])
        self.assertTrue(set(common)<=ids)
        self.assertTrue(ids.isdisjoint({'hozenji','umeda_sky'}))
