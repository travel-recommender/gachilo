"""Opt-in real catalogue. No network, AI, popularity or implicit FX defaults."""
import json
import re
import subprocess
from pathlib import Path
from engine import EngineError
from place_catalog import exchange_rate, exchange_rate_metadata

REAL_DATASET = 'osaka_review_150'


class RealEngine:
    def __init__(self, node):
        self.node = node
        self.script = Path(__file__).parent / 'engine/real.mjs'

    def calculate(self, snapshot):
        rate = exchange_rate()
        metadata = exchange_rate_metadata(rate)
        if metadata['provenance_status'] != 'documented':
            raise EngineError('하나은행 고시환율을 JPY_TO_KRW(1엔당 원화), '
                              'JPY_TO_KRW_AS_OF(기준일), JPY_TO_KRW_SOURCE(출처)에 설정하세요.')
        if not re.fullmatch(r'\d{1,6}(\.\d{1,6})?', str(rate)):
            raise EngineError('JPY_TO_KRW는 1엔당 원화, 소수점 6자리 이내로 설정하세요.')
        if '하나은행' not in metadata['source'] and 'kebhana.com' not in metadata['source']:
            raise EngineError('JPY_TO_KRW_SOURCE에 하나은행 고시환율 출처를 기록하세요.')
        try:
            result = subprocess.run([self.node, str(self.script)],
                input=json.dumps({**snapshot, 'exchange_rate': metadata}),
                capture_output=True, text=True, encoding='utf-8', timeout=20, check=True)
            return json.loads(result.stdout)
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            raise EngineError('실제 장소 일정 계산에 실패했습니다. 날짜·실행 환경을 확인하세요.') from error
