# OpenGame LingBot 档 B — RTX 4070 Laptop / consumer single-GPU starter (Windows)
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\start-tier-b.ps1
#
# Prefer MODE from repo .env; only default to mock if unset.

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

$RepoRoot = (Resolve-Path (Join-Path $here "..\..")).Path
$EnvFile = Join-Path $RepoRoot ".env"

function Read-DotEnvValue([string]$Key) {
  if (-not (Test-Path $EnvFile)) { return $null }
  foreach ($line in [System.IO.File]::ReadAllLines($EnvFile)) {
    if ($line -match "^\s*#" -or $line -notmatch "=") { continue }
    $parts = $line.Split("=", 2)
    if ($parts.Length -lt 2) { continue }
    if ($parts[0].Trim() -eq $Key) {
      $v = $parts[1].Trim().Trim('"').Trim("'")
      if ($v) { return $v }
    }
  }
  return $null
}

function Set-EnvIfMissing([string]$Key, [string]$Fallback) {
  $cur = [Environment]::GetEnvironmentVariable($Key, "Process")
  if ($cur) { return }
  $fromFile = Read-DotEnvValue $Key
  if ($fromFile) {
    Set-Item -Path "Env:$Key" -Value $fromFile
  } elseif ($Fallback) {
    Set-Item -Path "Env:$Key" -Value $Fallback
  }
}

Set-EnvIfMissing "LINGBOT_REPO_DIR" "E:\models\lingbot-world-v2"
Set-EnvIfMissing "LINGBOT_CKPT_DIR" "E:\models\lingbot-world-v2-14b-causal-fast"
Set-EnvIfMissing "LINGBOT_MODE" "mock"
Set-EnvIfMissing "LINGBOT_PROFILE" "consumer"
Set-EnvIfMissing "LINGBOT_FRAME_NUM" "17"
Set-EnvIfMissing "LINGBOT_SIZE" "480*832"
Set-EnvIfMissing "LINGBOT_NPROC" "1"
Set-EnvIfMissing "LINGBOT_TIMEOUT_SEC" "1200"
Set-EnvIfMissing "LINGBOT_FALLBACK_MOCK" "true"
Set-EnvIfMissing "LINGBOT_PUBLIC_BASE" "http://127.0.0.1:8091"
Set-EnvIfMissing "LINGBOT_PYTHON" ""
Set-EnvIfMissing "LINGBOT_SEED_IMAGE" ""
$env:PYTORCH_CUDA_ALLOC_CONF = "expandable_segments:True"

Write-Host "LingBot sidecar 档 B (consumer / RTX 4070 Laptop ~8GB)" -ForegroundColor Cyan
Write-Host "  MODE=$($env:LINGBOT_MODE)  PROFILE=$($env:LINGBOT_PROFILE)  FRAMES=$($env:LINGBOT_FRAME_NUM)"
Write-Host "  REPO=$($env:LINGBOT_REPO_DIR)"
Write-Host "  CKPT=$($env:LINGBOT_CKPT_DIR)"
if ($env:LINGBOT_MODE -eq "real") {
  Write-Host "  Real mode — 8GB VRAM may OOM; FALLBACK_MOCK=$($env:LINGBOT_FALLBACK_MOCK)" -ForegroundColor Yellow
} else {
  Write-Host "  Mock mode — set LINGBOT_MODE=real in .env after weightsReady" -ForegroundColor Yellow
}

python -c "import uvicorn" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Installing sidecar deps..." -ForegroundColor Yellow
  pip install -r requirements.txt
}

python -c "from env_load import load_opengame_env, discover_repo_ckpt; load_opengame_env(); discover_repo_ckpt(); from gpu_probe import readiness; import json; print(json.dumps(readiness(), indent=2, default=str)[:2000])"

uvicorn app:app --host 127.0.0.1 --port 8091
