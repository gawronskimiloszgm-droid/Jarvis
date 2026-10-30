# Instalacja lokalnego syntezatora glosu Jarvisa. Wymaga Pythona 3.10+, ffmpeg i ok. 15 GB miejsca.
# Uzycie:  powershell -ExecutionPolicy Bypass -File voice-server\install.ps1 [-Home D:\JarvisVoice]
param([string]$Home_ = "D:\JarvisVoice")
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force "$Home_\tmp","$Home_\pipcache","$Home_\hf","$Home_\samples","$Home_\cache" | Out-Null
$env:TMP = "$Home_\tmp"; $env:TEMP = "$Home_\tmp"; $env:PIP_CACHE_DIR = "$Home_\pipcache"
if (-not (Test-Path "$Home_\venv")) { python -m venv "$Home_\venv" }
$py = "$Home_\venv\Scripts\python.exe"
& $py -m pip install --upgrade pip wheel "setuptools<70"
& $py -m pip install torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu126
& $py -m pip install -r "$PSScriptRoot\requirements.txt"
Copy-Item "$PSScriptRoot\server.py" "$Home_\server.py" -Force
Copy-Item "$PSScriptRoot\start.bat" "$Home_\start.bat" -Force
Write-Host "Gotowe. Start: $Home_\start.bat"
