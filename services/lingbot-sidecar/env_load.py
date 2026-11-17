"""Load OpenGame repo .env into process env (sidecar DX — no python-dotenv required)."""

from __future__ import annotations

import os
from pathlib import Path


def _parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    text = ""
    for enc in ("utf-8-sig", "utf-8", "gbk", "cp1252"):
        try:
            text = path.read_text(encoding=enc)
            break
        except (OSError, UnicodeDecodeError):
            continue
    if not text:
        return out
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()
        if not key:
            continue
        # strip optional quotes
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
            val = val[1:-1]
        out[key] = val
    return out


def load_opengame_env() -> list[str]:
    """
    Merge LINGBOT_* (and a few spatial) keys from repo .env into os.environ
    without overriding variables already set in the process.
    Returns list of keys applied.
    """
    here = Path(__file__).resolve().parent
    candidates = [
        here.parent.parent / ".env",  # repo root when sidecar is services/lingbot-sidecar
        here.parent / ".env",
        here / ".env",
        Path.cwd() / ".env",
    ]
    applied: list[str] = []
    allow_prefixes = ("LINGBOT_", "WORLD_SPATIAL_")
    allow_exact = {"WORLD_SPATIAL_BACKEND"}
    for path in candidates:
        if not path.is_file():
            continue
        parsed = _parse_env_file(path)
        for key, val in parsed.items():
            if key in os.environ and os.environ.get(key):
                continue
            if not (key.startswith(allow_prefixes) or key in allow_exact):
                continue
            if val == "":
                continue
            os.environ[key] = val
            applied.append(f"{key}@{path.name}")
        if applied:
            break
    return applied


def discover_repo_ckpt() -> dict[str, str | None]:
    """Fill LINGBOT_REPO_DIR / LINGBOT_CKPT_DIR from common local folders if unset."""
    found: dict[str, str | None] = {"repo": None, "ckpt": None}
    if os.environ.get("LINGBOT_REPO_DIR") and Path(os.environ["LINGBOT_REPO_DIR"]).is_dir():
        found["repo"] = os.environ["LINGBOT_REPO_DIR"]
    if os.environ.get("LINGBOT_CKPT_DIR") and Path(os.environ["LINGBOT_CKPT_DIR"]).exists():
        found["ckpt"] = os.environ["LINGBOT_CKPT_DIR"]

    roots = [
        Path("E:/models"),
        Path("D:/models"),
        Path("C:/models"),
        Path.home() / "models",
        Path.home() / "lingbot",
        Path("E:/OpenGame-main"),
        Path("E:/"),
    ]
    repo_names = ("lingbot-world-v2", "LingBot-World-v2", "lingbot-world")
    ckpt_names = (
        "lingbot-world-v2-14b-causal-fast",
        "lingbot-world-v2-14b-causal-fast-taehv-window15-sink3",
    )

    if not found["repo"]:
        for root in roots:
            if not root.is_dir():
                continue
            for name in repo_names:
                cand = root / name
                if (cand / "generate.py").exists():
                    os.environ.setdefault("LINGBOT_REPO_DIR", str(cand))
                    found["repo"] = str(cand)
                    break
            if found["repo"]:
                break
            # one level deep
            try:
                for child in root.iterdir():
                    if (child / "generate.py").exists() and "lingbot" in child.name.lower():
                        os.environ.setdefault("LINGBOT_REPO_DIR", str(child))
                        found["repo"] = str(child)
                        break
            except OSError:
                pass
            if found["repo"]:
                break

    if not found["ckpt"]:
        search_roots = list(roots)
        if found["repo"]:
            search_roots.insert(0, Path(found["repo"]).parent)
            search_roots.insert(0, Path(found["repo"]))
        for root in search_roots:
            if not root.is_dir():
                continue
            for name in ckpt_names:
                cand = root / name
                if cand.exists():
                    os.environ.setdefault("LINGBOT_CKPT_DIR", str(cand))
                    found["ckpt"] = str(cand)
                    break
            if found["ckpt"]:
                break

    return found
