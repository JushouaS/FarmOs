# Starts the vision package (packages\vision) on this computer, port 5001, for Settings > Test clip (upload a clip, check 3D weights).
# The Raspberry Pi's camera service has no /video routes, so those uploads go here: set VIDEO_SERVICE_URL=http://127.0.0.1:5001 in
# packages\api\.env. It uses the same VISION_SERVICE_TOKEN as the API, read from that file and not printed.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$line = Get-Content (Join-Path $root "packages\api\.env") | Where-Object { $_ -match '^VISION_SERVICE_TOKEN=' } | Select-Object -First 1
if (-not $line) { throw "VISION_SERVICE_TOKEN is not set in packages\api\.env." }
$env:VISION_SERVICE_TOKEN = $line.Substring("VISION_SERVICE_TOKEN=".Length).Trim()
$env:FLASK_PORT = "5001"
Set-Location (Join-Path $root "packages\vision")
python app.py
exit $LASTEXITCODE
