# Wait for ALL 8 LingBot 14B safetensor shards, then flip .env to real.
# Usage:
#   .\finish-when-ready.ps1
#   .\finish-when-ready.ps1 -RestartSidecar
#   .\finish-when-ready.ps1 -Once   # check once and exit (for CI / health)
param(
  [switch]$RestartSidecar,
  [switch]$Once
)
$ErrorActionPreference = "Continue"

$SidecarDir = $PSScriptRoot
$RepoRoot = (Resolve-Path (Join-Path $SidecarDir "..\..")).Path
$EnvFile = Join-Path $RepoRoot ".env"

function Read-DotEnvValue([string]$Key, [string]$Fallback) {
  if (-not (Test-Path $EnvFile)) { return $Fallback }
  foreach ($line in [System.IO.File]::ReadAllLines($EnvFile)) {
    if ($line -match "^\s*#" -or $line -notmatch "=") { continue }
    $parts = $line.Split("=", 2)
    if ($parts.Length -lt 2) { continue }
    if ($parts[0].Trim() -eq $Key) {
      $v = $parts[1].Trim().Trim('"').Trim("'")
      if ($v) { return $v }
    }
  }
  return $Fallback
}

$Ckpt = Read-DotEnvValue "LINGBOT_CKPT_DIR" "E:\models\lingbot-world-v2-14b-causal-fast"
$Expected = 8

function Get-CkptGb {
  $sum = (Get-ChildItem $Ckpt -Recurse -File -Force -ErrorAction SilentlyContinue |
    Measure-Object Length -Sum).Sum
  if (-not $sum) { return 0 }
  return [math]::Round($sum / 1GB, 2)
}

function Get-CompleteShards {
  Get-ChildItem (Join-Path $Ckpt "transformers") -File -Force -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -match '^model-\d+-of-00008\.safetensors$' -and
      $_.Length -ge 1GB
    }
}

function Test-WeightsReady {
  return ((Get-CompleteShards).Count -ge $Expected)
}

function Set-LingbotModeReal {
  if (-not (Test-Path $EnvFile)) { return }
  $lines = [System.IO.File]::ReadAllLines($EnvFile)
  $out = foreach ($line in $lines) {
    if ($line -match '^LINGBOT_MODE=') { 'LINGBOT_MODE=real' }
    elseif ($line -match '^VITE_LINGBOT_MODE=') { 'VITE_LINGBOT_MODE=real' }
    else { $line }
  }
  [System.IO.File]::WriteAllLines($EnvFile, $out)
}

Write-Host "Repo=$RepoRoot" -ForegroundColor DarkGray
Write-Host "Ckpt=$Ckpt (from .env LINGBOT_CKPT_DIR or fallback)" -ForegroundColor DarkGray

if ($Once) {
  $n = (Get-CompleteShards).Count
  if (Test-WeightsReady) {
    Write-Host "READY shards=$n/$Expected ckpt=$(Get-CkptGb)GB — flipping .env to real" -ForegroundColor Green
    Set-LingbotModeReal
    exit 0
  }
  Write-Host "NOT_READY shards=$n/$Expected ckpt=$(Get-CkptGb)GB" -ForegroundColor Yellow
  exit 2
}

Write-Host "Watching $Ckpt (need $Expected complete model-*-of-00008.safetensors)..." -ForegroundColor Cyan
while (-not (Test-WeightsReady)) {
  $n = (Get-CompleteShards).Count
  $gb = Get-CkptGb
  Write-Host ("[{0}] shards={1}/{2} ckpt={3} GB" -f (Get-Date -Format HH:mm:ss), $n, $Expected, $gb)
  Start-Sleep -Seconds 60
}

Write-Host "Weights ready ($(Get-CkptGb) GB, $Expected/$Expected shards). Patching .env -> real" -ForegroundColor Green
Set-LingbotModeReal

if ($RestartSidecar) {
  Write-Host "Restarting sidecar via start-tier-b.ps1 ..." -ForegroundColor Cyan
  Push-Location $SidecarDir
  try {
    if (Test-Path ".\start-tier-b.ps1") {
      & .\start-tier-b.ps1
    } else {
      Write-Host "start-tier-b.ps1 missing — restart sidecar manually" -ForegroundColor Yellow
    }
  } finally {
    Pop-Location
  }
}

Write-Host "Done. LINGBOT_MODE=real — restart platform worker/web if needed." -ForegroundColor Green
