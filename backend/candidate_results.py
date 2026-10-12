"""Revision-scoped shared candidates, atomic publication and owner selection."""
import json
import math
import secrets
import time
from datetime import date, timedelta
from api_errors import ApiError, require
from engine import EngineError

STRATEGIES = ('average', 'least_misery', 'fairness')


class CandidateStore:
    def init_candidates(self, c):
        c.executescript('''
        CREATE TABLE IF NOT EXISTS candidate_results(
          room_id TEXT PRIMARY KEY REFERENCES rooms(id), revision INTEGER NOT NULL,
          payload TEXT NOT NULL, selected_strategy TEXT, selection_version INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS candidate_jobs(
          room_id TEXT PRIMARY KEY REFERENCES rooms(id), revision INTEGER NOT NULL,
          job_token TEXT NOT NULL, expires REAL NOT NULL);
        ''')

    def candidate_view(self, c, room):
        row = c.execute('SELECT * FROM candidate_results WHERE room_id=? AND revision=?',
                        (room['id'], room['revision'])).fetchone()
        active = c.execute('SELECT 1 FROM candidate_jobs WHERE room_id=? AND revision=? AND expires>?',
                           (room['id'], room['revision'], time.time())).fetchone()
        candidates = json.loads(row['payload']) if row else []
        selected = row['selected_strategy'] if row else None
        return {'candidates': candidates, 'selectedStrategy': selected,
                'selectionVersion': row['selection_version'] if row else 0}, bool(active)

    def begin_candidates(self, rid, token, revision):
        require(type(revision) is int and revision >= 0, 'revision 정수가 필요합니다.')
        with self.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            room = self.room(c, rid)
            self.authenticate(c, room, token, owner_only=True)
            if room['dataset'] != 'prototype_demo_36':
                raise ApiError(400, '후보 3개 계산은 현재 데모 36곳만 지원합니다. 실제 장소 모드는 strategy=average를 사용하세요.')
            if room['revision'] != revision:
                raise ApiError(409, '입력이 변경되었습니다. 현황을 다시 조회하세요.')
            counts = c.execute('SELECT COUNT(*),COUNT(s.member_id) FROM members m LEFT JOIN submissions s ON m.id=s.member_id WHERE m.room_id=?', (rid,)).fetchone()
            if counts[0] != counts[1]:
                raise ApiError(409, '모든 참여자의 입력이 필요합니다.')
            view, active = self.candidate_view(c, room)
            if view['candidates']:
                return 'cached', None
            if active:
                return 'busy', None
            job = secrets.token_urlsafe(24)
            # Bound above the worker's 135s timeout; a crashed worker is retryable.
            c.execute('INSERT OR REPLACE INTO candidate_jobs VALUES(?,?,?,?)',
                      (rid, revision, job, time.time()+180))
            return 'started', job

    def finish_candidates(self, rid, token, revision, job, output):
        with self.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            room = self.room(c, rid)
            self.authenticate(c, room, token, owner_only=True)
            current = c.execute('SELECT * FROM candidate_jobs WHERE room_id=?', (rid,)).fetchone()
            if (room['revision'] != revision or not current or current['revision'] != revision
                    or current['job_token'] != job):
                raise ApiError(409, '입력이 변경되었거나 계산이 교체되었습니다. 현황을 다시 조회하세요.')
            validate_candidates(output, room, self.catalog_ids)
            c.execute('INSERT OR REPLACE INTO candidate_results(room_id,revision,payload) VALUES(?,?,?)',
                      (rid, revision, json.dumps(output['candidates'], ensure_ascii=False)))
            c.execute('DELETE FROM results WHERE room_id=?', (rid,))
            c.execute('DELETE FROM candidate_jobs WHERE room_id=? AND job_token=?', (rid, job))

    def abandon_candidates(self, rid, job):
        with self.connect() as c:
            c.execute('DELETE FROM candidate_jobs WHERE room_id=? AND job_token=?', (rid, job))

    def select_candidate(self, rid, token, body):
        require(isinstance(body, dict) and set(body) == {'revision', 'strategy', 'selectionVersion'}, 'revision·strategy·selectionVersion이 필요합니다.')
        require(type(body['revision']) is int and type(body['selectionVersion']) is int
                and body['revision'] >= 0 and body['selectionVersion'] >= 0, '버전은 0 이상 정수여야 합니다.')
        require(body['strategy'] in STRATEGIES, '추천 전략을 확인하세요.')
        with self.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            room = self.room(c, rid)
            self.authenticate(c, room, token, owner_only=True)
            row = c.execute('SELECT * FROM candidate_results WHERE room_id=? AND revision=?',
                            (rid, body['revision'])).fetchone()
            if room['revision'] != body['revision'] or not row:
                raise ApiError(409, '현재 입력의 후보를 먼저 계산하세요.')
            if row['selected_strategy'] == body['strategy']:
                return  # Idempotent replay; no new result/version.
            if row['selection_version'] != body['selectionVersion']:
                raise ApiError(409, '다른 화면에서 선택이 바뀌었습니다. 현황을 다시 조회하세요.')
            c.execute('UPDATE candidate_results SET selected_strategy=?,selection_version=selection_version+1 WHERE room_id=?',
                      (body['strategy'], rid))


