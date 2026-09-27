import json,os,shutil,subprocess
from pathlib import Path

class EngineError(Exception):pass
class Engine:
    def __init__(self):
        bundled=Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
        self.node=os.environ.get('NODE_BINARY') or shutil.which('node') or (str(bundled) if bundled.exists() else None)
        if not self.node:raise EngineError('Node.js 24 이상을 설치하거나 NODE_BINARY를 지정하세요.')
        self.script=Path(__file__).parent/'engine/run.mjs'
        self.catalog=self.call(None,['--catalog'])
    def call(self,payload,args=()):
        try:
            p=subprocess.run([self.node,str(self.script),*args],input=json.dumps(payload) if payload is not None else '',capture_output=True,text=True,timeout=20,check=True)
            return json.loads(p.stdout)
        except (OSError,ValueError,subprocess.SubprocessError) as e:
            raise EngineError('추천 계산을 완료하지 못했습니다. 실행 환경을 확인한 뒤 다시 시도하세요.') from e
    def calculate(self,snapshot,strategy):return self.call({**snapshot,'strategy':strategy})
