"""Authenticated on-demand photo lookup; no persisted photo references or API responses."""
import json
import os
import subprocess
import threading
import time
from collections import deque
from pathlib import Path
from api_errors import ApiError, require


class PhotoService:
    def __init__(self, node, records):
        self.node = node
        self.records = {r['place']['place_id']: r for r in records}
        self.lock = threading.Lock()
        self.calls = deque()
        self.workers = threading.BoundedSemaphore(2)

    def get(self, room_id, body):
        require(isinstance(body, dict) and set(body) == {'placeId'} and isinstance(body['placeId'], str), '장소 하나를 지정하세요.')
        record = self.records.get(body['placeId'])
        require(record is not None, '등록된 장소를 지정하세요.')
        # Key absence is a visible fallback, never a request to Google.
        if not os.environ.get('GOOGLE_PLACES_API_KEY'):
            return {'placeId': body['placeId'], 'photo': None, 'status': 'unavailable'}
        with self.lock:
            now = time.monotonic()
            while self.calls and self.calls[0] <= now - 60:
                self.calls.popleft()
            if len(self.calls) >= 20:
                raise ApiError(429, '사진 조회가 많아요. 잠시 뒤 다시 시도하세요.')
            self.calls.append(now)
        if not self.workers.acquire(blocking=False):
            raise ApiError(429, '사진을 불러오는 중이에요. 잠시 뒤 다시 시도하세요.')
        try:
            out = subprocess.run([self.node, str(Path(__file__).parent/'engine/place_photo.mjs')],
                input=json.dumps(record), capture_output=True, text=True, encoding='utf-8', timeout=25, check=True)
            result = json.loads(out.stdout)
            if not isinstance(result, dict) or result.get('placeId') != body['placeId']:
                raise ValueError('Invalid photo result')
            return result
        except (OSError, ValueError, subprocess.SubprocessError):
            return {'placeId': body['placeId'], 'photo': None, 'status': 'unavailable'}
        finally:
            self.workers.release()
