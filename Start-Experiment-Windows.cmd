@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>&1
if errorlevel 1 goto use_python
py -3 -X utf8 scripts\experiment_start.py %*
goto done
:use_python
where python >nul 2>&1
if errorlevel 1 goto missing
python -X utf8 scripts\experiment_start.py %*
goto done
:missing
echo Python 3.10+ is required: https://www.python.org/downloads/
:done
pause
