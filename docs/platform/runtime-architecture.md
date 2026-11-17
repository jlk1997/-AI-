# `@opengame/runtime` 架构

> 适用版本：`0.1.x`（P0）。本文档与 [`opengame-fullmodal-24m`](../../.cursor/plans/opengame-fullmodal-24m_*.plan.md) 计划保持同步。

## 1. 设计动机

在「**完全无模板派**」路线里，平台不再注入 `top_down`/`platformer`/… 的代码模板，而是每次都从 **最小骨架** 出发让 AI 自由组装。这必然引入两个稳定性风险：

1. **每次都从空白生成** ⇒ 同一类游戏会在不同 Job 里走出截然不同的代码路径，QA 难以收敛；
2. **零脚手架** ⇒ 简单玩法也得让 AI 重新发明计分 / HUD / 物理 / 状态机。

`@opengame/runtime` 是对冲这两个风险的「稳定性骨架」：

- 它只暴露 **少量稳定接口**（Scene / Entity / Behavior / SkillChain / UIKit / SaveStore / Leaderboard / Analytics / DSL）。
- 它**不约束游戏形态**：Coder Agent 既可以「全 DSL」声明式落地一个 Snake，也可以「全自定义 Phaser.Scene」实现一个 Bullet Hell。
- 它的 **SemVer 1.x 是硬契约**：所有由 AI 生成的项目都依赖一个固定的 minor，平台升级时不破坏老项目可玩性。

## 2. 包结构

```
packages/runtime/
├── package.json           # @opengame/runtime, peerDep phaser ^3.80
├── src/
│   ├── index.ts           # 入口 barrel
│   ├── core/              # World / Entity / Component / RuntimeScene
│   ├── behaviors/         # Patrol / Chase / Shoot / Dialog / EightWayMovement
│   ├── skills/            # SkillChain（trigger→effects→cooldown）
│   ├── ui/                # HUD / ChoicePanel
│   ├── services/          # SaveStore / Leaderboard / Analytics
│   ├── dsl/               # schema.ts / loader.ts (game.json)
│   ├── bootstrap.ts       # 单调用入口
│   └── poc.test.ts        # 标杆 PoC 校验
├── examples/poc/
│   ├── flappy/            # Flappy Square
│   ├── snake/             # Snake
│   └── 2048/              # 2048
└── skeleton-assets/       # 最小骨架（被 platform-worker 拷贝）
    ├── package.json.tpl   # 含 __RUNTIME_SPEC__ 占位
    ├── vite.config.ts
    ├── tsconfig.json
    ├── index.html
    ├── main.ts            # 仅一行：await bootstrap({ source: '/game.json' })
    └── game.json          # placeholder DSL
```

## 3. ECS-Lite 三件套

```
World ── owns ──▶ Entity[]
Entity ── owns ──▶ Component map（key 唯一）
Component                ─┬─ attach(entity)
                           ├─ update(entity, dtSec)
                           └─ detach(entity)
Behavior extends Component （仅是命名约束，给 Planner 一个更小的词表）
```

设计选择：

- **不上系统(System)抽象**：实测代价远高于收益。Behavior 直接拿到 `entity`，按需访问 `entity.scene.__ogWorld.withTag(...)` 完成跨实体查询。
- **不内置物理代理**：游戏要物理就用 `Phaser.Physics.Arcade`。把物理与 ECS 绑定会让 AI 的"自定义 Scene"路径变得脆弱。
- **`__ogWorld` 软挂在 scene 上**：DSL Loader 在 `onReady` 时挂载，开发者写自定义 Phaser.Scene 时只要 `scene.__ogWorld = world` 就可被 `Chase`/`Shoot` 等行为复用。

## 4. 场景 DSL `game.json`

完整 schema 在 [`packages/runtime/src/dsl/schema.ts`](../../packages/runtime/src/dsl/schema.ts)。核心字段：

```jsonc
{
  "dslVersion": "1.0.0",
  "meta": { "title": "...", "canvas": { "width": 480, "height": 720 } },
  "assets": [ { "id": "bird", "kind": "image", "url": "..." } ],
  "scenes": [
    {
      "id": "main",
      "hud": { "score": true },
      "entities": [
        {
          "id": "player",
          "tags": ["player"],
          "sprite": { "shape": "rect", "x": 120, "y": 360, "color": "#fbbf24" },
          "behaviors": [
            { "kind": "eightWayMovement", "options": { "speed": 200 } }
          ],
          "skills": ["dash"],
          "tunables": {
            "speed": { "type": "number", "value": 200, "min": 50, "max": 600 }
          }
        }
      ]
    }
  ],
  "skills": [
    {
      "id": "dash",
      "trigger": { "kind": "onKey", "key": "SHIFT" },
      "effects": [{ "kind": "spawn", "payload": {} }],
      "cooldownSec": 0.6
    }
  ],
  "customModules": ["src/customScene.ts"]
}
```

