#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  echo 'Python 3.10+ is required: https://www.python.org/downloads/'
else
  python3 -X utf8 scripts/experiment_start.py "$@"
fi
printf '\nPress Enter to close. '
read -r _answer
