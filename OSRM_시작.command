#!/bin/zsh
cd "$(dirname "$0")"
python3 scripts/demo_osrm.py start
if [ $? -ne 0 ]; then read 'reply?오류 내용을 확인하고 Enter를 누르세요. '; fi
