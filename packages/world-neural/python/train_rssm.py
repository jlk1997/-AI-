#!/usr/bin/env python3
"""
OpenGame World Dynamics — research trainer (PyTorch DynamicsMLP).

HONESTY NOTE: Filename is historical (`train_rssm.py`). This script trains a
plain DynamicsMLP, NOT a Dreamer/RSSM world model. Swap in RSSM modules here
when you need that research path.

Path:
  1. Export trajectories: `npm run collect -w @opengame/world-neural`
  2. Train this DynamicsMLP (or replace with RSSM)
  3. Export weights JSON for Node HybridWorldModel

Usage:
  pip install torch
  python train_rssm.py --data ../../data/traj.jsonl --out ../../models/dynamics_torch.json

Default product path uses the TypeScript MLP in @opengame/world-neural.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

try:
    import torch
    import torch.nn as nn
except ImportError as e:
    raise SystemExit(
        "PyTorch required: pip install torch\n"
        "Or use the pure-TS trainer: npm run train -w @opengame/world-neural"
    ) from e


STATE_DIM = 64
ACTION_DIM = 16
INPUT_DIM = STATE_DIM + ACTION_DIM


class DynamicsMLP(nn.Module):
    def __init__(self, hidden: int = 256):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(INPUT_DIM, hidden),
            nn.ReLU(),
            nn.Linear(hidden, hidden),
            nn.ReLU(),
            nn.Linear(hidden, STATE_DIM),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def load_jsonl(path: Path):
    xs, ys = [], []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        xs.append(row["obs"] + row["actionVec"])
        ys.append(row["nextObs"])
    return torch.tensor(xs, dtype=torch.float32), torch.tensor(ys, dtype=torch.float32)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--epochs", type=int, default=80)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--hidden", type=int, default=256)
    args = ap.parse_args()

    x, y = load_jsonl(args.data)
    model = DynamicsMLP(args.hidden)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    loss_fn = nn.MSELoss()

    for ep in range(args.epochs):
        opt.zero_grad()
        pred = model(x)
        loss = loss_fn(pred, y)
        loss.backward()
        opt.step()
        if ep % 10 == 0 or ep == args.epochs - 1:
            print(f"epoch={ep} loss={loss.item():.6f}")

    # Export in a JSON shape close to the TS MLP for experimentation.
    # Full RSSM/Dreamer weights would use a separate schema + ONNX.
    state = {k: v.detach().cpu().flatten().tolist() for k, v in model.state_dict().items()}
    payload = {
        "format": "opengame-world-torch-mlp-v1",
        "stateDim": STATE_DIM,
        "actionDim": ACTION_DIM,
        "hidden": args.hidden,
        "state_dict": state,
        "note": "Use ONNX export for production Node inference; TS Hybrid still prefers opengame-world-mlp-v1.",
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload), encoding="utf-8")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
