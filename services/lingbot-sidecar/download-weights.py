"""Download LingBot 14B causal-fast shards with resume into E:/models/..."""
from __future__ import annotations

import os
import threading
import time
from pathlib import Path

from huggingface_hub import hf_hub_download, list_repo_files

REPO = "robbyant/lingbot-world-v2-14b-causal-fast"
LOCAL = Path(r"E:/models/lingbot-world-v2-14b-causal-fast")
MIN_SHARD_BYTES = 1_000_000_000  # 1GB — complete DiT shards are ~9GB


def _largest_incomplete() -> tuple[Path | None, int]:
    cache = LOCAL / ".cache" / "huggingface" / "download"
    if not cache.exists():
        return None, 0
    best: Path | None = None
    best_sz = 0
    for p in cache.rglob("*.incomplete"):
        try:
            sz = p.stat().st_size
        except OSError:
            continue
        if sz > best_sz:
            best, best_sz = p, sz
    return best, best_sz


def _progress_watch(stop: threading.Event, label: str) -> None:
    last = -1
    while not stop.wait(20):
        p, sz = _largest_incomplete()
        if sz != last:
            mb = sz / (1024 * 1024)
            name = p.name[:48] if p else "-"
            print(f"  … progress {label}: {mb:.1f} MB  ({name})", flush=True)
            last = sz
        else:
            print(f"  … stalled? {label}: no size change in 20s", flush=True)


def _shard_done(name: str) -> bool:
    path = LOCAL / name
    return path.is_file() and path.stat().st_size >= MIN_SHARD_BYTES


def main() -> None:
    LOCAL.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "0")
    files = list_repo_files(REPO)
    print("FILE_COUNT", len(files), flush=True)
    order = sorted(
        files,
        key=lambda f: (0 if ("model-" in f and f.endswith(".safetensors")) else 1, f),
    )
    for i, name in enumerate(order, 1):
        if _shard_done(name):
            sz = (LOCAL / name).stat().st_size
            print(f"[{i}/{len(order)}] SKIP {name} bytes={sz}", flush=True)
            continue
        print(f"[{i}/{len(order)}] START {name}", flush=True)
        stop = threading.Event()
        watcher = threading.Thread(
            target=_progress_watch, args=(stop, name), daemon=True
        )
        watcher.start()
        t0 = time.time()
        try:
            path = hf_hub_download(repo_id=REPO, filename=name, local_dir=str(LOCAL))
            sz = Path(path).stat().st_size if Path(path).exists() else 0
            print(
                f"[{i}/{len(order)}] DONE {name} bytes={sz} sec={time.time() - t0:.1f}",
                flush=True,
            )
        except Exception as e:
            print(
                f"[{i}/{len(order)}] FAIL {name} err={type(e).__name__}: {e}",
                flush=True,
            )
            raise
        finally:
            stop.set()
            watcher.join(timeout=2)
    print("HF_OK", LOCAL, flush=True)


if __name__ == "__main__":
    main()
