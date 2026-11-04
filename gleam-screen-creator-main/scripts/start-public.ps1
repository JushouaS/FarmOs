# start-public.ps1: starts the whole Cerebroil site behind ONE address and, unless told not to, puts a public
# https link in front of it.
#
#   powershell -ExecutionPolicy Bypass -File scripts\start-public.ps1             start everything and print the link
#   powershell -ExecutionPolicy Bypass -File scripts\start-public.ps1 -NoTunnel   same, but only on this computer
#                                                                                  (http://localhost:9000)
#   powershell -ExecutionPolicy Bypass -File scripts\start-public.ps1 -Rebuild    build the website again first
#   powershell -ExecutionPolicy Bypass -File scripts\start-public.ps1 -Stop       stop everything this script started
#
# What it starts, all hidden, with logs in .public-run\ :
#   the Kinect bridge        needs KINECT_BRIDGE_KEY (made for you the first time); only signed-in viewers get a ticket
#   the API                  in PRODUCTION mode on port 4100: the "admin / admin" shortcut does not exist there
#   the website              the production build, on port 8180
#   the gateway              scripts\public-gateway.mjs, the one door, on port 9000
#   the tunnel               Cloudflare's free quick tunnel (cloudflared), if it is installed
# It does not start the database (bun run db:local:start in packages\api) or the camera service on the Pi.
#
# The link changes every time the tunnel starts and works only while this computer and this script's programs run.
# Anyone with the link can reach the sign-in page. Make sure the admin password is strong first (see HOW_TO_RUN.md).
param([switch]$NoTunnel, [switch]$Stop, [switch]$Rebuild)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$api = Join-Path $root "packages\api"
$run = Join-Path $root ".public-run"
$pidFile = Join-Path $run "pids.txt"
$cloudflared = Join-Path $env:USERPROFILE "cloudflared\cloudflared.exe"
$bridgeExe = Join-Path $root "kinect-bridge\bin\KinectBridge.exe"
$camEnv = Join-Path $root "..\cerebroil-stream\.env"
New-Item -ItemType Directory -Force $run | Out-Null

function Stop-Everything {
  if (Test-Path $pidFile) {
    foreach ($line in Get-Content $pidFile) {
      if ($line -match '^\d+$') { cmd /c "taskkill /PID $line /T /F >nul 2>&1" }   # the whole tree: tsx starts a child
    }
    Remove-Item $pidFile -Force
  }
}
if ($Stop) { Stop-Everything; "Stopped."; return }

function Port-Open($port) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $t = $c.BeginConnect("127.0.0.1", $port, $null, $null); return ($t.AsyncWaitHandle.WaitOne(1500) -and $c.Connected) } catch { return $false } finally { $c.Close() }
}
function Env-Value($file, $name) {
  if (-not (Test-Path $file)) { return $null }
  $line = Select-String -Path $file -Pattern "^$name=" | Select-Object -First 1
  if ($line) { return ($line.Line -replace "^$name=", "").Trim().Trim('"') }
  return $null
}
function Start-Hidden($file, $arguments, $dir, $name) {
  $options = @{ FilePath = $file; WorkingDirectory = $dir; WindowStyle = "Hidden"; PassThru = $true
                RedirectStandardOutput = (Join-Path $run "$name.log"); RedirectStandardError = (Join-Path $run "$name.err") }
  if ($arguments) { $options.ArgumentList = $arguments }    # an empty list is not allowed
  $p = Start-Process @options
  Add-Content $pidFile $p.Id
  return $p
}
function Wait-Port($port, $what, $seconds) {
  for ($i = 0; $i -lt $seconds; $i++) { if (Port-Open $port) { return } ; Start-Sleep -Seconds 1 }
  throw "$what did not start on port $port. See .public-run\ for its log."
}

if (-not (Port-Open 5434)) { Write-Warning "The database is not running (port 5434). Start it first: cd packages\api; bun run db:local:start" }
Stop-Everything

# The Kinect bridge key: the API makes tickets from it, the bridge and the chicken finder check them.
$key = Env-Value (Join-Path $api ".env") "KINECT_BRIDGE_KEY"
if (-not $key) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $key = ([BitConverter]::ToString($bytes) -replace "-", "").ToLower()
  Add-Content (Join-Path $api ".env") "`nKINECT_BRIDGE_KEY=$key"
  if (Test-Path $camEnv) { Add-Content $camEnv "`nKINECT_BRIDGE_KEY=$key" }
  "Made a Kinect bridge key and saved it in packages\api\.env (and the camera service's .env). It is not shown."
}

