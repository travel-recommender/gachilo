import json
import subprocess
from pathlib import Path
from engine import EngineError
from real_engine import REAL_DATASET, documented_exchange_rate


class CandidateEngine:
    def __init__(self, node):
        self.node = node
        self.script = Path(__file__).parent / 'engine/candidates.mjs'

    def calculate(self, snapshot):
        real = snapshot.get('dataset') == REAL_DATASET
        script = self.script.with_name('real_candidates.mjs') if real else self.script
        if real:
            snapshot = {**snapshot, 'exchange_rate': documented_exchange_rate()}
        try:
            response = subprocess.run([self.node, str(script)], input=json.dumps(snapshot),
                capture_output=True, text=True, encoding='utf-8', timeout=135, check=True)
            return json.loads(response.stdout)
        except subprocess.CalledProcessError as error:
            if real and (error.stderr or '').strip() == 'NO_SCHEDULABLE_REAL_CANDIDATE':
                raise EngineError('선택한 실제 장소로 일정을 만들 수 없습니다. 방문 날짜·운영 조건·예산·활동 한도를 확인하고 장소를 다시 선택하세요.') from error
            raise EngineError('후보 계산에 실패했습니다. 현황을 조회한 뒤 다시 시도하세요.') from error
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            raise EngineError('후보 계산에 실패했습니다. 현황을 조회한 뒤 다시 시도하세요.') from error
