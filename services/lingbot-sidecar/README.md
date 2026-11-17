# OpenGame ↔ LingBot-World-v2 sidecar (v0.5) — 档 B

Interactive video world model adapter for [lingbot-world-v2](https://github.com/Robbyant/lingbot-world-v2).

**Product path:** `/step` records action_path → offline `generate.py` → `/media/*.mp4`. Spec/Phaser remain SSOT. Weights **CC BY-NC-SA 4.0**.

## Your machine (RTX 4070 Laptop ~8GB)

Sidecar auto-loads repo `.env` and may discover `E:/models/lingbot-world-v2*`. Keep:

- `LINGBOT_PROFILE=consumer` · `LINGBOT_FRAME_NUM=17` · `LINGBOT_FALLBACK_MOCK=true`
- Weights 8/8 ready → `LINGBOT_MODE=real` (start-tier-b reads `.env`, does not force mock)

```powershell
# Clone repo + download ~70GB weights to E:\models (idempotent)
.\setup-models.ps1
# After weights land:
.\finish-when-ready.ps1 -Once   # verify 8/8 + flip .env to real
.\check-tier-b.ps1
.\start-tier-b.ps1
```

Web: top-bar flask icon / World panel → **Research lab · LingBot L3** (always visible): Health → Smoke → Session → Generate clip.

Official 14B targets ~8×GPU; single 8GB card may OOM — mock fallback keeps the OpenGame loop alive.

## Commands

```powershell
cd services/lingbot-sidecar
.\check-tier-b.ps1          # GPU + .env + health
.\start-tier-b.ps1          # uvicorn :8091
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | GPU, profile, readyReal, checklist, warnings |
| POST | `/v1/smoke` | Mock clip — verify /media (no GPU) |
| POST | `/v1/generate` | region cinematic |
| POST | `/v1/sessions` + `/step` | record actions |
| POST | `/v1/sessions/{id}/generate` | offline clip from trajectory |
| DELETE | `/v1/sessions/{id}` | close |
| POST | `/v1/convert-action` | npy export |
| GET | `/media/{file}` | published mp4 |
