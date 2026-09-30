import json,os,re,shutil,subprocess
from pathlib import Path

class EngineError(Exception):pass
class Engine:
    def __init__(self):
        self.node=os.environ.get('NODE_BINARY') or shutil.which('node')
        message='Node.js 24 이상을 설치하거나 NODE_BINARY로 해당 실행 파일을 지정하세요.'
        if not self.node:raise EngineError(message)
        try:
            version=subprocess.run([self.node,'--version'],capture_output=True,text=True,timeout=5,check=True).stdout.strip()
            match=re.fullmatch(r'v(\d+)\.\d+\.\d+(?:[-+].*)?',version)
            if not match or int(match.group(1))<24:
                raise EngineError(f'{message} 감지된 버전: {version}')
        except (OSError,subprocess.SubprocessError) as error:
            raise EngineError(message) from error
        self.script=Path(__file__).parent/'engine/run.mjs'
        self.catalog=self.call(None,['--catalog'])
    def call(self,payload,args=()):
        try:
            p=subprocess.run([self.node,str(self.script),*args],input=json.dumps(payload) if payload is not None else '',capture_output=True,text=True,timeout=20,check=True)
            return json.loads(p.stdout)
        except (OSError,ValueError,subprocess.SubprocessError) as e:
            raise EngineError('추천 계산을 완료하지 못했습니다. 실행 환경을 확인한 뒤 다시 시도하세요.') from e
    def calculate(self,snapshot,strategy):return self.call({**snapshot,'strategy':strategy})