DSL 设计原则：

- **可加不可删**：minor 版本只能加字段、不能删；删除走 `dslVersion` 主版本号。
- **足够无聊**：宁可让 AI 多写一点 TS 也不要让 schema 试图覆盖所有玩法。复杂玩法直接走 `customModules`。
- **Planner Agent 单一可信输出**：Planner 角色的最终产物就是 `game.json`，Coder 角色再补 TS。

## 5. Bootstrap

`skeleton-assets/main.ts` 缩成一行：

```ts
import { bootstrap } from '@opengame/runtime/bootstrap';
await bootstrap({ source: '/game.json' });
```

`bootstrap` 内部：

1. `fetch('/game.json')` 或直接接收对象；
2. `validateGameDsl` 通过后调 `compileDslToScenes`；
3. 把 `sceneClasses` + `opts.extraScenes`（Coder 生成的自定义 `Phaser.Scene`）合并到 Phaser 配置；
4. 在 `Phaser.Core.Events.READY` 时启动 `initialKey`。

## 6. 与 Worker 的契约

| Worker 行为 | 文件 | 约定 |
| --- | --- | --- |
| 生成最小骨架 | [`apps/platform-worker/src/workspace.ts`](../../apps/platform-worker/src/workspace.ts) `generateMinimalSkeleton` | 读取 `PLATFORM_RUNTIME_SKELETON_DIR`，把 `skeleton-assets/*` 拷贝进 `projects/{id}/repo` |
| 注入 runtime 版本 | 同上 | 把 `__RUNTIME_SPEC__` 替换为 `PLATFORM_RUNTIME_PACKAGE_SPEC`（如 `file:/opt/og/packages/runtime` 或 npm 版本号） |
| 切回旧模板（应急） | 同上 | 设置 `PLATFORM_PROJECT_SCAFFOLD_MODE=legacy-template` 回退到 `ensureTemplateWorkspace` |
| 自愈构建 | [`apps/platform-worker/src/processJob.ts`](../../apps/platform-worker/src/processJob.ts) `runGenerateFsm` | 每轮 CLI 之后跑 `npm run typecheck && npm run build`，失败把错误日志拼回 Prompt 重试 |

## 7. 兼容性策略

- `RUNTIME_VERSION = '0.1.0'` 锁定到 P0 末。
- P1 末按"3 个标杆 PoC + 10 个生成样本"全绿通过后冻结 `1.0.0`，写入 `runtime_versions` 表（migration `0002`）。
- 之后每个 `1.minor.patch` 都必须：
  - 通过 [`packages/runtime/src/poc.test.ts`](../../packages/runtime/src/poc.test.ts) 与 [`integration-tests/runtime-poc.test.ts`](../../integration-tests/runtime-poc.test.ts)
  - 兼容性矩阵：在 `bench_runs` 表里跑过去 30 天前 50 个用户项目，构建成功率不降低

## 8. 风险与替代方案

- **R: AI 不会用 DSL**：fall-back 是 Coder Agent 直接写自定义 `Phaser.Scene` 并通过 `customModules` 引入；bootstrap 已支持 `extraScenes`。
- **R: SemVer 锁死后修不动**：开放 `runtime_versions.is_default` + 项目级 `projects.runtime_version` 字段（已在 migration 0002 中），允许新建项目使用新版而老项目继续 pin 老版。
- **R: peerDep phaser 版本漂移**：通过 `skeleton-assets/package.json.tpl` 显式锁 phaser 版本，并在 `@opengame/runtime` 的 `package.json#peerDependencies` 中声明严格范围。

## 9. 加戏生成（组合引擎，不是五个成品店）

Runtime 不约束形态。生成层也不该再把提示收进五个互斥 SKU。玩法真相是 **GameIntent → MechanicSpec → 能力组合**，见 [game-generation.md](./game-generation.md)。五个 archetype 只保留为镜头/物理提示。
