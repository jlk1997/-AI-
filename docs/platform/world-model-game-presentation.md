# World Model × Game Presentation

世界模型是内核；**游戏是主表现**。

```
World Spec (SSOT)
    ↓ WorldGameEngine (in presenter)
Title → Explore → (Battle) → Ending
    ↑ quests / inventory / portals / combat / win-lose
```

## 玩家闭环（默认小镇）

1. **Title** — ENTER 开始  
2. **Explore** — 方向键移动；黄块矿石 **F** 拾取；找铁匠 **E** 对话接任务  
3. **Portal** — 走到青色传送门进入森林  
4. **Combat** — 靠近红敌 **C** 进入回合战斗  
5. **Victory** — 完成「取矿」任务（对话铁匠 + 持有 iron_ore）  

控制：`←→↑↓` 移动 · `E` 对话 · `F` 拾取 · `C` 战斗 · `T` 推进时间 · `Q` 任务日志  

## 关键文件

| 文件 | 职责 |
|------|------|
| `scaffold/src/engine/WorldGameEngine.ts` | 浏览器内 Spec 执行器（规则/任务/背包） |
| `scaffold/src/scenes/*` | Title / Explore / Battle / Ending |
| `public/world.json` | 世界真相 |
| `public/gameplay.json` | 可玩性清单（UI / 门禁） |

Spec 仍是世界模型；Phaser 场景**不写死剧情**，只呈现 Engine 状态。
