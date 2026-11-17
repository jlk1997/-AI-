# 巷议生成：独有镇子 + 真对白 + 判断

> 加戏侧已经成熟：提示 → GameIntent → MechanicSpec → 能力组合 → 门禁验点名循环。  
> 世界侧对齐同一条路：提示 → **IntentIR** → **这份提示独有的 World Spec** → 种子门禁验真对白 → 活着的 MemoryStream。

观测者应能说出三句，并且这三句由门禁与运行时强制，不是文案：

1. **这是我写下的镇子** — 点名的人/地/职出现在 Spec 上；垫人标 `padded`，对作者可见。
2. **他们在过日子** — 种子与直播开口是真对白；耳语 / 巷议 / 认养写进同一条记忆流，下次开口能检索到。
3. **他们有判断** — 立场卡 + 心智理论（已告知 / 不说）+ 两人相反事实必须承认分歧，不得静默覆盖。

## 1. 流水线（和加戏 planner 对等）

```
prompt
  → IntentIR           (@opengame/world-planner parseIntentFromPrompt)
  → 独有 World Spec    (synthesizeSocietyWorld；禁止塌回 town_square)
  → ensureWorldDepth   (补人数/场所，不换斯坦福脚手架)
  → fulfillSocietyPromises  (场所 → 职业 → 点名居民 → 缺的立场卡)
  → 内容门禁           (点名人/地、regionId 是真地图区、authored/padded 计数)
  → 社会种子           (默认 16h 中国日；真对白 + 扩散 + 引用记忆)
  → 直播 MemoryStream  (embed 默认相关度；哈希袋只在未配置 embed 时，并标检索降级)
```

FIX 社会 Job 只许补居民 / 绑场所 / 写身份，不许为过门禁去加战斗任务。

## 2. 设计判断（为什么不是再加一套模板）

剩下的工作不是「第 6 个世界模板」，而是把上面三句做成**可失败的契约**：

| 访客感觉 | 强制点 | 明确不是 |
|----------|--------|----------|
| 独有出生 | IntentIR.residents + 门禁「点名居民未出现」；authored 不被 pool 改名 | 斯坦福小镇默认、词表里挑一个镇 |
| 真的在说话 | 种子 `dialogues === 0` 硬失败；今晚 feed 只收开口句 | 启发式装真对白、擦肩而过当对白 |
| 有判断 | 立场卡（secret/stance/withhold）+ ToM + 跨人 factKey 分歧 + 种子末反思 | 更长的 system prompt、L2 神经当人格 |

卖的是时间与影响（巷议、认养），不卖生成。居民是合成的，不爬真人。

## 3. 意图 → 独有 Spec

- 左侧创建简报（pack / 场所 / 规模 / 节奏 / **作者日子 note**）写入 `gameParams.worldBrief` 并合成提示词。人名和一句巷议是一等输入；药丸只是合同。空发送、引导「按简报生成」、onboarding 一键世界一律 `composeWorldGeneratePrompt`，禁止默认 `pickDemoTownPrompt`。底部模板只填简报，不抽演示种子。IntentIR 以简报 pack 与场所为准，note / 提示词补人名。简报盖进 `presentation.worldBrief`：种子谣言按 useCase / 场所开口，生成条露出合同与 note，垫人职业跟落地场所走。
- `parseIntentFromPrompt` 抽出场所、职业、**点名居民**、人数、pack。
- `synthesizeSocietyWorld` 先落下点名人（`authored`），人数不够才用目录垫人（`padded`），禁止用 pool 名覆盖作者写下的名字。
- `stampPromisedOccupations` 不得为了满足场所暗示的职称去改写点名人的职业。
- 每个 NPC 必须有立场卡。启发式合成已带卡；LLM Spec 与 `ensureWorldDepth` 垫人由 `stampMissingStanceCards` 补齐。

## 4. 和加戏隔离

巷议规划器 **不得改 MechanicSpec / BoardTurnScene / `legacy-template`**。`@opengame/world-planner` 只发明镇子；`@opengame/game-planner` 只发明玩法。

