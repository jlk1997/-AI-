# Verify LingBot 档 B readiness for RTX 4070 / consumer (Windows)
# Run from repo root:
#   powershell -ExecutionPolicy Bypass -File .\services\lingbot-sidecar\check-tier-b.ps1

$ErrorActionPreference = "Continue"
$sidecar = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $sidecar "..\..")

Write-Host "=== OpenGame LingBot 档 B check ===" -ForegroundColor Cyan
Write-Host "Repo root: $root"

# GPU
Write-Host "`n[GPU]" -ForegroundColor Yellow
nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader 2>$null
if ($LASTEXITCODE -ne 0) { Write-Host "nvidia-smi failed" -ForegroundColor Red }

# .env keys
Write-Host "`n[.env LINGBOT_*]" -ForegroundColor Yellow
$envFile = Join-Path $root ".env"
if (Test-Path $envFile) {
  Select-String -Path $envFile -Pattern "^[#\s]*LINGBOT_|^[#\s]*WORLD_SPATIAL" | ForEach-Object { $_.Line }
} else {
  Write-Host "No .env at $envFile" -ForegroundColor Red
}

# Sidecar health if up
Write-Host "`n[Sidecar http://127.0.0.1:8091/health]" -ForegroundColor Yellow
try {
  $h = Invoke-RestMethod -Uri "http://127.0.0.1:8091/health" -TimeoutSec 5
  $h | ConvertTo-Json -Depth 6
  if (-not $h.readyReal) {
    Write-Host "readyReal=false — fill LINGBOT_REPO_DIR + LINGBOT_CKPT_DIR then restart sidecar" -ForegroundColor Yellow
  }
} catch {
  Write-Host "Sidecar down. Start with: cd services\lingbot-sidecar; .\start-tier-b.ps1" -ForegroundColor Yellow
}

Write-Host "`nNext:" -ForegroundColor Cyan
Write-Host " 1) Smoke mock (no GPU): World panel → Smoke mock"
Write-Host " 2) Clone repo + download 14b-causal-fast; set paths in .env"
Write-Host " 3) LINGBOT_MODE=real; restart sidecar; Session → step → Generate clip (frames=17)"
Write-Host " 4) Expect OOM possible on 8GB — fallback mock keeps product loop alive"
