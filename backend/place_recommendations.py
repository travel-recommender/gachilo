"""Authenticated P3 suggestions, separate from itinerary/must-go decisions."""

from api_errors import ApiError, require
from co_picks import _ids, source_counts_from_connection, DEMO_DATASET, MIN_COUNT
from engine import EngineError
from place_catalog import area_key
from real_engine import REAL_DATASET


def rank_places(source_id, places, counts, eligible, excluded, limit):
    source = places[source_id]
    votes = {}
    for pair in counts['pairs']:
        a, b = pair['placeIds']
        if source_id == a:
            votes[b] = pair['listCount']
        elif source_id == b:
            votes[a] = pair['listCount']
    ranked = []
    for pid, p in places.items():
        if pid == source_id or pid in excluded or pid not in eligible or pid.startswith('custom_'):
            continue
        same_area = bool(source['areaKey'] and source['areaKey'] == p['areaKey'])
        same_category = bool(source['category'] and source['category'] == p['category'])
        affinity = 0 if same_area and same_category else 1 if same_area else 2 if same_category else 3
        count = votes.get(pid, 0)
        # Keep the disclosure threshold even when this ranker is called directly.
        if count < MIN_COUNT:
            count = 0
        if count == 0 and affinity == 3:
            continue  # Never pad with unrelated places or invent popularity.
        reason = 'co_pick' if count else ('same_area_category', 'same_area', 'same_category')[affinity]
        ranked.append(((-count, affinity, pid), {
            'placeId': pid, 'name': p['name'], 'category': p['category'], 'area': p.get('area'),
            'coPickCount': count, 'reason': reason,
        }))
    return [value for _, value in sorted(ranked, key=lambda row: row[0])[:limit]]


class RecommendationStore:
    def recommend_places(self, rid, mid, token, body):
        require(isinstance(body, dict), 'JSON 객체가 필요합니다.')
        require(set(body) <= {'placeId', 'excludePlaceIds', 'limit'}, '추천 요청 항목을 확인하세요.')
        source = body.get('placeId')
        require(isinstance(source, str) and 1 <= len(source) <= 100, 'placeId가 필요합니다.')
        limit = body.get('limit', 3)
        require(type(limit) is int and 1 <= limit <= 10, 'limit는 1~10 정수여야 합니다.')
        extra = body.get('excludePlaceIds', [])
        require(isinstance(extra, list) and len(extra) <= 30
                and all(isinstance(x, str) and 1 <= len(x) <= 100 for x in extra),
                'excludePlaceIds는 최대 30개 장소 ID 목록이어야 합니다.')
        # Authenticate before catalog, global counts, or date worker access.
        with self.connect() as c:
            r = self.room(c, rid)
            self.authenticate(c, r, token, mid)
        try:
            places = self.recommendation_real_places if r['dataset'] == REAL_DATASET else self.recommendation_demo_places
            require(source in places and not source.startswith('custom_'), '이 방의 장소 목록에 없는 placeId입니다.')
            if r['dataset'] == REAL_DATASET:
                if self.date_availability is None:
                    raise EngineError('방문일 장소 검증을 사용할 수 없습니다. 다시 시도하세요.')
                eligible = set(self.date_availability(r['start'], r['end']))
            else:
                eligible = set(places)  # Demo data is explicitly labelled below.
            with self.connect() as c:
                c.execute('BEGIN')
                r = self.room(c, rid)
                seat = self.authenticate(c, r, token, mid)  # Recheck after potentially slow date worker.
                own = c.execute('''SELECT l.ids, s.payload FROM members m
                    LEFT JOIN longlists l ON l.member_id=m.id
                    LEFT JOIN submissions s ON s.member_id=m.id WHERE m.id=?''', (mid,)).fetchone()
                own_ids, _ = _ids(own)
                counts = source_counts_from_connection(c, r['dataset'], set(places), source, rid)
                excluded = set(extra) | (own_ids or set())
                recommendations = rank_places(source, places, counts, eligible, excluded, limit)
        except (OSError, ValueError, KeyError, TypeError):
            # Corrupt inputs/catalog are failures, never a successful cold-start fallback.
            raise ApiError(503, '추천 자료를 확인하지 못했습니다. 다시 시도하세요.') from None
        self.occupy_after_read(seat)
        return {
            'dataset': r['dataset'], 'sourcePlaceId': source, 'limit': limit,
            'countUnit': counts['countUnit'], 'generatedAt': counts['generatedAt'],
            'eligibility': 'at_least_one_trip_date' if r['dataset'] == REAL_DATASET else 'demo_unverified',
            'recommendations': recommendations,
        }