- 世界 Job 不写 `.opengame-mechanic.json`，不播种街机 Scene
- 游戏 Job 不调用 `ensureWorldDepth` / `synthesizeSocietyWorld` / 社会种子
- 双模项目可以共用美术锚点，生成互不覆盖
- 世界侧 LLM 不得 import game-planner 的循环 ops

加戏侧对照：[`game-generation.md`](./game-generation.md)。

## 5. 诚实边界

能承诺：一份提示对应一座可观察的镇子；点名的人出现；开口引用同一条记忆流；付费巷议 / 认养留下可检索痕迹。

不承诺：斯坦福论文默认 25 人小镇、L2 神经当人格、一次生成 3D / 联网同步、把「生成」本身当商品。那些不是 runtime 的活，也不该靠加模板假装通用。

L3 海报必须诚实：空脑子不能用漂亮空镜瞒过去。

## 6. 门禁：验承诺，不验像不像 Demo

- **点名居民 / 场所 / 职业是超越基线的主检查。** 词表未收录的人名与词表职业可以同时存在。简报点名场所未出现记 `点名场所未出现`；简报 pack 与合成结果或场所家族冲突则失败。
- NPC `regionId` 与日程 `regionId` 必须是 `space.regions` 里的真区域，禁止场所 id（如 `forge`）冒充区，否则精灵从地图上消失。
- 作者可见：观测台花名册标垫人；生成条显示「N 名写明 · M 名目录补齐」并列出点名/垫人姓名。规划器世界缺立场卡（secret/stance）过不了门禁。
- 社会种子：`dialogues === 0` 失败；扩散低于 pack `minSpread` 失败（不等 24h 窗）；评判「不引用记忆且不接上一句」失败。`PLATFORM_SOCIETY_SEED_SOFT=1` 才黄灯放行。
- 无密钥却要求真模型：`SocietyLlmKeysExhaustedError`，禁止启发式装真对白。

## 7. 活着的记忆（W2 / W3）

- 社会 tick **配置了 embed 就传入**，模板降级路径也用真向量检索；未配置才哈希袋，观测台标「检索降级」。
- 耳语 / 巷议 / 认养写入后，下一次该人开口的 `retrieveMemories` 必须能命中；命中失败压低 `dialogueQuality.citesMemory`。
- `citedMemoryIds` 参与评判：指针在流里则记引用。
- 两人持相反 `factKey`（同一话题、不同事实）时，对白与访谈必须承认分歧。
- 同日再问同一句访谈：拒绝原句复读（「我今天已经答过了，换个问法。」）。
- 默认种子 16 小时（中国日），上限 48；不再用 6h/12h 天花板假装一天过完。
- **付费痕迹更重：** 巷议 / 认养 / 夜市 importance 可到 13–16（日常记忆仍 ≤10）。哈希袋只在未配置 embed 时用。
- **付费改关系图：** 巷议 / 认养除 MemoryStream 外，还盖 `resident|visitor` 边（`rumor` / `adopted`）；问「认养」时检索加权，认养后降阈值反思。不得只靠「答应」正则猜边。
- **访谈钉定付费记忆：** 工作集用 `layeredTalkMemories`，耳语/巷议/认养必进 cited；问认养必引 【认养】；同日再问拒绝复读。
- **降级也对分歧负责：** 没有模型时，两人相反 `factKey` 必须说「两派说法」，不得各背各的当没听见。
- **规划器 `world-memory` 只给生成 / 编辑 prompt。** 直播大脑只有 MemoryStream。

## 8. 以后怎么加能力

缺哪类镇子、门禁反复修不好，再加 **可 import 的 pack / 场所词**，永不加「成品斯坦福工程」，不加第 6 个游戏 archetype 桶：

1. 在 genre pack 里只放人数区间 + 场所/职业词
2. IntentIR 在用户点名时挂上
3. 合成出独有 region id，不复用 `town_square`
4. 门禁验点名，不验像不像 Smallville

## 9. 实现入口

