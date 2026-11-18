import csv
import contextlib
import io
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
        (self.bundle/'catalog.json').write_text(json.dumps({'places':[{'place':{'place_id':'one','branch_group_id':None}}]}))
        self.payloads=[]
        self.candidates=[{'strategy':s,'days':[{'placeIds':['one']}],'metrics':{'costKrwPerDay':1000,'walkStepsPerDay':2000,'totalKmPerDay':2}} for s in ['average','least_misery','fairness']]
        with contextlib.closing(sqlite3.connect(self.group/'trips.sqlite3')) as db, db:
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
        actual=subprocess.run
        with patch.object(support,'verify'),patch.object(exporter.subprocess,'run',wraps=actual) as call:
            self.assertEqual(exporter.export(self.bundle,'team',out,self.node),9)
            # node_binary also queries --version; the scoring worker must run only once.
            workers=[c for c in call.call_args_list if any(str(a).endswith('experiment_record.mjs') for a in c.args[0])]
            self.assertEqual(len(workers),1)
        with (out/'candidate_metrics.csv').open(encoding='utf-8-sig') as csvfile:
            rows=list(csv.DictReader(csvfile))
        self.assertEqual({r['room_id'] for r in rows},{'actual-room'})
        self.assertEqual(len(rows),9)
        for code in ['T-01','T-02','T-03']:
            self.assertEqual({r['letter'] for r in rows if r['participant_code']==code},{'A','B','C'})
        self.assertNotIn('unrelated-room',(out/'evidence.json').read_text())
    def test_policy_preserved_for_legacy_and_fixed_participant_sessions(self):
        for policy in (None, 'participant-fixed-v2'):
            cfg={'mode':'rehearsal'}
            if policy: cfg['explanationPolicy']=policy
            (self.bundle/'experiment-config.json').write_text(json.dumps(cfg))
            out=Path(self.tmp.name)/('fixed' if policy else 'legacy')
            with patch.object(support,'verify'):
                self.assertEqual(exporter.export(self.bundle,'team',out,self.node),9)
            with (out/'candidate_metrics.csv').open(encoding='utf-8-sig') as f:
                rows=list(csv.DictReader(f))
            for i in range(3):
                mine=[r for r in rows if r['participant_code']==f'T-0{i+1}']
                expected=([0,3,3] if policy else [1,2,1])[i]
                self.assertEqual(sum(r['explained']=='True' for r in mine),expected)
                self.assertEqual({r['explanation_policy'] for r in mine},{policy or 'per-candidate-v1'})
            self.assertEqual(json.loads((out/'config.json').read_text()),cfg)

    def test_unknown_policy_does_not_export_mislabeled_data(self):
        (self.bundle/'experiment-config.json').write_text('{"mode":"rehearsal","explanationPolicy":"typo"}')
        for empty in (False, True):
            if empty:
                with contextlib.closing(sqlite3.connect(self.group/'trips.sqlite3')) as db, db:
                    db.execute('DELETE FROM candidate_results WHERE room_id=?',('actual-room',))
            out=Path(self.tmp.name)/('empty' if empty else 'out')
            with patch.object(support,'verify'),self.assertRaisesRegex(ValueError,'설명 배정 정책이 올바르지'):
                exporter.export(self.bundle,'team',out,self.node)
            self.assertFalse(out.exists())

    def test_empty_valid_session_exports_no_candidate_rows(self):
        with contextlib.closing(sqlite3.connect(self.group/'trips.sqlite3')) as db, db:
            db.execute('DELETE FROM candidate_results WHERE room_id=?',('actual-room',))
        out=Path(self.tmp.name)/'out'
        with patch.object(support,'verify'):
            self.assertEqual(exporter.export(self.bundle,'team',out,self.node),0)
        self.assertEqual(json.loads((out/'evidence.json').read_text()),[])

    def test_envelope_matches_original_batch_for_both_policies(self):
        command=[self.node,str(support.ROOT/'backend/engine/experiment_record.mjs'),str(self.bundle/'catalog.json')]
        for policy in (None, 'per-candidate-v1', 'participant-fixed-v2'):
            envelope={'explanationPolicy':policy,'records':self.payloads}
            original=[{**p,'explanationPolicy':policy} for p in self.payloads]
            run=lambda p: json.loads(subprocess.check_output(command,input=json.dumps(p),text=True))
            self.assertEqual(run(envelope),run(original))

    def test_batch_matches_single_payload_contract(self):
        command=[self.node,str(support.ROOT/'backend/engine/experiment_record.mjs'),str(self.bundle/'catalog.json')]
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

    def test_frozen_branch_groups_match_personal_evidence_and_keep_exact_veto(self):
        catalog={'places':[{'place':{'place_id':pid,'branch_group_id':group}} for pid,group in
            [('old','dine'),('next','dine'),('takeout','takeout'),('unrelated',None)]]}
        (self.bundle/'catalog.json').write_text(json.dumps(catalog))
        candidate={'strategy':'average','days':[{'placeIds':['next']}],
            'metrics':{'costKrwPerDay':1000,'walkStepsPerDay':2000}}
        sub={'memberId':'a','picks':['old','takeout','unrelated'],'must':'old','musts':['old','takeout'],
            'veto':'old','budgetPerDay':10000,'stepLimit':10000}
        payload={'roomId':'r','memberId':'a','memberIds':['a'],'candidate':candidate,'submissions':[sub]}
        command=[self.node,str(support.ROOT/'backend/engine/experiment_record.mjs'),str(self.bundle/'catalog.json')]
        def score(value):
            return json.loads(subprocess.check_output(command,input=json.dumps(value),text=True))
        result=score(payload)
        self.assertAlmostEqual(result['automatic']['pickRate'],1/3)
        self.assertTrue(result['automatic']['mustKept'])
        self.assertEqual(result['automatic']['mustRate'],0.5)
        self.assertTrue(result['automatic']['vetoKept'])
        self.assertIn('frozen catalogue',result['metricBasis'])
        # No branch metadata, and no current runtime catalogue: frozen groups are sufficient.
        changed={**payload,'submissions':[{**sub,'must':'takeout','musts':['takeout'],'veto':'next'}]}
        missed=score(changed)['automatic']
        self.assertFalse(missed['mustKept'])
        self.assertEqual(missed['mustRate'],0)
        self.assertFalse(missed['vetoKept'])
        self.assertEqual(result['placeIds'],['next'])
        # Same brand but missing/empty grouping must not imply a visit.
        catalog['places'][0]['place']['branch_group_id']=None
        (self.bundle/'catalog.json').write_text(json.dumps(catalog))
        no_group=score(payload)['automatic']
        self.assertEqual(no_group['pickRate'],0)
        self.assertFalse(no_group['mustKept'])

    def test_real_missing_must_and_veto_are_not_lost_to_demo_id_filter(self):
        (self.bundle/'catalog.json').write_text(json.dumps({'places':[{'place':{'place_id':pid}} for pid in ['one','missing']]}))
        with contextlib.closing(sqlite3.connect(self.group/'trips.sqlite3')) as db, db:
            payload=json.loads(db.execute('SELECT payload FROM submissions WHERE member_id=?',('actual-room0',)).fetchone()[0])
            payload.update(must='missing',veto='one')
            db.execute('UPDATE submissions SET payload=? WHERE member_id=?',(json.dumps(payload),'actual-room0'))
        out=Path(self.tmp.name)/'out'
        with patch.object(support,'verify'):
            exporter.export(self.bundle,'team',out,self.node)
        with (out/'candidate_metrics.csv').open(encoding='utf-8-sig') as f:
            mine=[row for row in csv.DictReader(f) if row['participant_code']=='T-01']
        self.assertEqual(len(mine),3)
        for row in mine:
            self.assertEqual(row['mustKept'],'False')
            self.assertEqual(row['mustRate'],'0')
            self.assertEqual(row['vetoKept'],'False')
            self.assertIn('satisfactionOf/v2',row['metric_basis'])
        self.assertIn('metric_basis',json.loads((out/'evidence.json').read_text())[0])

    def test_cli_policy_error_is_one_line_without_worker_traceback(self):
        (self.bundle/'experiment-config.json').write_text('{"mode":"rehearsal","explanationPolicy":"typo"}')
        out=Path(self.tmp.name)/'out';stderr=io.StringIO()
        with patch.object(support,'verify'),contextlib.redirect_stderr(stderr),self.assertRaises(SystemExit) as error:
            exporter.main(['--bundle',str(self.bundle),'--group','team','--out',str(out),'--node',self.node])
        self.assertEqual(error.exception.code,1)
        self.assertEqual(len(stderr.getvalue().splitlines()),1)
        self.assertIn('설명 배정 정책이 올바르지',stderr.getvalue())
        self.assertNotIn('Traceback',stderr.getvalue())
        self.assertFalse(out.exists())

    def test_worker_failure_and_timeout_do_not_leak_raw_details_or_write_output(self):
        for i,failure in enumerate([subprocess.CalledProcessError(1,['worker'],stderr='PRIVATE_PARTICIPANT_DATA'),
                                    subprocess.TimeoutExpired(['worker'],30)]):
            out=Path(self.tmp.name)/str(i)
            with patch.object(support,'verify'),patch.object(support,'node_binary',return_value=self.node),patch.object(exporter.subprocess,'run',side_effect=failure),self.assertRaises(ValueError) as error:
                exporter.export(self.bundle,'team',out,self.node)
            self.assertNotIn('PRIVATE_PARTICIPANT_DATA',str(error.exception))
            self.assertFalse(out.exists())

if __name__=='__main__':unittest.main()
