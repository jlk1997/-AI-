"""
OpenGame LingBot-World-v2 sidecar — generate + interactive session + action convert.

Mock mode needs no GPU. Real mode shells to lingbot-world-v2 generate.py / run_fast.sh
(CC BY-NC-SA 4.0 weights — non-commercial / research only).

  pip install -r requirements.txt
  uvicorn app:app --host 127.0.0.1 --port 8091

@see https://github.com/Robbyant/lingbot-world-v2
"""

from __future__ import annotations

import base64
import io
import json
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# Load OpenGame .env + auto-discover repo/ckpt before reading LINGBOT_* defaults
try:
    from env_load import discover_repo_ckpt, load_opengame_env

    _ENV_APPLIED = load_opengame_env()
    _DISCOVERED = discover_repo_ckpt()
except Exception:  # noqa: BLE001
    _ENV_APPLIED = []
    _DISCOVERED = {"repo": None, "ckpt": None}

app = FastAPI(title="OpenGame LingBot Sidecar", version="0.5.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

LICENSE = "CC BY-NC-SA 4.0 (LingBot weights); adapter Apache-2.0"

MEDIA_ROOT = Path(
    os.environ.get(
        "LINGBOT_MEDIA_DIR",
        str(Path(tempfile.gettempdir()) / "opengame-lingbot-media"),
    )
)
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(MEDIA_ROOT)), name="media")

PUBLIC_BASE = os.environ.get("LINGBOT_PUBLIC_BASE", "http://127.0.0.1:8091").rstrip(
    "/"
)

WASD_CHANNELS = [
    "idle",
    "forward",
    "back",
    "left",
    "right",
    "attack",
    "archery",
    "spell",
    "shoot",
    "interact",
    "look_up",
    "look_down",
]

# In-memory interactive sessions (mock / research harness).
_SESSIONS: dict[str, dict[str, Any]] = {}


class StyleAnchor(BaseModel):
    artStyle: str = "pixel"
    palette: list[str] = Field(default_factory=list)
    mood: str | None = None
    referenceNotes: str | None = None


class ActionManifest(BaseModel):
    schema_name: str | None = Field(default=None, alias="schema")
    fps: int = 8
    frameCount: int = 16
    frames: list[dict[str, Any]] = Field(default_factory=list)
    conditioningPrompt: str = ""

    model_config = {"populate_by_name": True}


class GenerateBody(BaseModel):
    prompt: str
    regionId: str
    worldTitle: str = ""
    styleAnchor: StyleAnchor = Field(default_factory=StyleAnchor)
    actionManifest: ActionManifest = Field(default_factory=ActionManifest)
    seedImageUrl: str | None = None
    frameNum: int | None = None
    mode: Literal["mock", "real"] | None = None


class SessionCreateBody(BaseModel):
    prompt: str
    regionId: str
    worldTitle: str = ""
    styleAnchor: StyleAnchor = Field(default_factory=StyleAnchor)
    seedImageUrl: str | None = None
    mode: Literal["mock", "real"] | None = None


class SessionStepBody(BaseModel):
    wasd: str = "idle"
    textEvent: str | None = None
    action: str | None = None  # OpenGame WorldActionKind alias
    yawDelta: float = 0.0
    pitchDelta: float = 0.0
    holdFrames: int = 4


class ConvertBody(BaseModel):
    actionManifest: ActionManifest
    writeNpy: bool = False


class SessionGenerateBody(BaseModel):
    mode: Literal["mock", "real"] | None = None
    frameNum: int | None = None
    persistPublic: bool = True


def _publish_mp4(src: Path) -> dict[str, str]:
    """Copy mp4 into MEDIA_ROOT; return http URL + localPath (never file:// for clients)."""
    dest = MEDIA_ROOT / f"{uuid.uuid4().hex}.mp4"
    shutil.copyfile(src, dest)
    http_url = f"{PUBLIC_BASE}/media/{dest.name}"
    data_uri = "data:video/mp4;base64," + base64.b64encode(dest.read_bytes()).decode(
        "ascii"
    )
    # Prefer data URI when small enough for worker persistence without sidecar affinity
    video_url = data_uri if dest.stat().st_size <= 6_000_000 else http_url
    return {
        "videoUrl": video_url,
        "httpUrl": http_url,
        "localPath": str(dest),
    }


