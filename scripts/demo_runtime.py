"""Optional per-checkout paths; never commit .local configuration."""
import json, os, shutil
from pathlib import Path

def settings(root):
    path=root/'.local/demo/runtime.json'
    config=json.loads(path.read_text()) if path.is_file() else {}
    return {**config,**os.environ}

def executable(value, name):
    candidate=str(Path(value).expanduser()) if value else name
    return shutil.which(candidate) or ''
