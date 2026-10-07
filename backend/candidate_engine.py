import json
import subprocess
from pathlib import Path
from engine import EngineError


class CandidateEngine:
    def __init__(self, node):
        self.node = node
        self.script = Path(__file__).parent / 'engine/candidates.mjs'

    def calculate(self, snapshot):
        try:
            response = subprocess.run([self.node, str(self.script)], input=json.dumps(snapshot),
                capture_output=True, text=True, encoding='utf-8', timeout=135, check=True)
            return json.loads(response.stdout)
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            raise EngineError('후보 계산에 실패했습니다. 현황을 조회한 뒤 다시 시도하세요.') from error
