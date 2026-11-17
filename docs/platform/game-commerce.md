# 加戏付费：跟 MechanicSpec 卖局内戏剧

> 本文只写 **游戏轨（加戏）**。世界轨只卖下注，正文是 [world-betting.md](./world-betting.md)；社区世界访客页不再挂镇时 / 点亮 / 认养 / 付费巷议。  
> 生成仍然不是商品。游戏访客买的是**这一局点名循环上的一张卡**，或一口价的**本局套票**。

组合引擎落地之后，四张万能卡（加难 / 反重力 / 反水 / 双倍分）已经对不上真实玩法：象棋不该卖反重力，消消乐不该卖 NPC 反水。付费必须跟 `MechanicSpec.loops[]` / `modules[]` 走。

## 1. 原则

| 卖 | 不卖 |
| --- | --- |
| 局内戏剧（点名卡 / 本局套票） | 再编译一次 / 再生成一次 / 重做整盘 |
| 作者 70% 分成 | 模板 SKU、第 6 个 archetype 桶 |
| 首张半价（拉新，含套票第一次结账） | 把巷议点数花进加戏 |
| 同局中国日加码 1.5× | 拆两次结账再叠两次税 |

## 2. 卡组怎么来

`jiaxiDeckForMechanic(spec)`（`@opengame/game-planner`）：

| 条件 | 卡 | 标价 |
| --- | --- | --- |
| 每局游戏 | 加难 | 8 |
| 侧视 / 蛇 / 飞鸟 | 反重力 | 10 |
| 街机分 | 双倍分 | 8 |
| 对话 / 世界舞台 | 反水 | 8 |
| 棋盘 | 让子 / 多走一步 | 10 / 12 |
| 三消 | 再换一次 | 8 |
| 手牌 | 多抽一张 | 8 |
| 弹幕 | 更密弹幕 | 10 |
| 钓鱼 / 商店 | 好运抛竿 / 好市 | 8 |
| 塔防 | 提前一波 | 10 |
| 自定义循环（赶海） | 加码该词 | 12 |
| 巷议作品 | 空卡组 | — |

作者 `jiaxiCost` 是倍率（默认 8 = 1×）。发布时把 MechanicSpec 写入 `community_games.mechanic_json`；工作区也会落 `public/JIAXI.json` 给 Scene 读。访客看到的卡价已经乘过倍率。

**点名卡**：`featuredJiaxiCard` 优先卖对口循环（多走一步 / 再换一次 / 多抽 / 更密 / 好运 / 提前一波），不是万能加难。

## 3. 三层报价（加戏轨）

```
list = scale(card.points, authorJiaxiCost)
if firstJiaxiCheckout: pay = floor(list × 0.5)     // 拉新；无视叠卡
else if sameGame ChinaDay stack ≥ 1: pay = round(list × 1.5)
else: pay = list
```

| 层 | 谁点 | 计税 |
| --- | --- | --- |
| 点名卡 | AfterPlay 主按钮 | 单卡 list，再套半价 / 加码 |
| 卡组 | 作品页 KaiActions | 每张单独结账；第二张起加码 |
| 本局套票 | AfterPlay 次按钮 + KaiActions 主按钮 | 点名卡 + 加难的 **list 之和**，只套 **一次** 半价或加码 |

套票是一口价，不是两张连买。象棋例：多走一步 12 + 加难 8 = 20；回头客同日再买套票付 30，而不是先 12 再 12。新客第一次结账（单卡或套票）都半价。

时钟一律 **中国日（UTC+8）**，不用宿主本地午夜。

作者分成仍是实付的 70%。`bag.jiaxiByCard` 按卡拆今晚销量（套票每张卡各计 1）。

## 4. 局内证据

付费成功后宿主 `postMessage({ type: 'opengame:jiaxi', cardId, effect, label, loopId })`。runtime `installJiaxiBus` 折进 `game.registry`，内核消费，不只亮横幅：

| 旗 | 谁吃 |
| --- | --- |
| `jiaxiBoardHandicap` / `jiaxiBoardExtraMove` | BoardTurnScene 让子 / 连走（含五子落子） |
| `jiaxiMatchExtraSwap` | Match3Scene 允许一次无三连交换 |
| `jiaxiCardsExtraDraw` | CardsHandScene 多抽 |
| `jiaxiEmitterDenser` | EmitterScene 更密弹幕 |
| `jiaxiScoreMul` / `jiaxiGravityFlip` / `jiaxiHarder` | 蛇等街机核 |
| `jiaxiTdEarlyWave` | 塔防核提前一波 |
| `jiaxiSystemsLucky` / `jiaxiNpcBetray` / `jiaxiLoopSpice` | 俯视探索：好运入袋 / 声望反水 / 加码词 |

自定义循环没有专用核时，至少进 registry + 横幅；不得假装卖了生成。

## 5. 落地入口

- 规划器卡组 / 折旗 / 报价：`packages/game-planner/src/jiaxiDeck.ts`、`jiaxiApply.ts`
- 发布快照 / 访客报价：`apps/platform-api/src/lib/commerce.ts`、`kaiMarket.ts`
- 扣点：`POST /community/games/:id/jiaxi`（`cardId` 或 `{ bundle: "run" }`；卡必须在该局卡组里）
- 宿主演出：`opengame:jiaxi` postMessage + `JiaxiBanner` + Scene registry
- 周课题奖池继续走加戏轨

## 6. 下一刀（仍不卖生成）

- 周课题按点名循环出题，奖池仍走加戏轨
- 作者工作室按卡看今晚哪张在卖（`jiaxiByCard` 已入 tonight）
- 不要把「重做整盘」做成付费项
- 不要把巷议包花进加戏
