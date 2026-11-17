"""GPU / readiness probe for LingBot sidecar (档 B)."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Any


def probe_nvidia() -> dict[str, Any]:
    """Best-effort nvidia-smi snapshot (no torch required)."""
    if not shutil.which("nvidia-smi"):
        return {"ok": False, "reason": "nvidia-smi not found"}
    try:
        proc = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.free,driver_version",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        if proc.returncode != 0:
            return {
                "ok": False,
                "reason": (proc.stderr or proc.stdout or "nvidia-smi failed")[:300],
            }
        gpus: list[dict[str, Any]] = []
        for line in (proc.stdout or "").strip().splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 3:
                continue
            name, total, free = parts[0], parts[1], parts[2]
            driver = parts[3] if len(parts) > 3 else None
            try:
                total_mb = int(float(total))
                free_mb = int(float(free))
            except ValueError:
                total_mb, free_mb = 0, 0
            gpus.append(
                {
                    "name": name,
                    "vramTotalMb": total_mb,
                    "vramFreeMb": free_mb,
                    "driver": driver,
                }
            )
        if not gpus:
            return {"ok": False, "reason": "no GPU rows from nvidia-smi"}
        primary = gpus[0]
        return {
            "ok": True,
            "count": len(gpus),
            "name": primary["name"],
            "vramTotalMb": primary["vramTotalMb"],
            "vramFreeMb": primary["vramFreeMb"],
            "driver": primary.get("driver"),
            "gpus": gpus,
            "consumerLikely": primary["vramTotalMb"] > 0
            and primary["vramTotalMb"] < 24_000,
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "reason": str(exc)}


def resolve_profile(gpu: dict[str, Any] | None = None) -> str:
    explicit = (os.environ.get("LINGBOT_PROFILE") or "").strip().lower()
    if explicit in ("consumer", "multi", "mock"):
        return explicit
    g = gpu if gpu is not None else probe_nvidia()
    if g.get("ok") and int(g.get("count") or 0) >= 4:
        return "multi"
    return "consumer"


def ckpt_looks_complete(ckpt: Path) -> bool:
    """True when causal-fast DiT shards look present (legacy: any large weight file)."""
    detail = weights_ready_detail(ckpt)
    if detail["weightsReady"]:
        return True
    if not ckpt.exists():
        return False
    big = 0
    try:
        for p in ckpt.rglob("*"):
            if not p.is_file():
                continue
            name = p.name.lower()
            if name.endswith((".safetensors", ".bin", ".pt", ".pth")):
                try:
                    if p.stat().st_size >= 100 * 1024 * 1024:
                        big += 1
                except OSError:
                    continue
    except OSError:
        return False
    return big >= 1


def weights_ready_detail(ckpt: Path | None) -> dict[str, Any]:
    """
    Product gate P1: 8/8 model-*-of-00008.safetensors under transformers/, each ≥1GB.
    Does not require LINGBOT_MODE=real — surfaces download-complete independently.
    """
    expected = 8
    min_bytes = 1_000_000_000
    found: list[str] = []
    if ckpt and ckpt.exists():
        roots = [ckpt / "transformers", ckpt]
        seen: set[str] = set()
        for root in roots:
            if not root.is_dir():
                continue
            for i in range(1, expected + 1):
                name = f"model-{i:05d}-of-00008.safetensors"
                if name in seen:
                    continue
                p = root / name
                try:
                    if p.is_file() and p.stat().st_size >= min_bytes:
                        found.append(name)
                        seen.add(name)
                except OSError:
                    continue
    ready = len(found) >= expected
    return {
        "weightsReady": ready,
        "shardComplete": len(found),
        "shardExpected": expected,
        "shards": found,
        "canSwitchReal": ready,
    }


def readiness() -> dict[str, Any]:
    repo = os.environ.get("LINGBOT_REPO_DIR") or ""
    ckpt = os.environ.get("LINGBOT_CKPT_DIR") or ""
    repo_path = Path(repo) if repo else None
    ckpt_path = Path(ckpt) if ckpt else None
    generate_py = (repo_path / "generate.py") if repo_path else None
    run_fast = (repo_path / "run_fast.sh") if repo_path else None
    seed = find_seed_image(repo_path) if repo_path else None
    gpu = probe_nvidia()
    profile = resolve_profile(gpu)
    mode = os.environ.get("LINGBOT_MODE", "mock")
    weights = weights_ready_detail(ckpt_path)
    ready_real = bool(
        mode == "real"
        and repo_path
        and repo_path.is_dir()
        and ckpt_path
        and ckpt_path.exists()
        and generate_py
        and generate_py.exists()
        and weights["weightsReady"]
    )
    warnings: list[str] = []
    if weights["canSwitchReal"] and mode != "real":
        warnings.append(
            f"Weights ready ({weights['shardComplete']}/{weights['shardExpected']} shards) — "
            "set LINGBOT_MODE=real and restart sidecar for real clips."
        )
    if mode == "real" and not ready_real:
        warnings.append(
            "Real mode incomplete — need 8/8 safetensors shards + LINGBOT_REPO_DIR generate.py"
        )
    if profile == "consumer" and mode == "real":
        warnings.append(
            "Official 14B causal-fast targets ~8×GPU; consumer/single-GPU (e.g. RTX 4070 12GB) "
            "uses short-clip profile — OOM possible; fallback mock enabled by default."
        )
    if gpu.get("ok") and gpu.get("consumerLikely") and profile == "multi":
        warnings.append(
            "LINGBOT_PROFILE=multi on a consumer card is likely to OOM — prefer consumer."
        )
    rec_frames = 17 if profile == "consumer" else 81
    # 8GB laptop cards: keep the shortest odd clip
    vram = int((gpu or {}).get("vramTotalMb") or 0) if isinstance(gpu, dict) else 0
    if profile == "consumer" and 0 < vram < 10_000:
        rec_frames = 17
    return {
        "gpu": gpu,
        "profile": profile,
        "mode": mode,
        "readyReal": ready_real,
        "weightsReady": weights["weightsReady"],
        "weights": weights,
        "repo": repo or None,
        "ckpt": ckpt or None,
        "generatePy": str(generate_py) if generate_py and generate_py.exists() else None,
        "runFast": str(run_fast) if run_fast and run_fast.exists() else None,
        "seedImage": str(seed) if seed else None,
        "recommended": {
            "nproc": int(os.environ.get("LINGBOT_NPROC") or (1 if profile == "consumer" else 8)),
            "frameNum": int(os.environ.get("LINGBOT_FRAME_NUM") or rec_frames),
            "size": os.environ.get("LINGBOT_SIZE") or "480*832",
            "timeoutSec": int(
                os.environ.get("LINGBOT_TIMEOUT_SEC")
                or (1200 if profile == "consumer" else 900)
            ),
            "fallbackMock": os.environ.get(
                "LINGBOT_FALLBACK_MOCK",
                "true" if profile == "consumer" else "false",
            ).lower()
            in ("1", "true", "yes"),
        },
        "warnings": warnings,
    }


def find_seed_image(repo: Path | None) -> Path | None:
    if not repo or not repo.is_dir():
        return None
    env_img = os.environ.get("LINGBOT_SEED_IMAGE")
    if env_img and Path(env_img).exists():
        return Path(env_img)
    candidates = [
        repo / "examples" / "03" / "image.jpg",
        repo / "examples" / "03" / "image.png",
        repo / "examples" / "01" / "image.jpg",
        repo / "examples" / "0" / "image.jpg",
    ]
    for c in candidates:
        if c.exists():
            return c
    # any jpg under examples/
    examples = repo / "examples"
    if examples.is_dir():
        for p in sorted(examples.rglob("*.jpg")):
            return p
        for p in sorted(examples.rglob("*.png")):
            return p
    return None