_MINI_MP4 = base64.b64decode(
    "AAAAHGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQAAAAhmcmVlAAAAvG1kYXQAAAAf"
    "BgX92YIFbf///tldAAg+bYgAAAMCaWxzdAAAACkAAAAoaGRscgAAAAAAAAAAc291"
    "bgAAAAAAAAAAAAAAAAAAAAAAAQAAAAmsdHJhawAAAFx0a2hzAAAAAwAAAAAAAAAA"
    "AAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAABhzdHRzAAAA"
    "HG1ldGEAAAAgAAAAKGlzb21pc28ybXBhAAABAG1wcm9kAABSSEUyAAAAFHN0Y28A"
    "AAAAAQAAAGgAAAAwc3RzegAAACgAAAA+AAAAFHN0Y28AAAAAAQAAAGAAAAAQc3Rj"
    "bwAAAAAAAAABAAAAMAAAABR0c2NhAAAAAQAAADAAAAAQc3RzegAAAAAAAAAAAAAA"
    "ABRzdHNvAAAAAAAAAAEAAAASAAAAFHN0Y28AAAAAAAAAAQAAADAAAAA="
)

ACTION_TO_WASD = {
    "noop": "idle",
    "wait": "idle",
    "tick": "idle",
    "move_n": "forward",
    "move_s": "back",
    "move_e": "right",
    "move_w": "left",
    "talk": "interact",
    "give_ore": "interact",
    "use_portal": "forward",
    "attack": "attack",
    "archery": "archery",
    "spell": "spell",
    "shoot": "shoot",
}


def _mode(explicit: str | None) -> str:
    return explicit or os.environ.get("LINGBOT_MODE", "mock")


def _svg_frame(
    *,
    title: str,
    region: str,
    wasd: str,
    step: int,
    prompt: str,
    palette: list[str] | None = None,
) -> str:
    bg = (palette or ["#1a3a2a", "#d8f3dc"])[0]
    fg = (palette or ["#1a3a2a", "#d8f3dc"] + ["#f8fafc"])[-1] if palette else "#e2e8f0"
    safe_prompt = (prompt or "")[:90].replace("&", "&amp;").replace("<", "")
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="{bg}"/>
      <stop offset="100%" stop-color="#0b1220"/>
    </linearGradient>
  </defs>
  <rect width="640" height="360" fill="url(#g)"/>
  <text x="32" y="48" fill="{fg}" font-family="Georgia,serif" font-size="22">{title}</text>
  <text x="32" y="84" fill="#94a3b8" font-family="monospace" font-size="14">region={region}  step={step}  wasd={wasd}</text>
  <text x="32" y="120" fill="#cbd5e1" font-family="sans-serif" font-size="13">{safe_prompt}</text>
  <rect x="40" y="160" width="560" height="140" rx="8" fill="#00000055" stroke="#64748b"/>
  <text x="320" y="240" text-anchor="middle" fill="#f8fafc" font-size="28" font-family="monospace">{wasd.upper()}</text>
  <text x="32" y="340" fill="#64748b" font-size="11">OpenGame × LingBot mock frame (not real weights)</text>
