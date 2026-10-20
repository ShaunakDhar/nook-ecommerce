@echo off
setlocal
cd /d "%~dp0"
set "NOOK_NODE="
node -e "require('node:sqlite')" >nul 2>&1
if not errorlevel 1 set "NOOK_NODE=node"
if not defined NOOK_NODE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "NOOK_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined NOOK_NODE (
 echo Install Node.js 24 LTS from https://nodejs.org to run these tests.
 pause
 exit /b 1
)
"%NOOK_NODE%" --test tests/app.test.mjs
pause
