# Starts the Kinect bridge with its access key (the same KINECT_BRIDGE_KEY the API uses). Run by the scheduled task that
# scripts\install-autostart.ps1 makes; it can also be run by hand. The key is read from packages\api\.env and not printed.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root "kinect-bridge\bin\KinectBridge.exe"
if (-not (Test-Path $exe)) { throw "KinectBridge.exe is not built (run kinect-bridge\build.cmd)." }
$line = Get-Content (Join-Path $root "packages\api\.env") | Where-Object { $_ -match '^KINECT_BRIDGE_KEY=' } | Select-Object -First 1
if ($line) { $env:KINECT_BRIDGE_KEY = $line.Substring("KINECT_BRIDGE_KEY=".Length).Trim() }
Set-Location (Split-Path -Parent $exe)
& $exe
exit $LASTEXITCODE
