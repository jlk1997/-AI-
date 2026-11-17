# Setup LingBot-World-v2 code + weights under E:\models (档 B)
# Run from anywhere. Idempotent.
$ErrorActionPreference = "Stop"
$ModelsRoot = if ($env:OPENGAME_MODELS_ROOT) { $env:OPENGAME_MODELS_ROOT } else { "E:\models" }
$RepoDir = Join-Path $ModelsRoot "lingbot-world-v2"
$CkptDir = Join-Path $ModelsRoot "lingbot-world-v2-14b-causal-fast"
$RepoUrl = "https://github.com/robbyant/lingbot-world-v2.git"

Write-Host "== OpenGame LingBot models setup ==" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $ModelsRoot | Out-Null

if (-not (Test-Path (Join-Path $RepoDir "generate.py"))) {
  Write-Host "[1/3] Cloning $RepoUrl ..."
  git clone --depth 1 $RepoUrl $RepoDir
} else {
  Write-Host "[1/3] Repo OK: $RepoDir"
  git -C $RepoDir pull --ff-only 2>$null
}

Write-Host "[2/3] Downloading weights → $CkptDir (ModelScope, ~70GB+)"
New-Item -ItemType Directory -Force -Path $CkptDir | Out-Null
python -c @"
from modelscope.hub.snapshot_download import snapshot_download
path = snapshot_download('Robbyant/lingbot-world-v2-14b-causal-fast', local_dir=r'$($CkptDir.Replace('\','/'))')
print('OK', path)
"@

Write-Host "[3/3] Optional: create Python 3.12 venv for generate.py"
$py = $null
foreach ($v in @("3.12", "3.11")) {
  $c = & py -$v -c "import sys; print(sys.executable)" 2>$null
  if ($LASTEXITCODE -eq 0 -and $c) { $py = $c.Trim(); break }
}
if ($py) {
  $venv = Join-Path $RepoDir ".venv"
  if (-not (Test-Path (Join-Path $venv "Scripts\python.exe"))) {
    & $py -m venv $venv
  }
  Write-Host "  venv: $venv"
  Write-Host "  Next: & '$venv\Scripts\python.exe' -m pip install -r '$RepoDir\requirements.txt'"
  Write-Host "  (flash_attn on Windows is hard — consumer profile may still OOM on 8GB)"
} else {
  Write-Host "  No Python 3.11/3.12 found — install for real GPU generate.py"
}

Write-Host "`nPoint OpenGame .env at:" -ForegroundColor Green
Write-Host "  LINGBOT_REPO_DIR=$($RepoDir.Replace('\','/'))"
Write-Host "  LINGBOT_CKPT_DIR=$($CkptDir.Replace('\','/'))"
Write-Host "  LINGBOT_SEED_IMAGE=$($RepoDir.Replace('\','/'))/examples/03/image.jpg"
Write-Host "Keep LINGBOT_MODE=mock until download finishes, then set real + restart sidecar."
