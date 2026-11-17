"""Resume-download remaining LingBot DiT shards with HTTP Range + progress."""
from __future__ import annotations

import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = "robbyant/lingbot-world-v2-14b-causal-fast"
LOCAL = Path(r"E:/models/lingbot-world-v2-14b-causal-fast")
SHARDS = [
    f"transformers/model-{i:05d}-of-00008.safetensors" for i in range(1, 9)
]
CHUNK = 8 * 1024 * 1024  # 8 MiB
UA = "OpenGame-lingbot-resume/1.0"


def resolve_url(filename: str) -> tuple[str, int]:
    url = f"https://huggingface.co/{REPO}/resolve/main/{filename}"
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        final = r.geturl()
        length = int(r.headers.get("Content-Length") or 0)
        return final, length


def download_one(filename: str) -> None:
    dest = LOCAL / filename
    dest.parent.mkdir(parents=True, exist_ok=True)
    partial = dest.with_suffix(dest.suffix + ".partial")

    if dest.exists() and dest.stat().st_size > 1_000_000_000:
        print(f"SKIP {filename} already {dest.stat().st_size}", flush=True)
        return

    print(f"START {filename}", flush=True)
    cdn, total = resolve_url(filename)
    print(f"  total={total} bytes", flush=True)

    have = partial.stat().st_size if partial.exists() else 0
    if have > total:
        print(f"  partial oversized ({have}>{total}), restart", flush=True)
        partial.unlink()
        have = 0
    if have == total and total > 0:
        partial.replace(dest)
        print(f"DONE {filename} (already complete partial)", flush=True)
        return

    mode = "ab" if have else "wb"
    headers = {"User-Agent": UA}
    if have:
        headers["Range"] = f"bytes={have}-"
        print(f"  resume from {have}", flush=True)

    t0 = time.time()
    last_print = t0
    written = have

    while True:
        try:
            req = urllib.request.Request(cdn, headers=headers)
            with urllib.request.urlopen(req, timeout=300) as r, open(partial, mode) as f:
                while True:
                    block = r.read(CHUNK)
                    if not block:
                        break
                    f.write(block)
                    written += len(block)
                    now = time.time()
                    if now - last_print >= 15:
                        speed = (written - have) / max(now - t0, 1) / (1024 * 1024)
                        pct = 100.0 * written / total if total else 0
                        print(
                            f"  … {written/1e9:.2f}/{total/1e9:.2f} GB ({pct:.1f}%) "
                            f"{speed:.1f} MB/s",
                            flush=True,
                        )
                        last_print = now
            break
        except Exception as e:
            print(f"  retry after error: {type(e).__name__}: {e}", flush=True)
            time.sleep(5)
            # refresh signed URL + resume point
            cdn, total = resolve_url(filename)
            have = partial.stat().st_size if partial.exists() else 0
            written = have
            mode = "ab" if have else "wb"
            headers = {"User-Agent": UA}
            if have:
                headers["Range"] = f"bytes={have}-"
            t0 = time.time()
            last_print = t0

    if total and partial.stat().st_size != total:
        raise RuntimeError(
            f"size mismatch {partial.stat().st_size} != {total} for {filename}"
        )
    partial.replace(dest)
    print(
        f"DONE {filename} bytes={dest.stat().st_size} sec={time.time()-t0:.1f}",
        flush=True,
    )


def main() -> None:
    LOCAL.mkdir(parents=True, exist_ok=True)
    for name in SHARDS:
        download_one(name)
    print("ALL_SHARDS_OK", flush=True)


if __name__ == "__main__":
    main()
