<#
  Backs up the Cerebroil database and the trained model files.

    powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1
    powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1 -To D:\cerebroil-backups -Keep 30

  Each run makes, in the backup folder (default: cerebroil-backups in your user folder):
    db-YYYYMMDD-HHMMSS.dump     the whole database (pg_dump custom format)
    models-YYYYMMDD.zip          cerebroil-stream\models (once a day; the models are not in git)
  and removes dumps older than the newest -Keep ones (default 14).

  Restore into an empty database:
    pg_restore --no-owner -d "<connection url>" db-YYYYMMDD-HHMMSS.dump

  This keeps copies on the same computer. Copy the folder to a drive or cloud storage that is not this
  computer, or a dead laptop takes the backup with it. To run it every night, add a Task Scheduler task
  that runs the command above.
#>
param(
  [string]$To = (Join-Path $env:USERPROFILE "cerebroil-backups"),
  [int]$Keep = 14
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root "packages\api\.env"
$line = Get-Content $envFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $line) { throw "DATABASE_URL is not in $envFile" }
$url = $line.Substring("DATABASE_URL=".Length).Trim()

$pgDump = (Get-Command pg_dump -ErrorAction SilentlyContinue).Source
if (-not $pgDump) { $pgDump = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName }
if (-not $pgDump) { throw "pg_dump was not found. Install PostgreSQL client tools or add them to PATH." }

New-Item -ItemType Directory -Force $To | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dump = Join-Path $To "db-$stamp.dump"
& $pgDump --format=custom --no-owner --file $dump $url
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $dump) -or (Get-Item $dump).Length -lt 1024) {
  if (Test-Path $dump) { Remove-Item $dump }
  throw "pg_dump failed (is the database running?)."
}
"Database saved: $dump ($([math]::Round((Get-Item $dump).Length / 1KB)) KB)"

# The trained models are not in git. Once a day is enough: they change rarely.
$models = Join-Path (Split-Path -Parent $root) "cerebroil-stream\models"
$zip = Join-Path $To ("models-" + (Get-Date -Format "yyyyMMdd") + ".zip")
if ((Test-Path $models) -and -not (Test-Path $zip)) {
  Compress-Archive -Path (Join-Path $models "*") -DestinationPath $zip
  "Models saved:   $zip"
}

Get-ChildItem $To -Filter "db-*.dump" | Sort-Object Name -Descending | Select-Object -Skip $Keep | Remove-Item -Force