- 规划器：[`packages/world-planner`](../../packages/world-planner)
- 社会智能：[`packages/world-agents`](../../packages/world-agents)
- 流水线：[`apps/platform-worker/src/worldPipeline.ts`](../../apps/platform-worker/src/worldPipeline.ts)
- 种子：[`apps/platform-worker/src/societyRunner.ts`](../../apps/platform-worker/src/societyRunner.ts)
- 直播：[`apps/platform-api/src/lib/societyLive.ts`](../../apps/platform-api/src/lib/societyLive.ts)
- 内容门禁：[`apps/platform-worker/src/worldQualityGate.ts`](../../apps/platform-worker/src/worldQualityGate.ts)
- 回归提示：[`quality-eval-set.md`](./quality-eval-set.md) Society world prompts
- 游戏侧隔离：[`game-generation.md`](./game-generation.md)

## 10. 这一轮还补上的设计判断

W0–W4 落地后，访客仍可能感到「付了钱但铁匠不当回事」「问最近有什么事却不提巷议」「没模型时两人各说各的」。根因不是缺模板，而是契约还有四条没钉死：

1. **重要度被夹死在 10** — 夜市 14 与普通谣言一样热，认养看起来像文案。
2. **访谈只按问题关键词检索** — 「最近怎么样」打不中耳语前缀，G7 在产品里假绿。
3. **LLM 掉线就不承认分歧** — 立场卡只写进了模型 prompt。
4. **作者只看见人数** — 不知道谁是垫的；规划器记忆袋若漏进直播，会变成第二套脑子。

对应强制：importance 1–16 + 检索加分；访谈钉定付费痕迹；模板路径 `utterDisagree`；生成条列名；`world-memory` 注释为 generate-only。

再下一刀（已落地）：

5. **立场要管嘴** — `闲话不传给外人` 对无关系者不传谣，不只写在 prompt 里。
6. **付了钱必须留下痕迹** — 巷议 / 认养 / 沙盘先写入 MemoryStream **和** `resident|visitor` 关系边再开口；镇子忙也 `stampPaidSocietyTrace`。
7. **生成向导默认中国日** — `full_day = 16h`，不再默认 6h 上午。
8. **G7 离线烟** — `npm run quality:society-promises` 验点名、耳语访谈、同日不复读、外人立场。
9. **种子契约不被直播冲掉** — 涌现卡 upsert 合并 `seed`；生成条与观测台读同一份 `societySeed`。

## 11. 状态同步（生成条 = 观测台 = 记忆流）

作者生成完立刻应看见种子契约，不必先打开观测台；直播 tick 不得把契约冲掉。

| 表面 | 强制 |
|------|------|
| 生成条 `WorldReadyStrip` | `GET /world` 带 `societySeed`（涌现报告优先，Job 结果补洞）+ 点名/垫人名单 + 简报合同（场景 / 场所） |
| 观测台无世界 | `hasWorld` 为假且无预览/事件时锁定侧栏；不发起 EventSource / heartbeat / 浏览器 tick |
| 观测台第一帧 | `reloadSociety` 拉 `/society/report`；SSE coalesce 保留 `report.seed`、`retrievalDegraded`、`dialogueKind` |
| 直播涌现卡 | `persistEmergenceReport` **合并**旧 `seed`，禁止 16h/真对白被下一 tick 抹成空 |
| 记忆检查器 | 耳语 / 巷议 / 认养徽章 +「付费痕迹」滤镜；访谈引用高亮付费记忆 |
| 居民卡 | Spec 立场卡（stance / secret）写进 `identityJson` 并在 GET agent 合并显示 |
| 付费后刷新 | 耳语 / 访谈后 `loadAgent` + 安静 reload，iframe append 同一条 intervene |

付费痕迹：同一小时同一正文用稳定 id upsert，禁止重试叠两条。镇子锁忙时 `stampPaidSocietyTrace` 仍直接写 MemoryStream + `resident|visitor` 关系边 + 事件，不要求再走一轮 talk。

## 12. 永不

- 恢复 `legacy-template` 整盘拷贝
- 第 6 个游戏 archetype 桶
- 斯坦福小镇当默认产品
- 卖生成；L2 神经当人格
- 爬取真人当居民
- 世界 Job 写 MechanicSpec / BoardTurnScene
