import csv
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import experiment_export as exporter
import experiment_support as support

class ExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.bundle=Path(self.tmp.name)/'bundle';self.group=self.bundle/'groups/team';self.group.mkdir(parents=True)
        (self.bundle/'experiment-config.json').write_text('{"mode":"rehearsal"}')
        (self.group/'room-private.json').write_text('{"room":{"roomId":"actual-room"}}')
        self.node=support.node_binary(os.getenv('NODE_BINARY','node'))
        self.payloads=[]
        self.candidates=[{'strategy':s,'days':[{'placeIds':['one']}],'metrics':{'costKrwPerDay':1000,'walkStepsPerDay':2000,'totalKmPerDay':2}} for s in ['average','least_misery','fairness']]
        with sqlite3.connect(self.group/'trips.sqlite3') as db:
            db.executescript('CREATE TABLE rooms(id TEXT,revision INTEGER);CREATE TABLE members(id TEXT,room_id TEXT,name TEXT);CREATE TABLE submissions(member_id TEXT,payload TEXT);CREATE TABLE candidate_results(room_id TEXT,revision INTEGER,payload TEXT);')
            for rid in ['actual-room','unrelated-room']:
                db.execute('INSERT INTO rooms VALUES(?,3)',(rid,))
                db.execute('INSERT INTO candidate_results VALUES(?,3,?)',(rid,json.dumps(self.candidates)))
                subs=[];ids=[rid+str(i) for i in range(3)]
                for i,mid in enumerate(ids):
                    sub={'memberId':mid,'picks':['one'],'longlist':['one'],'must':'one','veto':None,'budgetPerDay':10000,'stepLimit':10000}
                    db.execute('INSERT INTO members VALUES(?,?,?)',(mid,rid,f'T-0{i+1}'))
                    db.execute('INSERT INTO submissions VALUES(?,?)',(mid,json.dumps(sub)));subs.append(sub)
                if rid=='actual-room':
                    self.payloads=[{'roomId':rid,'memberId':mid,'memberIds':ids,'candidate':c,'submissions':subs} for mid in ids for c in self.candidates]
    def test_only_registered_room_exported_with_one_node_process(self):
        out=Path(self.tmp.name)/'out'
        actual=subprocess.check_output
        with patch.object(support,'verify'),patch.object(exporter.subprocess,'check_output',wraps=actual) as call:
            self.assertEqual(exporter.export(self.bundle,'team',out,self.node),9)
            # node_binary also queries --version; the scoring worker must run only once.
            workers=[c for c in call.call_args_list if str(c.args[0][-1]).endswith('experiment_record.mjs')]
            self.assertEqual(len(workers),1)
        with (out/'candidate_metrics.csv').open(encoding='utf-8-sig') as csvfile:
            rows=list(csv.DictReader(csvfile))
        self.assertEqual({r['room_id'] for r in rows},{'actual-room'})
        self.assertEqual(len(rows),9)
        for code in ['T-01','T-02','T-03']:
            self.assertEqual({r['letter'] for r in rows if r['participant_code']==code},{'A','B','C'})
        self.assertNotIn('unrelated-room',(out/'evidence.json').read_text())
    def test_batch_matches_single_payload_contract(self):
        command=[self.node,str(support.ROOT/'backend/engine/experiment_record.mjs')]
        batch=json.loads(subprocess.check_output(command,input=json.dumps(self.payloads),text=True))
        for p,computed in zip(self.payloads,batch):
            single=json.loads(subprocess.check_output(command,input=json.dumps(p),text=True))
            self.assertEqual(computed,single)
    def test_missing_registered_room_fails_without_producing_output(self):
        (self.group/'room-private.json').write_text('{"room":{"roomId":"missing"}}')
        out=Path(self.tmp.name)/'out'
        with patch.object(support,'verify'),self.assertRaisesRegex(ValueError,'실험방'):
            exporter.export(self.bundle,'team',out,self.node)
        self.assertFalse(out.exists())

if __name__=='__main__':unittest.main()
