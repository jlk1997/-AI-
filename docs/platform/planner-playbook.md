# Planner Playbook

> 这份文档既是 **Planner Agent 系统提示词的人类语义来源**，也是给 OpenGame Core 的 Prompt 工程师维护的「契约」。修改前请同步 [`packages/runtime/src/dsl/schema.ts`](../../packages/runtime/src/dsl/schema.ts) 与 [`packages/runtime/dsl/game.schema.json`](../../packages/runtime/dsl/game.schema.json)。

## 1. 角色定义

Planner 是 `generate` Job 的**第一棒**：它读用户的自然语言、可选图片、`gameParams`，输出：

- `public/game.json`：**唯一可信**的场景描述（DSL，符合 `dslVersion: 1.x`）
- `src/` 下的占位 TS 模块名（若 game.json 用到了 `customModules`），后续由 Coder Agent 填充
- 一份「设计意图说明」，便于 Coder 角色理解非显式约束

## 2. 输出契约

### 2.1 `public/game.json` 必须

1. **dslVersion**：写 `"1.0.0"`，未来由平台升级
2. **meta.title**：≤ 80 字符
3. **meta.canvas**：明确 width/height（建议常用值：480×720 竖屏、960×540 横屏、600×600 方屏），background 为十六进制色
4. **scenes**：**至少 1 个**；每个 scene 必须有 `id` 与 `entities` 数组
5. **scenes[0]** 必须能直接渲染出"可玩雏形"，**禁止** 空场景占位

### 2.2 行为/技能选择

DSL 内置行为通过 [`packages/runtime/src/dsl/loader.ts`](../../packages/runtime/src/dsl/loader.ts) 的 `BEHAVIOR_REGISTRY` 查表（P0 支持 `patrol` / `chase` / `shoot` / `eightWayMovement`）。其他玩法走 `customModules` 自定义 `Phaser.Scene`，**不要** 编造新的 `behaviors[].kind` 让 runtime 在线日志报"unknown behavior kind"。

### 2.3 资产引用

- 只引用本次 Job 已经生成或将由 Coder/Artist 生成的资产 id；不允许悬空 URL。
- 资产由 Artist 角色统一生成，Planner 只声明 `assets[]` 占位，Artist 在 CODE 阶段补 URL。

## 3. 反模式

| 反模式 | 后果 | 正确做法 |
| --- | --- | --- |
| `scenes: []` 或 entities 全空 | QA 阶段直接 FAIL（"scenes must be non-empty / entity 必须能渲染"） | 至少给 1 个可见 sprite |
| 把所有逻辑塞进 game.json | DSL 会臃肿、不可维护 | 只描述结构，复杂逻辑走 `customModules` |
| `customModules: ["src/main.ts"]` | main.ts 已被骨架占用 | 用业务命名：`src/flappy.ts` |
| 输出非 JSON 标准（注释 / 尾逗号） | 校验失败计入 FIX 轮次 | 使用 `JSON.stringify(obj, null, 2)` |
| 输出非 1.x dslVersion | 校验失败 | 写 `"1.0.0"`，下次平台升级会向后兼容 |

## 4. 与 FIX 循环的协作

构建/Schema 校验失败时，worker 把错误尾段拼回 Prompt 让模型自愈。Planner 在 FIX 时应：

1. **先读错误**：错误前缀通常是 `--- typecheck ---` / `--- build ---` / `game.json 校验失败`。
2. **最小修改**：只改导致错误的字段，不要重写整个 game.json。
3. **保留 customModules 名称**：FIX 阶段重命名会让 Coder 阶段的产物落空。

## 5. 示例（最短可玩 PoC）

```jsonc
{
  "dslVersion": "1.0.0",
  "meta": { "title": "Pong", "canvas": { "width": 640, "height": 360, "background": "#000" } },
  "scenes": [
    {
      "id": "main",
      "hud": { "score": true },
      "entities": [
        { "id": "ball", "tags": ["ball"], "sprite": { "shape": "circle", "x": 320, "y": 180, "color": "#fff", "width": 12, "height": 12 } },
        { "id": "p1", "tags": ["paddle"], "sprite": { "shape": "rect", "x": 30, "y": 180, "color": "#fff", "width": 8, "height": 60 } },
        { "id": "p2", "tags": ["paddle"], "sprite": { "shape": "rect", "x": 610, "y": 180, "color": "#fff", "width": 8, "height": 60 } }
      ]
    }
  ],
  "customModules": ["src/pong.ts"]
}
```

`src/pong.ts` 由 Coder 角色后续补全：球速、得分、AI 对手等。

## 6. 引用约束

- Planner 不直接调多模态生成；图片/音乐由 Artist 角色在 ASSET 阶段执行（OpenGame Core 内部），Planner 只描述意图。
- Planner **不** 输出 npm 依赖；依赖由骨架的 `package.json.tpl` 锁定。如果确实需要新依赖，Planner 在 GDD 备注里说明，留给 Coder 决定是否真的加。

## 7. 演进路线

- P1 末：把 Planner 拆出独立子 Agent + 独立 prompt 模板。
- P2：Planner 支持「先输出 N 个候选 game.json，由 QA Agent 短跑构建后选最优」（与"会话分叉 v2"打通）。
