"""Offline end-to-end cloud rehearsal and recovery drill in a NEW private directory.

Uses synthetic participants, mock opening checks and no paid APIs. Never points at
Railway or a supplied existing database. Run after committing and building the web.
"""
import argparse
import csv
import hashlib
import http.client
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import sys
import time

import experiment_cloud as cloud
import experiment_export as exporter
import experiment_share as share
import experiment_support as support

ROOT = Path(__file__).resolve().parents[1]


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def free_block(size):
    for _ in range(100):
        base = 20000 + secrets.randbelow(30000)
        sockets = []
        try:
            for port in range(base, base + size):
                sock = socket.socket()
                sockets.append(sock)
                sock.bind(('127.0.0.1', port))
            return base
        except OSError:
            pass
        finally:
            for sock in sockets:
                sock.close()
    raise RuntimeError('No free local port block')


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def run(out, node, start, end):
    os.umask(0o077)
    commit = support.clean_commit()
    require(support.read_json(ROOT/'.local/experiment-build.json') ==
            {'commit': commit, 'mode': 'h4', 'api': '/backend'}, 'Build this commit first')
    out.mkdir(parents=True, exist_ok=False, mode=0o700)
    port = free_block(9)
    origin = f'http://127.0.0.1:{port}'
    bundle = out/'qa'
    admin = secrets.token_urlsafe(32)
    env = support.offline_env(bundle, node)
    env.update(EXPERIMENT_MODE='rehearsal', EXPERIMENT_SESSION='qa',
               EXPERIMENT_DATA_DIR=str(out), EXPERIMENT_CODE_VERSION=commit,
               PUBLIC_ORIGIN=origin, EXPERIMENT_ADMIN_TOKEN=admin,
               EXPERIMENT_START_DATE=start, EXPERIMENT_END_DATE=end,
               EXPERIMENT_ACTIVE_GROUPS=','.join(cloud.GROUPS), PORT=str(port),
               EXPERIMENT_API_PORT=str(port+1), EXPERIMENT_WEB_PORT=str(port+5))
    process = None
    logs = []
    report = {'commit': commit, 'dates': [start, end], 'mode': 'offline_rehearsal',
              'paid_api_calls': 0, 'real_devices_tested': False, 'checks': {}}

    def request(path, group=None, token=None, method='GET', body=None, disconnect=False):
        headers = {'Content-Type': 'application/json', 'Origin': origin}
        if group:
            headers['Cookie'] = share.COOKIE+'='+tokens[group]
        if token:
            headers['Authorization'] = 'Bearer '+token
        conn = http.client.HTTPConnection('127.0.0.1', port, timeout=90)
        try:
            conn.request(method, path, None if body is None else json.dumps(body), headers)
            if disconnect:
                return None  # Deliberately lose only the HTTP response; do not replay the write.
            response = conn.getresponse()
            raw = response.read()
            data = json.loads(raw) if 'application/json' in response.getheader('Content-Type', '') else raw
            return response.status, data
        finally:
            conn.close()

    def stop():
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=25)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)

    def launch():
        nonlocal process
        log = (out/f'gateway-{len(logs)+1}.log').open('w')
        logs.append(log)
        process = subprocess.Popen([sys.executable, str(ROOT/'scripts/experiment_cloud.py')],
            env=env, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        for _ in range(150):
            require(process.poll() is None, 'QA gateway failed; inspect its private log')
            try:
                if request('/healthz') == (200, {'ok': True}):
                    return
            except (OSError, http.client.HTTPException):
                pass
            time.sleep(.2)
        raise RuntimeError('QA gateway startup timed out')

    try:
        launch()
        tokens = support.read_json(bundle/'public-groups.json')
        manifest = support.verify(bundle, code=True)
        config = support.read_json(bundle/'experiment-config.json')
        require(manifest['recommendation_card_policy'] == 'disabled_in_experiment', 'Recommendation cards enabled')
        require(config['explanationPolicy'] == 'participant-fixed-v2', 'Wrong explanation assignment')
        audit = support.audit(bundle, start, end, node)
        require(not audit['outside_reviewed_dates'], 'Travel date is outside reviewed data')
        support.write_json(out/'date-audit.json', audit)
        report.update(catalog_version=manifest['catalog_version'], catalog_count=manifest['catalog_rows'],
                      per_day=audit['per_day'], explanation_policy=config['explanationPolicy'],
                      recommendation_cards=manifest['recommendation_card_policy'])
        private = {g: support.read_json(bundle/'groups'/g/'room-private.json') for g in cloud.GROUPS}
        private_hashes = {g: fingerprint(s) for g, s in private.items()}
        members, bodies, saved, pins = {}, {}, {}, {}
        for group, state in private.items():
            room = state['room']
            path = '/backend/rooms/'+room['roomId']
            require(request('/g/'+group+'/'+tokens[group])[0] == 303, 'Group link did not reach its room')
            require(request('/entry/', group)[0] == 200, 'Entry unavailable')
            require(request(path+'/results', group, room['ownerToken'])[0] == 200, 'Room unavailable')
            other = next(g for g in private if g != group)
            require(request('/backend/rooms/'+private[other]['room']['roomId']+'/results', group,
                            private[other]['room']['ownerToken'])[0] == 403, 'Group isolation failed')
            require(request('/backend/rooms', group, method='POST', body={})[0] == 409, 'Extra room creation allowed')
            code, eligible = request(path+'/schedulable', group, room['ownerToken'])
            require(code == 200, 'Eligibility endpoint failed')
            required = ['osaka_001', 'osaka_005', 'branch_usj']
            require(set(required) <= set(eligible['placeIds']), 'Expected landmarks unavailable')
            # Include a branch fixture without changing production participants or operational data.
            preferred = ['branch_ichiran_abeno', 'osaka_007', 'osaka_009', 'osaka_001', 'osaka_005']
            ids = list(dict.fromkeys([p for p in preferred if p in eligible['placeIds']]+eligible['placeIds']))[:8]
            members[group] = [room['members'][0]]
            pins[group] = [state['participant1Pin']]
            for seat in room['members'][1:]:
                pin = f'{secrets.randbelow(10000):04d}'
                code, joined = request(path+'/join', group, room['inviteToken'], 'POST', {'memberId': seat['id'], 'pin': pin})
                require(code == 200, 'Synthetic participant join failed')
                members[group].append({**seat, **joined})
                pins[group].append(pin)
            bodies[group] = []
            for i, member in enumerate(members[group]):
                picks = ids[:5] if i == 0 else ids[i:i+5]
                body = {'longlist': ids, 'picks': picks, 'must': picks[0], 'veto': None,
                        'budgetPerDay': 150000, 'stepLimit': 30000, 'activeMin': 720,
                        'tradeoffs': {'pace': .5, 'distance': .5, 'spend': .5}}
                bodies[group].append(body)
                require(request(path+'/longlists/'+member['id'], group, member['submissionToken'], 'PUT', {'longlist': ids})[0] == 200, 'P3 save failed')
                require(request(path+'/submissions/'+member['id'], group, member['submissionToken'], 'PUT', body)[0] == 200, 'Input save failed')
            revision = request(path+'/results', group, room['ownerToken'])[1]['revision']
            calculation = {'strategies': ['average', 'least_misery', 'fairness'], 'revision': revision}
            if group == 'team':
                request(path+'/calculate', group, room['ownerToken'], 'POST', calculation, disconnect=True)
                for _ in range(180):
                    code, result = request(path+'/results', group, room['ownerToken'])
                    if code == 200 and len(result.get('candidates', [])) == 3:
                        break
                    time.sleep(.25)
                else:
                    raise RuntimeError('Lost-response calculation did not finish')
            else:
                code, result = request(path+'/calculate', group, room['ownerToken'], 'POST', calculation)
                require(code == 200 and len(result.get('candidates', [])) == 3, 'Candidate calculation failed')
            saved[group] = fingerprint(result['candidates'])
            for member, body in zip(members[group], bodies[group]):
                snapshot = request(path+'/results', group, member['submissionToken'])[1]
                require(fingerprint(snapshot['candidates']) == saved[group], 'Members see different results')
                require(request(path+'/submissions/'+member['id'], group, member['submissionToken'], 'PUT', body)[0] == 409, 'Published results accepted an edit')
            support.backup(bundle, group, out/'backups'/f'{group}.sqlite3')
            require(exporter.export(bundle, group, out/'exports'/group, node) == 9, 'Export row count differs')
            rows = list(csv.DictReader((out/'exports'/group/'candidate_metrics.csv').open(encoding='utf-8-sig')))
            for row in rows:
                expected = not row['participant_code'].endswith('-01')
                require(row['explained'] == str(expected), 'Export explanation assignment differs')
        report['checks'].update(four_groups_twelve_participants=True, shared_candidates=12,
            export_rows=36, group_isolation=True, published_inputs_locked=True,
            lost_calculation_response_recovered_without_replay=True, live_backups=True)

        # Terminate only a backend belonging to the child launched above. Never touch another server.
        children = subprocess.check_output(['ps', '-o', 'pid=', '--ppid', str(process.pid)], text=True).split()
        require(len(children) == 4, 'Unexpected QA child count; refusing fault injection')
        os.kill(int(children[0]), signal.SIGTERM)
        process.wait(timeout=25)
        require(process.returncode != 0, 'Backend death was not surfaced by supervisor')
        launch()
        require(tokens == support.read_json(bundle/'public-groups.json'), 'Restart changed invitation links')
        for group, state in private.items():
            require(private_hashes[group] == fingerprint(support.read_json(bundle/'groups'/group/'room-private.json')), 'Restart changed room/PIN')
            room = state['room']; path = '/backend/rooms/'+room['roomId']
            require(fingerprint(request(path+'/results', group, room['ownerToken'])[1]['candidates']) == saved[group], 'Restart changed saved candidates')
            for member, pin in zip(members[group], pins[group]):
                code, joined = request(path+'/rejoin', group, room['inviteToken'], 'POST', {'memberId': member['id'], 'pin': pin})
                require(code == 200, 'PIN rejoin failed')
                require(fingerprint(request(path+'/results', group, joined['submissionToken'])[1]['candidates']) == saved[group], 'Rejoin changed results')
            require(support.database_summary(bundle/'groups'/group/'trips.sqlite3')['quick_check'] == 'ok', 'Database integrity failed')
        report['checks'].update(backend_exit_detected=True, restart_keeps_rooms_links_pins_and_results=True,
                                twelve_pin_rejoins=True, sqlite_integrity=True)
        support.restore(bundle, out/'backups/team.sqlite3', 'recovered-team')
        require(exporter.export(bundle, 'recovered-team', out/'exports/recovered-team', node) == 9, 'Restored export differs')
        original = support.read_json(out/'exports/team/evidence.json')
        restored = support.read_json(out/'exports/recovered-team/evidence.json')
        require([{k:v for k,v in row.items() if k!='group_id'} for row in original] ==
                [{k:v for k,v in row.items() if k!='group_id'} for row in restored], 'Restored evidence differs')
        before = support.digest(bundle/'experiment-config.json')
        for change in ({'commit':'0'*40}, {'dates':['2026-11-17','2026-11-20']}):
            try:
                cloud.freeze_bundle(bundle, {'commit': commit, 'mode':'rehearsal', 'dates':[start,end], **change})
            except ValueError:
                pass
            else:
                raise RuntimeError('Frozen version mismatch allowed')
        require(before == support.digest(bundle/'experiment-config.json'), 'Failed restart changed config')
        report['checks'].update(backup_restored_to_new_group=True, restored_evidence_identical=True,
                                frozen_code_date_changes_blocked=True)
        report['status'] = 'passed'
    finally:
        stop()
        for log in logs:
            log.close()
        support.write_private_text(out/'verification.json', json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True, help='New private folder; existing paths are refused')
    parser.add_argument('--node', default=os.getenv('NODE_BINARY', 'node'))
    parser.add_argument('--start', default='2026-11-16')
    parser.add_argument('--end', default='2026-11-19')
    args = parser.parse_args()
    if os.name != 'posix':
        raise SystemExit('Run this process-recovery drill on macOS/Linux; participants can use either phone OS.')
    result = run(args.out.resolve(), support.node_binary(args.node), args.start, args.end)
    print(json.dumps(result, ensure_ascii=False, indent=2))