def validate_candidates(output, room, known_ids):
    """Only this public projection can cross the shared response boundary."""
    def check(ok):
        if not ok:
            raise EngineError('후보 결과 형식 검증에 실패했습니다.')
    def keys(value, expected):
        check(isinstance(value, dict) and set(value) == set(expected.split()))
    def metrics(value, daily=False):
        names = ('walkSteps', 'costKrw', 'totalKm') if daily else ('walkStepsPerDay', 'costKrwPerDay', 'totalKmPerDay')
        keys(value, ' '.join(names))
        for name in names:
            v = value[name]
            check(type(v) in (int, float) and math.isfinite(v) and v >= 0)
        check(type(value[names[0]]) is int and type(value[names[1]]) is int)
    keys(output, 'candidates')
    cs = output['candidates']
    check(isinstance(cs, list) and len(cs) == 3)
    check([c.get('strategy') if isinstance(c, dict) else None for c in cs] == list(STRATEGIES))
    start, end = date.fromisoformat(room['start']), date.fromisoformat(room['end'])
    dates = [(start+timedelta(days=i)).isoformat() for i in range((end-start).days+1)]
    for candidate in cs:
        keys(candidate, 'strategy metrics days summary explanationSource')
        metrics(candidate['metrics'])
        check(isinstance(candidate['summary'], str) and 0 < len(candidate['summary']) <= 10000)
        check(candidate['explanationSource'] in ('rules', 'ai'))
        days = candidate['days']
        check(isinstance(days, list) and len(days) == len(dates))
        for expected_date, day in zip(dates, days):
            keys(day, 'date placeIds items metrics')
            check(day['date'] == expected_date)
            metrics(day['metrics'], daily=True)
            ids, items = day['placeIds'], day['items']
            check(isinstance(ids, list) and len(ids) <= 30 and all(isinstance(x, str) for x in ids))
            check(len(set(ids)) == len(ids) and (known_ids is None or all(x in known_ids for x in ids)))
            check(isinstance(items, list) and len(items) == len(ids))
            for id_, item in zip(ids, items):
                keys(item, 'placeId aiAdded filled source reasonCode reason')
                check(item['placeId'] == id_ and type(item['aiAdded']) is bool and type(item['filled']) is bool)
                check(item['source'] in ('selected', 'rule_added', 'ai_added', 'meal_fill'))
                check(item['filled'] == (item['source'] == 'meal_fill'))
                check(item['aiAdded'] == (item['source'] in ('rule_added', 'ai_added')))
                check(item['reasonCode'] is None or isinstance(item['reasonCode'], str) and len(item['reasonCode']) <= 100)
                check(item['reason'] is None or isinstance(item['reason'], str) and len(item['reason']) <= 1000)
