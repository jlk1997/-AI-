# 加戏生成：玩法规格 + 能力组合

> 世界侧已经成熟：提示 → 意图 → **合成一份这个世界独有的 Spec** → 底座只负责舞台。  
> 游戏侧对齐同一条路：提示 → **GameIntent** → **MechanicSpec** → 组合可 import 能力 → Coder 填 `loops[]` → 门禁验点名承诺。

五个 archetype（`platformer` / `top_down` / `grid_logic` / `tower_defense` / `ui_heavy`）**只是镜头/物理提示**，不是产品 SKU，不决定垫哪套 Scene、发哪些包。

## 1. 流水线（和世界 planner 对等）

```
prompt + 访谈
  → GameIntent          (@opengame/game-planner)
  → MechanicSpec        (synthesize；可重叠，禁止五选一)
  → ensureGameDepth     (瘦循环补信号，不换载体)
  → GDD                 (说明书；LLM 收到 MechanicSpec 作为 config_summary)
  → 播种                (最小载体 + modules[] 依赖)
  → ensureBoundCapabilities  (缺的能力 Scene 合并进 extraScenes，不删世界)
  → Coder 实现 loops[]
  → 门禁 / 冒烟         (验承诺，不验像不像 Demo)
```

迭代：

```
已有 MechanicSpec
  → inferGameOpsFromPrompt   (add_loop / bind_module / add_scene)
  → optional LLM refine      (sanitize；heuristic 是地板)
  → applyGameOps             (只改规格)
  → ensureGameDepth
  → ensureBoundCapabilities
  → Coder 补循环
```

用户说 **重做 / 整盘重来 / 推倒重来** 才允许 `retarget_space` / `retarget_time`。跟进一句「加上钓鱼」不得把象棋合成成横版。迭代时 **GameIntent 与 MechanicSpec 都合并**，不拿跟进提示整份覆盖。

`ensureGameDepth` 会按点名循环补齐 `modules[]`（有钓鱼就绑 systems，有象棋就绑 board），并按模块补 `extraScenes`（`BoardTurnScene` / `Match3Scene` / `CardsHandScene` / `EmitterScene`），但不改 space/time，也不换成贪吃蛇。

## 2. MechanicSpec 字段

可组合，可重叠：

| 字段 | 含义 |
| --- | --- |
| `space` | side / top_down / grid / ui / path |
| `time` | realtime / turn / step / wave |
| `input` | keys / pointer / cell-select / place / choice |
| `win` | score / flag / checkmate / quest / survive / custom |
| `loops[]` | 用户点名的循环 + 验收信号 |
| `modules[]` | platform / dialogue / combat / td / world / systems / board / match / cards / emitter |
| `extraScenes[]` | 绑定能力要注册的 Scene，Coder 必须 merge，不得整盘改写 main |

对照：

- 中国象棋 = grid + turn + cell-select + checkmate + `module-board`
- 俯视探索 + 象棋 + 对话 = **top_down 舞台** + `world` + `board` + `dialogue` + `BoardTurnScene`（混合，不是互斥桶）
- 俯视探索 + 消消乐 = **top_down 舞台** + `match` + `Match3Scene`
- 消消乐独占 = grid + `Match3Rules` + `Match3Scene`（能力表，不是消消乐工程，禁止 SPACE 壳）
- 钓鱼 RPG = top_down + fishing loop + `module-systems`

## 3. 能力目录（加厚，不加成品店）

缺哪类循环、门禁反复修不好，再加 **可 import 模块**，永不加「成品游戏工程」，不加第 6 个 archetype 桶。

已有：dialogue / combat / td / world / systems / platform / board  
按证据加厚：`Match3Rules`（module-board）、`@opengame/module-cards`、`@opengame/module-emitter`

绑定 Scene（能力演出，不是 SKU）：

| 模块 | Scene | 规则包 |
| --- | --- | --- |
| board | BoardTurnScene | `@opengame/module-board` |
| match | Match3Scene | `Match3Rules` |
| cards | CardsHandScene | `@opengame/module-cards` |
| emitter | EmitterScene | `@opengame/module-emitter` |

## 4. 和巷议隔离

巷议侧 SSOT：[`world-generation.md`](./world-generation.md)。

加戏规划器 **不得改世界 Spec / WorldOps / 社会深度**。`@opengame/game-planner` 只发明玩法；`@opengame/world-planner` 只发明镇子。双模项目可以共用美术锚点，但生成互不覆盖：

- 游戏 Job 不调用 `ensureWorldDepth` / `synthesizeSocietyWorld`
- 世界 Job 不写 `.opengame-mechanic.json`，不播种 `BoardTurnScene` / `Match3Scene`
- `ensureBoundCapabilities` 合并 extraScenes 时禁止删 World/Title，以免把已编译的世界舞台换成街机壳
- 游戏侧 LLM GameOps **不得** import world-planner chat