# 1. The website, built for a plain Node server.
if ($Rebuild -or -not (Test-Path (Join-Path $root ".output\server\index.mjs"))) {
  "Building the website (about a minute)..."
  Push-Location $root
  $env:NITRO_PRESET = "node-server"; $env:VITE_VISION_ORIGIN = "http://the-camera-computer:5000"   # not the Pi's real address: it must not end up in the public files
  cmd /c "bunx vite build >nul 2>&1"   # through cmd: the build prints harmless warnings to stderr
  Remove-Item Env:NITRO_PRESET, Env:VITE_VISION_ORIGIN -ErrorAction SilentlyContinue
  Pop-Location
  if (-not (Test-Path (Join-Path $root ".output\server\index.mjs"))) { throw "The website build failed." }
}

# 2. The Kinect bridge (when the Kinect is plugged in).
if (Test-Path $bridgeExe) {
  $env:KINECT_BRIDGE_KEY = $key
  $null = Start-Hidden $bridgeExe "" (Split-Path $bridgeExe) "bridge"
  Remove-Item Env:KINECT_BRIDGE_KEY
} else { Write-Warning "kinect-bridge\bin\KinectBridge.exe is not built (run kinect-bridge\build.cmd). The Kinect picture will be missing." }

# 3. The API in production mode, on its own port. The monitors stay with the normal API, so nothing is stored twice.
$env:NODE_ENV = "production"; $env:API_HOST = "127.0.0.1"; $env:API_PORT = "4100"
$env:TRUST_PROXY = "127.0.0.1"; $env:COOKIE_SECURE = "true"
$env:BEHAVIOR_MONITOR = "off"; $env:SENSOR_MONITOR = "off"; $env:KINECT_BRIDGE_KEY = $key
$null = Start-Hidden (Join-Path $api "node_modules\.bin\tsx.exe") "src/index.ts" $api "api"
Remove-Item Env:NODE_ENV, Env:API_HOST, Env:API_PORT, Env:TRUST_PROXY, Env:COOKIE_SECURE, Env:BEHAVIOR_MONITOR, Env:SENSOR_MONITOR, Env:KINECT_BRIDGE_KEY

# 4. The website server, which asks the API for the signed-in viewer's pages.
$env:PORT = "8180"; $env:HOST = "127.0.0.1"; $env:NITRO_PORT = "8180"; $env:NITRO_HOST = "127.0.0.1"; $env:VITE_API_URL = "http://127.0.0.1:4100"
$null = Start-Hidden "node" ".output/server/index.mjs" $root "web"
Remove-Item Env:PORT, Env:HOST, Env:NITRO_PORT, Env:NITRO_HOST, Env:VITE_API_URL

# 5. The gateway, the one door.
$null = Start-Hidden "node" "scripts/public-gateway.mjs" $root "gateway"

Wait-Port 4100 "The API" 60
Wait-Port 8180 "The website" 30
Wait-Port 9000 "The gateway" 15
"Running on this computer: http://localhost:9000"

if ($NoTunnel) { "No tunnel started (-NoTunnel). Stop everything with: scripts\start-public.ps1 -Stop"; return }
if (-not (Test-Path $cloudflared)) { throw "cloudflared is not at $cloudflared. Download it from https://github.com/cloudflare/cloudflared/releases and put it there." }

# 6. The public link. It needs this computer to reach Cloudflare on port 7844. Many school, office and public Wi-Fi networks
# block that port (the tunnel then shows "530"); use home Wi-Fi or a phone hotspot instead.
$null = Start-Hidden $cloudflared "tunnel --url http://127.0.0.1:9000 --no-autoupdate --protocol http2" $run "tunnel"
$link = $null
for ($i = 0; $i -lt 40 -and -not $link; $i++) {
  Start-Sleep -Seconds 1
  $text = (Get-Content (Join-Path $run "tunnel.err") -Raw -ErrorAction SilentlyContinue) + (Get-Content (Join-Path $run "tunnel.log") -Raw -ErrorAction SilentlyContinue)
  if ($text -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $link = $Matches[0] }
}
if (-not $link) { throw "The tunnel did not give a link. See .public-run\tunnel.err" }
""
"PUBLIC LINK: $link"
"Anyone with this link can reach the sign-in page. It works until you run: scripts\start-public.ps1 -Stop"
