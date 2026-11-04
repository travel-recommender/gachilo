#!/bin/zsh
cd "$(dirname "$0")"
python3 scripts/demo_server.py start
if [ $? -eq 0 ]; then open -a 'Google Chrome' http://localhost:3048/; else read 'reply?오류 내용을 확인하고 Enter를 누르세요. '; fi
