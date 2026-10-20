@echo off
setlocal
cd /d "%~dp0"
set "NOOK_NODE="
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" -e "require('node:sqlite')" >nul 2>&1
  if not errorlevel 1 set "NOOK_NODE=%~dp0runtime\node.exe"
)
if not defined NOOK_NODE (
  node -e "require('node:sqlite')" >nul 2>&1
  if not errorlevel 1 set "NOOK_NODE=node"
)
if not defined NOOK_NODE (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "NOOK_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)
if not defined NOOK_NODE (
  echo Nook needs Node.js 24 LTS, or Node.js 22.13 or newer.
  echo Download it from https://nodejs.org and open this file again.
  echo No npm install or database setup is needed.
  pause
  exit /b 1
)
"%NOOK_NODE%" launch.mjs
if errorlevel 1 pause
