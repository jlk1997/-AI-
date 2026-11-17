"""Real generate.py / torchrun invocation for 档 B (multi-GPU official + consumer single)."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from gpu_probe import find_seed_image, readiness, resolve_profile


def _python_bin() -> str:
    """Prefer LINGBOT_PYTHON (repo .venv) over sidecar interpreter."""
    explicit = (os.environ.get("LINGBOT_PYTHON") or "").strip()
    if explicit and Path(explicit).exists():
        return explicit
    # Common layout: E:/models/lingbot-world-v2/.venv
    repo = os.environ.get("LINGBOT_REPO_DIR") or ""
    if repo:
        for rel in (
            ".venv/Scripts/python.exe",
            ".venv/bin/python",
        ):
            cand = Path(repo) / rel
            if cand.exists():
                return str(cand)
    return sys.executable


def _torchrun_launcher(nproc: int) -> list[str]:
    """Prefer python -m torch.distributed.run (Windows-friendly)."""
    return [
        _python_bin(),
        "-m",
        "torch.distributed.run",
        f"--nproc_per_node={nproc}",
    ]


def build_real_command(
    *,
    repo: Path,
    ckpt: str,
    action_dir: Path,
    save_dir: Path,
    prompt: str,
    frame_num: int,
    seed_image: str | None,
) -> tuple[list[str], dict[str, Any]]:
    profile = resolve_profile()
    nproc = int(os.environ.get("LINGBOT_NPROC") or (1 if profile == "consumer" else 8))
    size = os.environ.get("LINGBOT_SIZE") or "480*832"
    generate_py = repo / "generate.py"
    meta: dict[str, Any] = {
        "profile": profile,
        "nproc": nproc,
        "size": size,
        "frameNum": frame_num,
        "launcher": "torch.distributed.run",
    }

    if not generate_py.exists():
        run_fast = repo / "run_fast.sh"
        if run_fast.exists():
            cmd = ["bash", str(run_fast), ckpt, str(frame_num)]
            meta["launcher"] = "run_fast.sh"
            return cmd, meta
        raise FileNotFoundError(f"generate.py not found under {repo}")

    cmd = [
        *_torchrun_launcher(nproc),
        str(generate_py),
        "--task",
        "i2v-A14B",
        "--size",
        size,
        "--ckpt_dir",
        ckpt,
        "--action_path",
        str(action_dir),
        "--frame_num",
        str(frame_num),
        "--prompt",
        prompt,
        "--save_dir",
        str(save_dir),
        "--local_attn_size",
        os.environ.get("LINGBOT_LOCAL_ATTN_SIZE", "18"),
        "--sink_size",
        os.environ.get("LINGBOT_SINK_SIZE", "6"),
    ]

    # Official multi-GPU path uses FSDP + Ulysses; single-GPU omits them.
    if nproc > 1 or profile == "multi":
        cmd.extend(
            [
                "--dit_fsdp",
                "--t5_fsdp",
                "--ulysses_size",
                str(nproc),
            ]
        )
        meta["fsdp"] = True
    else:
        meta["fsdp"] = False
        # Optional override if operator insists on FSDP on 1 GPU
        if os.environ.get("LINGBOT_FORCE_FSDP", "").lower() in ("1", "true", "yes"):
            cmd.extend(["--dit_fsdp", "--t5_fsdp", "--ulysses_size", "1"])
            meta["fsdp"] = True

    image = seed_image
    if not image or not Path(image).exists():
        found = find_seed_image(repo)
        image = str(found) if found else None
    if image:
        cmd.extend(["--image", image])
        meta["image"] = image
    else:
        meta["image"] = None
        meta["imageWarning"] = (
            "No seed image — set LINGBOT_SEED_IMAGE or place examples/*/image.jpg"
        )

    return cmd, meta


def default_frame_num(action_frames: int, explicit: int | None) -> int:
    if explicit and explicit > 0:
        return explicit
    env = os.environ.get("LINGBOT_FRAME_NUM")
    if env and env.isdigit():
        return int(env)
    profile = resolve_profile()
    # Odd frame counts preferred by many Wan-family scripts
    if profile == "consumer":
        # Short clip for 12GB cards — still odd
        base = max(17, min(33, action_frames * 2 + 1))
        return base if base % 2 == 1 else base + 1
    base = max(17, action_frames * 4 + 1)
    return base if base % 2 == 1 else base + 1


def collect_mp4s(save_dir: Path) -> list[Path]:
    found = list(save_dir.rglob("*.mp4"))
    return sorted(found, key=lambda p: p.stat().st_mtime, reverse=True)


def run_real_generate(
    *,
    repo: str,
    ckpt: str,
    action_dir: Path,
    save_dir: Path,
    prompt: str,
    frame_num: int,
    seed_image: str | None,
) -> dict[str, Any]:
    repo_path = Path(repo)
    timeout_sec = int(
        os.environ.get(
            "LINGBOT_TIMEOUT_SEC",
            str(1200 if resolve_profile() == "consumer" else 900),
        )
    )
    cmd, meta = build_real_command(
        repo=repo_path,
        ckpt=ckpt,
        action_dir=action_dir,
        save_dir=save_dir,
        prompt=prompt,
        frame_num=frame_num,
        seed_image=seed_image,
    )
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(repo_path),
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            env={
                **os.environ,
                "OPENGAME_LINGBOT_PROMPT": prompt,
                "OPENGAME_LINGBOT_ACTION_DIR": str(action_dir),
                "OPENGAME_LINGBOT_SAVE_DIR": str(save_dir),
                # Reduce fragmentation on 12GB cards
                "PYTORCH_CUDA_ALLOC_CONF": os.environ.get(
                    "PYTORCH_CUDA_ALLOC_CONF",
                    "expandable_segments:True",
                ),
            },
        )
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "message": f"real generate timed out after {timeout_sec}s",
            "meta": meta,
            "timedOut": True,
        }
    except FileNotFoundError as exc:
        return {"ok": False, "message": str(exc), "meta": meta}

    stderr = proc.stderr or ""
    stdout = proc.stdout or ""
    combined = (stderr + "\n" + stdout)[-1200:]
    oom = any(
        s in combined.lower()
        for s in ("out of memory", "cuda oom", "cudnn_status_alloc_failed", "oom")
    )
    if proc.returncode != 0:
        return {
            "ok": False,
            "message": f"generate failed (exit {proc.returncode}): {combined[-800:]}",
            "meta": meta,
            "oom": oom,
            "returncode": proc.returncode,
        }

    videos = collect_mp4s(save_dir)
    if not videos:
        # Some scripts write next to action_path / cwd
        videos = collect_mp4s(repo_path / "output")
        videos += collect_mp4s(action_dir.parent)
    if not videos:
        return {
            "ok": False,
            "message": "No mp4 produced — check LingBot install / save_dir",
            "meta": meta,
            "stderrTail": combined[-400:],
        }
    return {
        "ok": True,
        "videoPath": str(videos[0]),
        "meta": meta,
        "message": f"Real clip ok · profile={meta.get('profile')} · frames={frame_num}",
    }


def should_fallback_mock(result: dict[str, Any]) -> bool:
    ready = readiness()
    default = "true" if ready.get("profile") == "consumer" else "false"
    flag = os.environ.get("LINGBOT_FALLBACK_MOCK", default).lower() in (
        "1",
        "true",
        "yes",
    )
    if not flag:
        return False
    if result.get("ok"):
        return False
    return True
