# Starts the chicken finder (cerebroil-stream\kinect_seg.py) next to the Kinect. Run by the scheduled task that
# scripts\install-autostart.ps1 makes; it can also be run by hand.
$ErrorActionPreference = "Stop"
$stream = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) "cerebroil-stream"
if (-not (Test-Path (Join-Path $stream "kinect_seg.py"))) { throw "cerebroil-stream\kinect_seg.py was not found next to this project." }
Set-Location $stream
# Two threads keep it from taking the whole computer when memory is short.
$env:OMP_NUM_THREADS = "2"
$env:OPENBLAS_NUM_THREADS = "2"
python kinect_seg.py
exit $LASTEXITCODE