## 5. 诚实边界

能承诺：任意 2D H5 循环，只要能拆成空间 + 时间 + 输入 + 胜负 + 点名机制。

不承诺一次生成：3D、联网同步对战、3A 数值、残局库级 AI。那些不是 runtime 的活，也不该靠加模板假装通用。

## 6. 门禁：验承诺，不验桶

- **点名循环是超越基线的主检查。** 词表未收录的循环（赶海）与词表循环（象棋）可以同时存在；词表不再把自定义承诺挤掉。
- 自定义 loop 必须出现用户写下的词，**不能只靠 `registry.won` 冒充**。
- 混合探索+棋盘：`registry.won` 在 `BoardTurnScene` 上就算胜负信号，不必再为了过门禁去删世界、改成 Victory 空跳。
- 冒烟按 `space/time/input` 选探针：纯棋盘点选、塔防放置、混合探索用键盘、三消点格。禁止一种空格探针打天下。

## 7. 以后怎么加能力（配方）

缺哪类循环、门禁反复修不好，再加 **可 import 模块**，永不加「成品游戏工程」，不加第 6 个 archetype 桶：

1. 在能力包里只放状态 + 规则函数（像 `module-td` / `Match3Rules`）
2. 把模块 id 写进 `MechanicModule` + `CAPABILITY_ENTRIES` + `MODULE_CAPABILITY_SCENES` + `moduleSpecsForModules`
3. 规划器 `seedLoops` / GameOps `bind_module` 在用户点名时挂上
4. `ensureBoundCapabilities` 只合并 extraScenes，不拷一整盘模板

## 8. 长期阶段（加戏组合引擎）

已落地：

| 阶段 | 内容 |
| --- | --- |
| P0 | `@opengame/game-planner`：GameIntent / MechanicSpec / GameOps / ensureGameDepth |
| P1 | 首轮合成规格；迭代只合并，禁止跟进提示整份覆盖 |
| P2 | 混合探索 + 棋盘：top_down 舞台 + BoardTurnScene |
| P3 | 点名循环门禁；自定义循环不能靠 `registry.won` |
| P4 | Match3 / cards / emitter 能力包 |
| P5 | 托管 GDD：默认不加载 `template_api.md` / `LevelManager` 拷贝词。`PLATFORM_GDD_LEGACY_DOCS=1` 才回旧文档 |
| P6 | 能力 Scene 绑定：Match3Scene / CardsHandScene / EmitterScene；独占消消乐不再落 SPACE 壳 |
| P9 | 加戏总线：`installJiaxiBus` 把付费卡折进 registry；棋盘 / 三消 / 手牌 / 弹幕 / 蛇 / 塔防 / 探索核消费旗。付费跟 loops，不卖生成。本局套票一口价；同局中国日加码 1.5× |

进行中 / 下一刀：

| 阶段 | 内容 |
| --- | --- |
| P7 | LLM GameOps：heuristic 是地板，LLM 只许 `add_loop` / `bind_module` / `add_scene`（重做才 retarget）。`PLATFORM_SKIP_GDD_LLM` 或 `PLATFORM_GAME_OPS_LLM=0` 关掉。sanitize 丢非法 op |
| P8 | 新模块只凭门禁证据加（puzzle grid / 合成 / 钓鱼专用表）。仍然不加第 6 桶、不加 50 个成品模板 |
| P10 | 周课题按点名循环出题；作者今晚按卡看销量。仍然不卖生成、不加第 6 桶 |
| 永不 | 恢复 `legacy-template` 整盘拷贝；残局库 AI；联网同步；3D；把「重做整盘」做成付费项 |

## 9. 实现入口

- 规划器：[`packages/game-planner`](../../packages/game-planner)
- 流水线：[`apps/platform-worker/src/generationPipeline.ts`](../../apps/platform-worker/src/generationPipeline.ts)
- 绑定能力：[`apps/platform-worker/src/boundCapabilities.ts`](../../apps/platform-worker/src/boundCapabilities.ts)
- 托管 GDD：[`packages/core/src/tools/hostedGddContract.ts`](../../packages/core/src/tools/hostedGddContract.ts)
- 棋盘规则：[`packages/module-board`](../../packages/module-board)
- 手牌 / 弹幕：[`packages/module-cards`](../../packages/module-cards) / [`packages/module-emitter`](../../packages/module-emitter)
- 游戏侧付费（加戏卡跟 loops，不卖生成）：[`game-commerce.md`](./game-commerce.md)
