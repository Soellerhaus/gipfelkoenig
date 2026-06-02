# Bergkönig — Strava-Webhook Keep-Alive
# Laeuft via Windows Scheduled Task (alle 6h) und stellt sicher, dass das
# Strava-Webhook-Abo aktiv ist. Heilt sich selbst, falls Strava es deaktiviert.
# Secrets kommen aus der gitignorten .env (STRAVA_CLIENT_ID/SECRET/VERIFY_TOKEN).

$ErrorActionPreference = 'Stop'
$root = 'C:\gipfelkoenig'
Set-Location $root

# .env einlesen und als Prozess-Umgebungsvariablen setzen
$envFile = Join-Path $root '.env'
if (-not (Test-Path $envFile)) { throw ".env nicht gefunden: $envFile" }
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') {
    $name = $matches[1].Trim()
    $val  = $matches[2].Trim()
    [Environment]::SetEnvironmentVariable($name, $val, 'Process')
  }
}

# Logging
$logDir = Join-Path $root 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$log = Join-Path $logDir 'webhook-keepalive.log'
$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
Add-Content -Path $log -Value "=== $ts ===" -Encoding utf8

# Self-Healing-Check ausfuehren
$out = & node (Join-Path $root 'scripts\manage-webhook.js') ensure 2>&1
$out | Add-Content -Path $log -Encoding utf8
Add-Content -Path $log -Value "exit: $LASTEXITCODE" -Encoding utf8