</svg>"""
    return "data:image/svg+xml;charset=utf-8," + quote(svg)


def _hex_rgb(raw: str, default: tuple[int, int, int]) -> tuple[int, int, int]:
    s = (raw or "").strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    if len(s) != 6:
        return default
    try:
        return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)
    except ValueError:
        return default


def _png_frame(
    *,
    title: str = "",
    region: str = "",
    wasd: str = "idle",
    step: int = 0,
    prompt: str = "",
    palette: list[str] | None = None,
) -> str:
    """Readable mock poster (640×360 PNG). Never return 1×1 placeholders."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "Pillow required for LingBot session frames "
            "(pip install pillow). 1×1 mock PNGs are banned."
        ) from exc

    w, h = 640, 360
    bg = _hex_rgb((palette or ["#1a3a2a"])[0], (26, 58, 42))
    fg = _hex_rgb(
        (palette or ["#1a3a2a", "#d8f3dc", "#f8fafc"])[-1],
        (248, 250, 252),
    )
    img = Image.new("RGB", (w, h), bg)
    draw = ImageDraw.Draw(img)
    # Atmosphere gradient bars
    for i in range(h):
        mix = i / max(1, h - 1)
        r = int(bg[0] * (1 - mix) + 11 * mix)
        g = int(bg[1] * (1 - mix) + 18 * mix)
        b = int(bg[2] * (1 - mix) + 32 * mix)
        draw.line([(0, i), (w, i)], fill=(r, g, b))
    draw.rectangle([24, 24, w - 24, h - 24], outline=(100, 116, 139), width=2)
    draw.rectangle([40, 150, w - 40, 290], fill=(20, 24, 36))
    font = ImageFont.load_default()
    lines = [
        (title or "OpenGame × LingBot")[:48],
        f"region={region or '?'}  step={step}  wasd={wasd}",
        (prompt or "")[:72],
        "presentation mock frame (not real-time weights)",
    ]
    y = 40
    for idx, line in enumerate(lines):
        color = fg if idx == 0 else (148, 163, 184) if idx < 3 else (100, 116, 139)
        draw.text((40, y), line, fill=color, font=font)
        y += 28 if idx == 0 else 22
    draw.text(
        (w // 2, 210),
        (wasd or "idle").upper(),
        fill=fg,
        font=font,
        anchor="mm",
    )
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def manifest_to_wasd_matrix(manifest: ActionManifest) -> list[list[float]]:
    rows: list[list[float]] = []
    for fr in manifest.frames:
        wasd = str(fr.get("wasd") or "idle")
        row = [0.0] * len(WASD_CHANNELS)
        idx = WASD_CHANNELS.index(wasd) if wasd in WASD_CHANNELS else 0
        row[idx] = 1.0
        rows.append(row)
    if not rows:
        rows = [[1.0] + [0.0] * (len(WASD_CHANNELS) - 1)]
    return rows


def write_action_path(action_dir: Path, manifest: ActionManifest) -> dict[str, Any]:
    """Write LingBot-compatible action_path artifacts (JSON always; npy if numpy present)."""
    action_dir.mkdir(parents=True, exist_ok=True)
    matrix = manifest_to_wasd_matrix(manifest)
    poses = []
    yaw = pitch = 0.0
    for fr in manifest.frames:
        yaw += float(fr.get("yawDelta") or 0.0)
        pitch += float(fr.get("pitchDelta") or 0.0)
        poses.append([yaw, pitch, 0.0, 0.0, 0.0, 0.0])
    if not poses:
        poses = [[0.0] * 6]

    meta = {
        "schema": "opengame-lingbot-action-path-v1",
        "fps": manifest.fps,
        "frameCount": len(matrix),
        "channels": WASD_CHANNELS,
        "conditioningPrompt": manifest.conditioningPrompt,
        "source": "opengame-sidecar",
    }
    (action_dir / "manifest.json").write_text(
        json.dumps(
            {
                **meta,
                "frames": manifest.frames,
                "wasdMatrix": matrix,
                "poses": poses,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    npy_written = False
    try:
        import numpy as np  # type: ignore

        np.save(action_dir / "wasd_action.npy", np.asarray(matrix, dtype=np.float32))
        np.save(action_dir / "poses.npy", np.asarray(poses, dtype=np.float32))
        # Broad "action.npy" — stack wasd + pose deltas when operators expect a single file
        action = np.concatenate(
            [np.asarray(matrix, dtype=np.float32), np.asarray(poses, dtype=np.float32)],
            axis=1,
        )
        np.save(action_dir / "action.npy", action)
        # Dummy intrinsics (fx, fy, cx, cy) repeated
        T = len(matrix)
        intr = np.tile(np.array([500.0, 500.0, 320.0, 180.0], dtype=np.float32), (T, 1))
        np.save(action_dir / "intrinsics.npy", intr)
        npy_written = True
    except Exception:
        npy_written = False
    return {"dir": str(action_dir), "npy": npy_written, "frames": len(matrix), **meta}


@app.get("/health")
def health() -> dict[str, Any]:
    from gpu_probe import ckpt_looks_complete, readiness

    ready = readiness()
    gpu = ready.get("gpu") or {}
    ckpt_path = ready.get("ckpt") or ""
    checklist = [
        {
            "id": "license",
            "ok": os.environ.get("LINGBOT_ACCEPT_NC_LICENSE", "").lower()
            in ("1", "true", "yes"),
            "hint": "Platform .env: LINGBOT_ACCEPT_NC_LICENSE=true",
        },
        {
            "id": "gpu",
            "ok": bool(gpu.get("ok")),
            "hint": gpu.get("name") or gpu.get("reason") or "nvidia-smi",
        },
        {
            "id": "repo",
            "ok": bool(ready.get("repo")),
            "hint": ready.get("repo") or "Set LINGBOT_REPO_DIR (clone lingbot-world-v2)",
        },
        {
            "id": "ckpt",
            "ok": bool(ready.get("ckpt")),
            "hint": ready.get("ckpt")
            or "Set LINGBOT_CKPT_DIR (14b-causal-fast weights)",
        },
        {
            "id": "ckptWeights",
            "ok": bool(ready.get("weightsReady")),
            "hint": (
                f"{(ready.get('weights') or {}).get('shardComplete', 0)}/"
                f"{(ready.get('weights') or {}).get('shardExpected', 8)} "
                "model-*-of-00008.safetensors (≥1GB each)"
            ),
        },
        {
            "id": "generatePy",
            "ok": bool(ready.get("generatePy")),
            "hint": ready.get("generatePy") or "generate.py missing under repo",
        },
    ]
    warnings = list(ready.get("warnings") or [])
    vram = int(gpu.get("vramTotalMb") or 0)
    if gpu.get("ok") and 0 < vram < 10_000:
        warnings.append(
            f"Detected ~{vram}MB VRAM (e.g. 4070 Laptop 8GB) — keep frames=17; "
            "official 14B may OOM; mock fallback is on."
        )
    return {
        "ok": True,
        "version": "0.5.0",
        "mode": ready.get("mode") or os.environ.get("LINGBOT_MODE", "mock"),
        "license": LICENSE,
        "ckpt": ready.get("ckpt"),
        "repo": ready.get("repo"),
        "sessions": len(_SESSIONS),
        "mediaDir": str(MEDIA_ROOT),
        "publicBase": PUBLIC_BASE,
        "upstream": "https://github.com/Robbyant/lingbot-world-v2",
        "profile": ready.get("profile"),
        "readyReal": ready.get("readyReal"),
        "weightsReady": ready.get("weightsReady"),
        "weights": ready.get("weights"),
        "gpu": ready.get("gpu"),
        "recommended": ready.get("recommended"),
        "warnings": warnings,
        "seedImage": ready.get("seedImage"),
        "checklist": checklist,
        "envLoaded": _ENV_APPLIED[:12],
        "discovered": _DISCOVERED,
        "note": (
            "档 B (RTX 4070 / consumer): /step records actions; "
            "POST /v1/smoke verifies mock media; "
            "POST /v1/sessions/{id}/generate runs offline generate.py → /media. "
            "weightsReady=true → set LINGBOT_MODE=real for real clips."
        ),
    }


@app.post("/v1/smoke")
def smoke_clip() -> dict[str, Any]:
    """Always-on mock clip — verifies /media publish without GPU weights."""
    body = GenerateBody(
        prompt="OpenGame LingBot smoke test",
        regionId="smoke",
        worldTitle="Smoke",
        actionManifest=ActionManifest(
            **{
                "schema": "opengame-lingbot-action-v1",
                "fps": 8,
                "frameCount": 8,
                "frames": [{"t": i + 1, "wasd": "forward"} for i in range(8)],
                "conditioningPrompt": "smoke",
            }
        ),
        mode="mock",
    )
    result = _generate_mock(body)
    return {
        **result,
        "smoke": True,
        "message": "Smoke mock clip OK — media pipeline works (no GPU required)",
    }


@app.post("/v1/convert-action")
def convert_action(body: ConvertBody) -> dict[str, Any]:
    work = Path(tempfile.mkdtemp(prefix="lingbot_action_"))
    info = write_action_path(work, body.actionManifest)
    if body.writeNpy and not info.get("npy"):
        return {
            "ok": True,
            "message": "JSON action_path written; install numpy for .npy export",
            "license": LICENSE,
            **info,
        }
    return {
        "ok": True,
        "message": f"Action path ready ({info['frames']} frames, npy={info['npy']})",
        "license": LICENSE,
        **info,
    }


@app.post("/v1/generate")
def generate(body: GenerateBody) -> dict[str, Any]:
    mode = _mode(body.mode)
    if mode == "real":
        return _generate_real(body)
    return _generate_mock(body)


@app.post("/v1/sessions")
def create_session(body: SessionCreateBody) -> dict[str, Any]:
    mode = _mode(body.mode)
    sid = str(uuid.uuid4())
    frame = _png_frame(
        title=body.worldTitle or "OpenGame World",
        region=body.regionId,
        wasd="idle",
        step=0,
        prompt=body.prompt,
        palette=body.styleAnchor.palette,
    )
    _SESSIONS[sid] = {
        "id": sid,
        "mode": mode,
        "prompt": body.prompt,
        "regionId": body.regionId,
        "worldTitle": body.worldTitle,
        "styleAnchor": body.styleAnchor.model_dump(),
        "seedImageUrl": body.seedImageUrl,
        "step": 0,
        "history": [],
        "createdAt": time.time(),
        "lastFrameUrl": frame,
    }
    return {
        "ok": True,
        "sessionId": sid,
        "mode": mode,
        "frameUrl": frame,
        "videoUrl": None,
        "message": f"LingBot session opened ({mode})",
        "license": LICENSE,
        "specAuthority": True,
        "presentationMock": True,
        "frameKind": "mock_png_640x360",
        "interactiveVideo": False,
        "note": (
            "Frames are presentation mock PNGs (readable size, not 1×1). "
            "Real clips require offline /generate. World Spec remains SSOT."
        ),
    }


@app.post("/v1/sessions/{session_id}/step")
def step_session(session_id: str, body: SessionStepBody) -> dict[str, Any]:
    sess = _SESSIONS.get(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="session not found")
    wasd = body.wasd
    if body.action:
        wasd = ACTION_TO_WASD.get(body.action, wasd)
    if wasd not in WASD_CHANNELS:
        wasd = "idle"
    sess["step"] = int(sess["step"]) + 1
    entry = {
        "t": sess["step"],
        "wasd": wasd,
        "action": body.action,
        "textEvent": body.textEvent,
        "yawDelta": body.yawDelta,
        "pitchDelta": body.pitchDelta,
    }
    sess["history"].append(entry)
    # Keep last 256 actions for causal horizon demos
    if len(sess["history"]) > 256:
        sess["history"] = sess["history"][-256:]

    if sess["mode"] == "real":
        # Real interactive streaming is not released by upstream; fall back to mock frame
        # while recording action path for offline generate.py batching.
        pass

    frame = _png_frame(
        title=sess.get("worldTitle") or "OpenGame World",
        region=sess["regionId"],
        wasd=wasd,
        step=sess["step"],
        prompt=body.textEvent or sess["prompt"],
        palette=(sess.get("styleAnchor") or {}).get("palette"),
    )
    sess["lastFrameUrl"] = frame
    recording = sess.get("mode") == "real"
    return {
        "ok": True,
        "sessionId": session_id,
        "step": sess["step"],
        "wasd": wasd,
        "frameUrl": frame,
        "historyLen": len(sess["history"]),
        "message": (
            f"step {sess['step']} · {wasd}"
            + (" · recording for offline clip" if recording else "")
            + (" · presentation mock frame" if recording else "")
        ),
        "recording": recording,
        "presentationMock": True,
        "frameKind": "mock_png_640x360",
        "interactiveVideo": False,
        "license": LICENSE,
        "specAuthority": True,
    }


@app.get("/v1/sessions/{session_id}")
def get_session(session_id: str) -> dict[str, Any]:
    sess = _SESSIONS.get(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="session not found")
    return {
        "ok": True,
        "session": {
            "id": sess["id"],
            "mode": sess["mode"],
            "regionId": sess["regionId"],
            "step": sess["step"],
            "historyLen": len(sess["history"]),
            "lastFrameUrl": sess.get("lastFrameUrl"),
        },
        "license": LICENSE,
    }


@app.delete("/v1/sessions/{session_id}")
def close_session(session_id: str) -> dict[str, Any]:
    sess = _SESSIONS.pop(session_id, None)
    if not sess:
        raise HTTPException(status_code=404, detail="session not found")
    # Persist action path for later offline LingBot generate
    work = Path(tempfile.gettempdir()) / "opengame-lingbot-sessions" / session_id
    frames = [
        {
            "t": h["t"],
            "wasd": h["wasd"],
            "textEvent": h.get("textEvent"),
            "yawDelta": h.get("yawDelta", 0),
            "pitchDelta": h.get("pitchDelta", 0),
        }
        for h in sess["history"]
    ]
    manifest = ActionManifest(
        **{
            "schema": "opengame-lingbot-action-v1",
            "fps": 8,
            "frameCount": len(frames),
            "frames": frames,
            "conditioningPrompt": sess["prompt"],
        }
    )
    info = write_action_path(work, manifest)
    return {
        "ok": True,
        "closed": True,
        "actionPath": info,
        "license": LICENSE,
    }


@app.post("/v1/sessions/{session_id}/generate")
def generate_from_session(
    session_id: str, body: SessionGenerateBody = SessionGenerateBody()
) -> dict[str, Any]:
    """Offline clip from recorded action_path (档 B product path)."""
    sess = _SESSIONS.get(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="session not found")
    history = sess.get("history") or []
    if not history:
        history = [{"t": 1, "wasd": "forward"}, {"t": 2, "wasd": "right"}, {"t": 3, "wasd": "idle"}]
    frames = [
        {
            "t": h.get("t", i + 1),
            "wasd": h.get("wasd", "idle"),
            "textEvent": h.get("textEvent"),
            "yawDelta": h.get("yawDelta", 0),
            "pitchDelta": h.get("pitchDelta", 0),
        }
        for i, h in enumerate(history)
    ]
    # Expand short sessions so generate.py has enough conditioning frames
    while len(frames) < 8:
        last = frames[-1] if frames else {"t": 0, "wasd": "idle"}
        frames.append(
            {
                "t": int(last.get("t", 0)) + 1,
                "wasd": last.get("wasd", "idle"),
                "textEvent": None,
                "yawDelta": 0,
                "pitchDelta": 0,
            }
        )
    manifest = ActionManifest(
        **{
            "schema": "opengame-lingbot-action-v1",
            "fps": 8,
            "frameCount": len(frames),
            "frames": frames,
            "conditioningPrompt": sess.get("prompt") or "",
        }
    )
    gen = GenerateBody(
        prompt=sess.get("prompt") or "OpenGame world cinematic",
        regionId=sess.get("regionId") or "region",
        worldTitle=sess.get("worldTitle") or "OpenGame World",
        styleAnchor=StyleAnchor(**(sess.get("styleAnchor") or {})),
        actionManifest=manifest,
        seedImageUrl=sess.get("seedImageUrl"),
        frameNum=body.frameNum,
        mode=body.mode or sess.get("mode"),
    )
    result = generate(gen)
    if result.get("ok") and result.get("videoUrl"):
        sess["lastVideoUrl"] = result["videoUrl"]
        sess["lastLocalPath"] = result.get("localPath")
    return {
        **result,
        "sessionId": session_id,
        "historyLen": len(history),
        "specAuthority": True,
        "productNote": "Session /step is recording; this endpoint runs offline generate → playable clip.",
    }


def _generate_mock(body: GenerateBody) -> dict[str, Any]:
    out_dir = MEDIA_ROOT / "mock"
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = int(time.time() * 1000)
    action_info = write_action_path(out_dir / f"action_{body.regionId}_{stamp}", body.actionManifest)
    frame = _png_frame(
        title=body.worldTitle or "OpenGame World",
        region=body.regionId,
        wasd=(body.actionManifest.frames[0] or {}).get("wasd", "idle")
        if body.actionManifest.frames
        else "idle",
        step=0,
        prompt=body.prompt,
        palette=body.styleAnchor.palette,
    )
    video_path = out_dir / f"{body.regionId}_{stamp}.mp4"
    video_path.write_bytes(_MINI_MP4)
    published = _publish_mp4(video_path)
    return {
        "ok": True,
        "mock": True,
        "videoUrl": published["videoUrl"],
        "httpUrl": published["httpUrl"],
        "posterUrl": frame,
        "frameUrl": frame,
        "message": (
            f"Mock LingBot clip for {body.regionId} "
            f"({body.actionManifest.frameCount} action frames, npy={action_info.get('npy')})"
        ),
        "license": LICENSE,
        "localPath": published["localPath"],
        "actionPath": action_info,
    }


def _generate_real(body: GenerateBody) -> dict[str, Any]:
    from real_generate import (
        default_frame_num,
        run_real_generate,
        should_fallback_mock,
    )

    ckpt = os.environ.get("LINGBOT_CKPT_DIR")
    repo = os.environ.get("LINGBOT_REPO_DIR")
    if not ckpt or not repo:
        mock_fb = _generate_mock(body) if should_fallback_mock({"ok": False}) else None
        base = {
            "ok": False,
            "mock": False,
            "message": "LINGBOT_CKPT_DIR and LINGBOT_REPO_DIR required for real mode",
            "license": LICENSE,
        }
        if mock_fb:
            return {
                **mock_fb,
                "ok": True,
                "fallbackFromReal": True,
                "message": f"{base['message']} — fell back to mock clip",
            }
        return base

    work = Path(tempfile.mkdtemp(prefix="lingbot_og_"))
    action_dir = work / "action"
    action_info = write_action_path(action_dir, body.actionManifest)
    save_dir = work / "out"
    save_dir.mkdir(parents=True, exist_ok=True)
    frame_num = default_frame_num(
        body.actionManifest.frameCount or len(body.actionManifest.frames) or 8,
        body.frameNum,
    )

    result = run_real_generate(
        repo=repo,
        ckpt=ckpt,
        action_dir=action_dir,
        save_dir=save_dir,
        prompt=body.prompt,
        frame_num=frame_num,
        seed_image=body.seedImageUrl,
    )
    if result.get("ok") and result.get("videoPath"):
        published = _publish_mp4(Path(result["videoPath"]))
        return {
            "ok": True,
            "mock": False,
            "videoUrl": published["videoUrl"],
            "httpUrl": published["httpUrl"],
            "message": result.get("message")
            or f"Real LingBot clip for {body.regionId}",
            "license": LICENSE,
            "localPath": published["localPath"],
            "actionPath": action_info,
            "meta": result.get("meta"),
            "profile": (result.get("meta") or {}).get("profile"),
        }

    # Consumer / OOM path — still deliver a playable mock so product UI works
    if should_fallback_mock(result):
        mock_fb = _generate_mock(body)
        return {
            **mock_fb,
            "ok": True,
            "fallbackFromReal": True,
            "realError": result.get("message"),
            "oom": result.get("oom"),
            "meta": result.get("meta"),
            "message": (
                f"Real generate failed — mock clip served "
                f"(set LINGBOT_FALLBACK_MOCK=false to disable). "
                f"Detail: {(result.get('message') or '')[:240]}"
            ),
            "actionPath": action_info,
        }

    return {
        "ok": False,
        "mock": False,
        "message": result.get("message") or "real generate failed",
        "license": LICENSE,
        "actionPath": action_info,
        "meta": result.get("meta"),
        "oom": result.get("oom"),
    }
