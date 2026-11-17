# LingBot-World v2 × OpenGame — 结合分析与落地契约

参考开源项目：[Robbyant/lingbot-world-v2](https://github.com/Robbyant/lingbot-world-v2)（*Infinite Worlds with Versatile Interactions*）。

## 它是什么 / 不是什么

| LingBot-World v2 | OpenGame |
|------------------|----------|
| 动作条件化 **交互视频世界模型**（Wan2.2 I2V + `action_path`） | **World Spec + Phaser** 为玩法 SSOT |
| 14B causal-fast，多卡；可驱动高分辨率视频流 | 浏览器可玩、可校验、可编辑 |
| Pilot + Director agentic harness | `runAgenticHarness`（Spec/Op，无需 GPU） |
| **CC BY-NC-SA 4.0** | Apache-2.0 产品核 |

**不能用 LingBot 替换 Spec/Phaser。** 它是 L3 视觉流插件。

## 已落地架构

```
玩家输入
  ├─ L1 World Spec + Sim / WorldGameEngine     ← 权威下一状态
  ├─ L2 HybridWorldModel.imagine               ← 符号动力学
  ├─ Pilot / Director (agentic)                ← 借鉴 LingBot 编排
  └─ L3 LingBot sidecar
        ├─ POST /v1/generate          区域 cinematic
        ├─ POST /v1/sessions + /step  交互帧（mock SVG / real GPU）
        └─ POST /v1/convert-action    → wasd_action.npy / poses.npy
```

| 模块 | 路径 |
|------|------|
| Action bridge | `packages/world-runtime/src/spatial/lingbotActionBridge.ts` |
| Spatial backend | `packages/world-runtime/src/spatial/lingbot.ts` |
| Session client | `packages/world-runtime/src/spatial/lingbotSession.ts` |
| Spec↔视觉耦合 | `packages/world-runtime/src/spatial/lingbotCoupled.ts` |
| Sidecar | `services/lingbot-sidecar/app.py` |
| Phaser overlay | `packages/world-runtime/scaffold/src/engine/CinematicLayer.ts` |
| API | `/v1/projects/:id/world/lingbot/{health,session,step,clip,convert}` + `DELETE …/session/:id` |

## 快速跑通（无 GPU）

```bash
cd services/lingbot-sidecar
pip install -r requirements.txt
# optional: pip install numpy   # 写出真实 .npy
uvicorn app:app --host 127.0.0.1 --port 8091
```

`.env`：

```bash
WORLD_SPATIAL_BACKEND=lingbot
LINGBOT_SIDECAR_URL=http://127.0.0.1:8091
LINGBOT_MODE=mock
LINGBOT_ACCEPT_NC_LICENSE=true
# WORLD_AGENTIC_ON_GENERATE=true
# LINGBOT_ALL_REGIONS=true   # 默认只生成 startRegion
```

Web：世界面板 → 空间后端 `lingbot` → **开 Session** → 点 `move_n` / `attack` 看帧。  
游戏：探索场景会挂 cinematic 叠层，移动/对话时 `pushAction`（sidecar 在线时）。

## 真权重 / 档 B（研究 / 非商用）

按 [上游 README](https://github.com/Robbyant/lingbot-world-v2)：clone 仓库、装 torch/flash-attn、下 `lingbot-world-v2-14b-causal-fast`。

**产品默认策略**：动作轨迹 + 离线 `generate.py` 出片 → 入库可播（`public/spatial/` 或 Spec `spatialAssets`），**不是**假装 `/step` 已是实时大片。

### 一键清单（含 RTX 4070 Laptop ~8GB）

本机常见配置是 **4070 Laptop 约 8GB 显存**（不是桌面 12GB）。官方 `generate.py` 面向约 8 卡；产品侧用 `LINGBOT_PROFILE=consumer`：

- `nproc=1`、短片 `frame_num=17`
- Sidecar **自动读仓库 `.env`**，并尝试发现 `E:/models/lingbot-*`
- OOM / 失败默认回落 mock；面板有 **Smoke mock**（不需权重）先验证 `/media`

```powershell
cd services/lingbot-sidecar
.\finish-when-ready.ps1 -Once   # 8/8 分片齐则写 .env → real
.\check-tier-b.ps1
.\start-tier-b.ps1              # 读取 .env 的 LINGBOT_MODE（勿再强行 mock）
```

世界面板顶栏烧瓶 / 「打开科研实验室」→ **科研实验室 · LingBot L3**（默认可见，不再藏在折叠里）：

健康检查 → **Smoke mock** → Session → step → 出片(frames=17)。

**权重状态（本机）**：`E:/models/lingbot-world-v2-14b-causal-fast/transformers` 已 8/8 → `.env` 设 `LINGBOT_MODE=real` + `VITE_LINGBOT_MODE=real`。8GB 显存 OOM 时 `LINGBOT_FALLBACK_MOCK=true` 仍回落 mock，链路不断。

## 产品边界

- Spec 永远是真相源；LingBot 帧不决定 quest / combat / inventory。
- 商业发行勿捆绑权重；适配器保持 optional。
- 视频/sidecar 失败自动回落 Phaser，不阻断世界生成。
- 权重许可：**CC BY-NC-SA 4.0**（研究 / 非商用）。

## CLI 防挂死（游戏生成）

Worker 对 OpenGame CLI 设硬超时：`PLATFORM_CLI_TIMEOUT_MS`（默认 720000）。超时退出码 124，任务可重试。

## 快速上手（产品 UI）

1. **首次打开**会弹出双轨引导（游戏 / 世界）；也可点右下角「?」。
2. 输入框上方切换 **游戏 / 世界**（或顶栏地球图标）。
3. 世界模式点 **演示小镇**（或引导里一键生成）。
4. 生成成功后：**焦点留在右侧试玩** — 顶部出现 Spec 摘要条 + 操作提示；toast 提示可随时打开世界面板。
5. 方向键 / E / F / C 试玩；有 Spec 后，聊天跟进会走 **`world_edit`**（编辑芯片可一键示例）。
6. 世界面板内可 Sim / 编辑 / Pilot+Director；可选 **LingBot** Session 做 L3 视觉叠层。

## 产品闭环（Play loop）

```
模板 / 提示词 / WORLD_SPATIAL_BACKEND=lingbot
       ↓
world_generate → Spec 戳记 spatialBackend + lingbotMode + cinematicEnabled
       ↓
Presenter 部署：world.json + gameplay.json + lingbot.json + spatial/
       ↓
右侧 iframe 试玩（CinematicLayer 读 Spec / lingbot.json，区域切换换片）
       ↓
聊天跟进 / 编辑芯片 → world_edit → 刷新 Spec + remount 预览
       ↓（档 B）
Session → step（mock 帧）→ Clip persist
       → tipRevision++ · 改写部署 world.json / spatial/*.mp4
       → WorldPanel onPreviewRemount
```

### 与系统设计的耦合点（档 B）

| 层 | 契约 |
|----|------|
| Spec SSOT | `presentation.spatialBackend` / `lingbotMode` / `spatialAssets[region].videoUrl` |
| 生成管线 | `WORLD_SPATIAL_BACKEND=lingbot` 或提示词关键词戳记 Spec（不只靠 UI） |
| Presenter | `public/lingbot.json` 优先于 Vite env；区域换片走 `showRegion` |
| Tip API | `GET …/world` 返回一等字段 `l3`（backend / mode / clipCount） |
| Clip persist | 写 DB Spec + tipRevision + 部署 `world.json` + remount 预览 |
| 玩法权威 | Phaser / WorldGameEngine；LingBot 永不驱动 quest/combat/inventory |