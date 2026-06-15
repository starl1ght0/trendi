@echo off
cd /d "%~dp0"
set DB_PATH=%~dp0data\trends.db
cd /d "%~dp0app"
"%~dp0node\node.exe" launcher.js
pause
