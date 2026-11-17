# World Model Neural Path — 把「不可能」做成可复现的开源阶梯

先前说「短期不做自训 Marble / Dreamer 级底座」，指的是：**不要假装已经训好了 Fei-Fei 级空间基础模型**。  
真正的创新路径是：**符号世界 SSOT + 可训练动力学 + 开源模型升级插槽**。本仓库已落地该阶梯。

## 三层世界模型（同时存在）

```
┌─────────────────────────────────────────────────────────┐
│ L3  Spatial backends（Marble API / Three / 未来 mesh）   │
├─────────────────────────────────────────────────────────┤
│ L2  Neural Dynamics（TS MLP 已训 / PyTorch RSSM 可换）   │
├─────────────────────────────────────────────────────────┤
│ L1  Symbolic World Spec + Deterministic Sim（真相源）    │
└─────────────────────────────────────────────────────────┘
```

- **L1 永不被神经网络替换**：可校验、可回放、可断言剧情。
- **L2 学习「下一步会发生什么」**：用于想象（imagine）、NPC 意图、规划剪枝。
- **L3 只负责观感**：2D Phaser / 3D Three / 外部空间生成。

## 开源训练路径（你现在就能跑）

### A. 纯 TypeScript（零 PyTorch，默认）

```bash
npm run build -w @opengame/world-neural
cd packages/world-neural
node dist/cli.js collect --out data/traj.jsonl --episodes 40
node dist/cli.js train   --data data/traj.jsonl --out models/dynamics.json --epochs 50
```

或平台 API：`POST /v1/projects/:id/world/train`（`sync:true` 立即训；否则入队 `world_train`）。

### B. PyTorch 研究轨（可换 Dreamer / RSSM / JEPA）

```bash
pip install torch
python packages/world-neural/python/train_rssm.py \
  --data packages/world-neural/data/traj.jsonl \
  --out models/dynamics_torch.json
```

轨迹格式固定为 JSONL：`{ obs[64], action, actionVec[16], nextObs[64], reward, events }`。  
任意开源序列模型只要吃同一 schema，就能接回 `HybridWorldModel`。

### C. 空间智能开源候选（插件，不锁死一家）

| 能力 | 开源/可接方向 |
|------|----------------|
| 布局→网格 | 本仓库 Spec + ASCII layout |
| 视频世界模型 | [LingBot-World-v2](https://github.com/Robbyant/lingbot-world-v2)（`WORLD_SPATIAL_BACKEND=lingbot` + sidecar；CC BY-NC-SA） |
| 图像→3D | TripoSR / InstantMesh / LGM（作为 SpatialBackend） |
| 商业空间 API | World Labs Marble（`WORLD_SPATIAL_BACKEND=marble`） |

## 产品闭环

1. `planWorldFromPrompt`（LLM JSON Spec，失败回落启发式）
2. `WorldSimulator` tick（因果）
3. 可选 inline / job 训练 dynamics
4. `HybridWorldModel.imagine` 对动作排序
5. Phaser 或 Three presenter 只读 Spec

**奇迹不是「一次性训出上帝模型」，而是：每天都能采数据、训一版、测 surprise、再扩开源底座。**
