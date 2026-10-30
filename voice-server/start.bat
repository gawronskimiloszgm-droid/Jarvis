@echo off
rem Lokalny syntezator glosu Jarvisa: http://127.0.0.1:8020
set JARVIS_VOICE_HOME=%~dp0
"%~dp0venv\Scripts\python.exe" "%~dp0server.py"
