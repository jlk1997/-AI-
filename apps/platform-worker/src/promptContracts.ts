/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { artStyleProfile, isArtStyleId } from '@opengame/world-spec';

import type { WorkspaceGameSummary } from './workspaceContext.js';
import { formatConversationForPrompt, type ConversationTurn } from './conversationHistory.js';

export const CAPABILITY_CATALOG = `
【可直接调用的能力库 / Capability catalog】
- **五个 archetype 只是镜头/物理提示**（有无重力、侧视/俯视、连续移动/格子），不是成品 SKU，不决定垫哪套 Scene、发哪些包。
- **玩法规格 MechanicSpec 才是真相**：实现 \`loops[]\`，按 \`modules[]\` import 能力。一个提示可以同时要俯视探索 + 回合棋盘 + 对话。
- **复杂游戏（RPG/回合/探索/塔防/棋类）**：必须用 \`src/scenes/*Scene.ts\` + \`bootstrap({ extraScenes })\`；可 import \`@opengame/module-dialogue\`、\`@opengame/module-combat\`、\`@opengame/module-world\`、\`@opengame/module-td\`、\`@opengame/module-systems\`、\`@opengame/module-board\`、\`@opengame/module-cards\`、\`@opengame/module-emitter\`
- **棋类**：import \`@opengame/module-board\` 的 \`rulesForBoardKind\` / \`legalMoves\` / \`applyMove\` / \`winner\`。Scene 只演出。禁止用 SPACE 加分壳或横版跳跃冒充象棋。
- **三消 / 手牌 / 弹幕**：\`Match3Rules\` / \`module-cards\` / \`module-emitter\` 是可 import 能力，不是成品模板。一个提示可以同时要俯视探索 + 回合棋盘 + 对话。
- **简单街机（snake/2048/flappy）**：可用 game.json DSL + behaviors/skills；棋类不准走这条。
- Behaviors（仅 DSL 轻量游戏）：patrol、chase、eightWayMovement、velocity、bounds、dialog（lines 数组）
- Skills：SkillChain + 根级 skills[] 定义（棋类胜负看 Scene \`registry.won\`，不认死 \`skills.winAt\`）
- Services：SaveStore、Leaderboard、Analytics
- **禁止**在 game.json 写 runtime 未实现的字段：gameFlow、sceneConfig、spawners、entities_templates、scene.rules 对象`;

export const GAME_JSON_DSL_SHAPE = `

【game.json 运行时格式（必须遵守，否则预览黑屏）/ DSL shape】
- \`assets[]\`：\`{ "id": "hero", "kind": "image", "url": "./assets/hero.png" }\`（**png/webp**，禁止 .svg）
- \`entities[]\`（轻量游戏）：\`behaviors\` **必须是数组** \`[{ "kind": "eightWayMovement", "options": {...} }]\`
- \`dialogue[]\`（根级）：对话行数组，配合 DialogueRunner 或 module-dialogue
- **禁止**：gameFlow、spawners、entities_templates、scene 内复杂 rules 对象（runtime 不执行）`;

export const ENGINE_SCENE_CONTRACT = `

【引擎模式 / Engine mode — RPG·动作·塔防等复杂游戏】
- **必须**在 \`src/scenes/\` 实现多个 Phaser.Scene（Title、Chapter/Level、Battle、Ending 等）
- **必须**在 \`src/main.ts\`：\`await bootstrap({ source: './game.json', extraScenes: [TitleScene, BattleScene, ...] })\`
- \`public/game.json\` 只负责：meta、assets、audioTracks、tunables、initialSceneId、scenes[].customModule 元数据
- 回合战斗：import { TurnManager } from '@opengame/module-combat'
- 剧情对话：import { DialogueManager } from '@opengame/module-dialogue' 或 runtime DialogueRunner
- 每个 Scene 须有明确 **胜负/结束** 与 \`this.scene.start('NextSceneKey')\` 跳转
- GDD 中的 Scene 清单必须全部实现并注册`;

export const PHASER_TYPESCRIPT_CONTRACT = `

【Phaser 3.90 + TypeScript 硬性约定 / Phaser TS (避免 TS2554 等)】
- \`Graphics.lineStyle(lineWidth, color, alpha?)\`：**至少 2 个参数**（线宽、颜色）。禁止写成 \`lineStyle(0xff0000)\` 只传颜色，否则会报 “Expected 2–4 arguments, but got 1”。
- \`Graphics.fillStyle(color, alpha?)\`：纯色填充用这个；\`fillGradientStyle\` 必须一次传入 **四角 4 个颜色**（+ 可选 4 个 alpha），不能只传 1 个颜色。
- \`Graphics.lineGradientStyle(lineWidth, tl, tr, bl, br, alpha?)\`：至少需要 **线宽 + 4 个颜色**。
- \`Phaser.GameObjects.Container\` **没有** \`setTint\` / \`clearTint\`；请用 Image/Sprite、对子节点着色，或叠一层半透明 Graphics（\`fillStyle(color,1)\` + \`fillRect\`）。
- 文本请用 \`this.add.text\`；**Graphics 没有** \`fillText\`。
- \`Phaser.Math.RND.pick(arr)\` / \`Phaser.Utils.Array.GetRandom\`：**arr 必须非空**；若可能为空先 \`if (!arr?.length) return;\`，否则运行时报 \`Cannot read properties of null (reading 'pick')\` 或等价错误。
- 仅作类型使用的导入写 \`import type { Foo } from '...'\`，避免 \`verbatimModuleSyntax\` 报错。`;

export const PLATFORM_HOSTED_CONTRACT = `

【平台托管环境 / Hosted platform】
- **不要**调用 \`run_shell_command\` 执行 \`npm run build\`、\`npm run typecheck\`、\`npm test\` 等；平台 Worker 会在你改完代码后**自动**运行 typecheck + vite build + 内容门禁。
- 你只需修改 \`src/\`、\`public/game.json\` 等源文件；若构建/类型检查失败，下一轮 FIX 提示会附上错误摘要。
- 剧情/RPG 迭代：保留已有 Scene 与 scene id；扩展 src/scenes/*.ts 与根级 dialogue[]，**不要**写 gameFlow/spawners 等未实现 JSON 字段。`;

const PLAYABILITY_BASE_LINES = [
  "- GameOver/Victory **重开**：优先 `scene.start('TitleScene')`（软回标题）并重置 registry；可用 `location.reload` 作备用。必须用 **keyup** 或显式按钮（禁止整屏 pointerdown/keydown 连发开下一关）。",
  '- Title **禁止**整画布 pointerup 开始（用户点预览框抢焦点会误开局 → 秒死 → 永远看不到标题）。必须用显式 Start 按钮或 keyup SPACE。',
  '- **禁止** GameOver 按 R 后黑屏再立刻回到 GameOver（常见因：keydown 连发 → Title 立刻开局再秒死回 GameOver）。',
  "- `vite.config.ts` 必须 `base: './'`，否则嵌套 preview-dist 路径下 `/assets/` 会加载错包。",
  '- `public/game.json`：`initialSceneId` 必须是 Title/玩法 customModule，禁止只留 DSL `main` 紫块占位。',
  '- 暂停菜单 R：应回到 Title 或硬重载，不要 `scene.restart()` 一个已半死的 Level。',
  '- **禁止假按钮**：带描边底框的 HUD 控件（难度/START/RETRY/MODE）必须 `setInteractive`；否则只用纯文字标签（无 rectangle 描边底）。',
  '- **美术 key**：Scene 用 `og_player`/`og_enemy`/`og_item`/`og_bg` 时，须保证 Boot/preload 有别名，或 `create` 调用 `PlatformSceneHelper.ensureGameArtAliases`，或一律用 bare `player`/`enemy`/`item`/`background`。preload 见 bare key 已存在时 **不要**整段跳过而不补别名。',
  '- **美术 matte**：`background`/`og_bg` 保持不透明场景；`player`/`enemy`/`item`/`player_run` 必须是透明精灵（平台种子已自动抠图）。禁止把背景图当角色贴图。',
  '- **多动作/朝向**：跑动用 `player_run`/`og_player_run`（或 `PlatformSceneHelper.applyPlayerPose`）；左右朝向用 `setFlipX`，不要为左向单独生成图。',
  '- 难度芯片若做成控件：必须可点切换 Easy/Normal（写入 registry/`enemySpeedMul`），禁止装饰成按钮却不可点。',
] as const;

const PLAYABILITY_ARCHETYPE_LINES: Record<string, readonly string[]> = {
  platformer: [
    '- 平台跳跃：坠落虚空/受伤须 **先设无敌再扣命**；重生用 `body.reset(x,y)`（禁止只改 sprite.y）；开局 ≥1.5s 出生无敌。',
  ],
};

function playabilityContract(archetype?: string | null): string {
  const extra = archetype
    ? (PLAYABILITY_ARCHETYPE_LINES[archetype] ?? [])
    : allArchetypeLines(PLAYABILITY_ARCHETYPE_LINES);
  return `

【可玩性硬契约 / Playability — 用户只对话不改代码，必须一次可玩】
${[...PLAYABILITY_BASE_LINES.slice(0, 3), ...extra, ...PLAYABILITY_BASE_LINES.slice(3)].join('\n')}`;
}

export const PLAYABILITY_CONTRACT = playabilityContract();

const KERNEL_BASE_LINES = [
  '- 平台注入的 Title/Chapter/Battle/World **脚手架只是播放器**：真正玩法/关卡/剧情必须来自 `public/STORY_BIBLE.json`、`public/CONTENT_GRAPH.json`、`public/story/*.json`、GDD 与用户访谈 brief。',
  '- **禁止**只改 Title 文案或少数字符串就冒充新游戏；必须替换关卡内容、对话图、胜负条件或实体布局。',
  '- Scene 代码职责：加载 JSON/Spec → 演出（移动/对话 UI/战斗）→ 写 registry flag / 跳转；**不要**在 Scene 里硬编码整章剧情台词。',
  '- 美术：叙事槽写入 `ASSET_BRIEF.storyboard`（npc_* / bg_chapter_* / bg_region_* / regionBgmPlan）；禁止只改 Title 文案冒充新画风。',
  '- UI：优先 `GameUiKit`（`@opengame/module-platform`）对话框/HUD/标题条；**禁止**满屏裸 `add.text` 无 wordWrap / 无底栏面板。',
  '- **中文可读硬规则**：标题用 `addTitleStrip`（自带 padding/自适应高度）；底栏用 `addDialoguePanel`（**禁止**再给 body 加 `fixedHeight`，会裁切汉字底部；面板须不透明以免背景水印透字）；Skip/暂停用 `addChromeButton`（防点穿 + 防裁切）。禁止自造 `rectangle(..., 32)` 套中文。',
  '- **选项可点硬规则**：凡 `new ChoicePanel` + `DialogueManager`，必须 `choices.on(\'selected\', i => dialogue.selectChoice(i))`；`showChoice` 时调用 `GameUiKit.dimDialogueForChoices`（或等价 setAlpha+隐藏底栏文案）并用 `ChoicePanel.stackY` / 上移 `choices.y`，避免与底栏对话框叠字；ChoicePanel 自带 screen-fixed + modal 遮罩。',
  '- 交付语义：首过构建+冒烟 = **可玩草稿**；后续 FIX/美术轮才是提质，不要把草稿当「完成品」叙事。',
] as const;

/**
 * Archetype-only rules. A platformer never needs the three top_down portal
 * paragraphs, and shipping them anyway is pure first-round prompt weight.
 */
const KERNEL_ARCHETYPE_LINES: Record<string, readonly string[]> = {
  top_down: [
    '- top_down：`Title → Chapter 开场（Skip）→ World`；`resolveWorldLayoutsBySceneId` + `bg_region_*` + `playRegionBgm`；门户 `scene.start` / `worldRegionId`+`restart`；**结局文案进** `STORY_BIBLE.endings`，Scene 只演。',
    '- top_down 门户硬规则：player spawn 与任意 portal 圆心距离必须 **≥ 120px**（禁止出生点叠在回城门上，否则 walk-in 会瞬间弹回上一区域）；区域切换后应有短 grace 或等价防抖。',
    '- top_down + 世界种子：**双层 game.json** — `customModule` 开机壳（与 extraScenes 对齐）+ `layoutOnly` 区域行（entities/portals SSOT）+ `worldStartRegionId`；禁止把 initialSceneId 改回区域 id 或删掉壳/区域。',
  ],
  ui_heavy: [
    '- ui_heavy：多章 `story/chapter_XX.json` + ChoicePanel wordWrap + Skip；Ending 读 `bible.endings`。',
  ],
  grid_logic: [
    '- grid_logic：只是无重力/格子提示。棋类必须点选走子 + module-board 规则表 + registry.won；禁止 SPACE 涨分壳。蛇/鸟/2048 才走对应街机核。',
  ],
};

/** Every archetype's lines, for the un-scoped contract exports. */
function allArchetypeLines(
  table: Record<string, readonly string[]>,
): readonly string[] {
  return Object.keys(table)
    .sort()
    .flatMap((k) => table[k] ?? []);
}

function kernelContract(archetype?: string | null): string {
  const extra = archetype
    ? (KERNEL_ARCHETYPE_LINES[archetype] ?? [])
    : allArchetypeLines(KERNEL_ARCHETYPE_LINES);
  return `

【内核只是底座 / Kernel = carrier, not the product】
${[...KERNEL_BASE_LINES.slice(0, 3), ...extra, ...KERNEL_BASE_LINES.slice(3)].join('\n')}`;
}

export const KERNEL_AS_BASE_CONTRACT = kernelContract();

/**
 * Round-specific half of the skeleton contract: what the platform just did to
 * *this* workspace. Everything timeless lives in the durable manual instead.
 */
const SKELETON_HEAD = `\n\n【脚手架契约 / Skeleton Contract — 首次生成】
- 工作区已由平台预生成最小骨架：package.json 锁定了 phaser + @opengame/runtime。默认 \`src/main.ts\` 为 \`await bootstrap({ source: './game.json' })\`（**必须**保留相对路径 \`'./game.json'\`）。
- **grid_logic 只是格子提示**：街机可用 public/game.json + skills；**棋类必须** \`BoardTurnScene\` + extraScenes + \`@opengame/module-board\`。已播种的载体不是成品，禁止把空格加分当游戏。
- **RPG/叙事/探索/塔防/平台跳跃/棋盘**：平台按 MechanicSpec.modules **组合注入**依赖 + Scene 桩；**Scene 名称与剧情由你/GDD 自由定义**，不要整盘复制模板关卡。
- 可玩闭环必须在 **Scene/TS 或 skills** 里实现胜负（og:win / registry.won），不要只放一个能移动的色块。
- **保留**平台已写入的 MiniMax 真资产：\`assets[]\`（player/player_run/background/enemy/item/bgm/sfx_*）与 \`audioTracks[]\`；实体 sprite 使用 \`"assetId":"player"|"enemy"|"item"\`（不要改成色块 shape）。
- **Juice 保活**：保留 \`PlatformSceneHelper\` / \`GameUiKit\`（preloadGameAudio / playSfx / burst / shake / followPlayer / addParallaxBackground / installPauseMenu / applyPlayerPose / addDialoguePanel）；**禁止**把已接线 Scene 退化成无音效、无镜头跟随的纯色块循环。
- 美术默认已由平台 MiniMax 落盘；仅在缺塔/特效等额外槽时再调用 generate_game_assets。
- module 包已写入 package.json 时可 import；若缺失可声明 \`file:../../packages/module-*\`（monorepo）或按 prompt 使用 runtime DSL。`;

const ITERATION_HEAD = `\n\n【增量迭代契约 / Iteration Contract — 在现有游戏上修改】
- **这是多轮迭代的后续请求**：工作区已有上一版游戏代码，请**只修改**与用户新需求相关的文件。
- **有 MechanicSpec 就改规格再补代码**：实现新增 \`loops[]\` / GameOps，禁止把缺的象棋补成贪吃蛇。
- **用户说重做/换类型才换 space/time**；否则保留镜头与时间模型。
- **循环写瘦了**：补验收信号和一层手感（juice / registry.won），不要换载体。
- **禁止**整盘重写 \`public/game.json\` 或删除无关 scene/实体，除非用户明确要求「重做/换类型」。
- **例外**：门禁 FIX 要求补 Scene/extraScenes/删除未实现 JSON 字段时，**必须**执行。
- 保留已有玩法核心、场景 id、资产 key；新增内容应向后兼容。
- 若用户要加音乐/美术：优先保留已有 MiniMax \`player\`/\`background\`/\`enemy\`/\`item\`/\`bgm\`；仅补缺槽时用 generate_game_assets。
- **禁止覆盖**已有 \`assetId\`（player/enemy/item）为纯 shape 色块。
- **Juice 保活**：保留 \`PlatformSceneHelper\` / \`GameUiKit\` 音效/粒子/镜头/暂停/对话框；改玩法时不要删掉这些调用。
- 若用户要加剧情/战斗：扩展 src/scenes/*.ts 与 story JSON，使用 module-dialogue / module-combat；优先改 CONTENT_GRAPH / chapter JSON。`;

export const SKELETON_CONTRACT = `${SKELETON_HEAD}
${KERNEL_AS_BASE_CONTRACT}${GAME_JSON_DSL_SHAPE}${ENGINE_SCENE_CONTRACT}${CAPABILITY_CATALOG}${PHASER_TYPESCRIPT_CONTRACT}${PLATFORM_HOSTED_CONTRACT}${PLAYABILITY_CONTRACT}`;

export const ITERATION_CONTRACT = `${ITERATION_HEAD}
${KERNEL_AS_BASE_CONTRACT}${ENGINE_SCENE_CONTRACT}${CAPABILITY_CATALOG}${PHASER_TYPESCRIPT_CONTRACT}${PLATFORM_HOSTED_CONTRACT}${PLAYABILITY_CONTRACT}`;

/** Name the OpenGame CLI auto-loads from the workspace as system context. */
export const CLI_CONTEXT_FILENAME = 'QWEN.md';

/**
 * The timeless half of the contract, for {@link CLI_CONTEXT_FILENAME}.
 *
 * The first CODE prompt used to carry 8–10k characters of manual that is
 * identical on every job and every retry, which is a large part of why round 1
 * ran the model into its 900s wall. The CLI already merges a workspace context
 * file into its system prompt, so these blocks belong there: written once,
 * scoped to the archetype, and free of the per-round prompt entirely.
 */
export function buildCliContextDoc(options?: {
  readonly archetype?: string | null;
  readonly isIteration?: boolean;
}): string {
  const archetype = options?.archetype ?? null;
  const dsl = options?.isIteration ? '' : GAME_JSON_DSL_SHAPE;
  return `# OpenGame 平台硬约定 / Platform contract

<!-- 由 OpenGame 平台自动生成，供 CLI 作为系统上下文加载。请勿修改或删除。 -->
<!-- Auto-generated by the OpenGame platform. Do not edit or delete. -->

本文件是**长期有效**的平台约定；每轮提示只补充「这次要做什么」，不再复述以下规则。
${archetype ? `\n当前 Archetype：**${archetype}**（下列规则已按此裁剪）。\n` : ''}${kernelContract(archetype)}${dsl}${ENGINE_SCENE_CONTRACT}${CAPABILITY_CATALOG}${PHASER_TYPESCRIPT_CONTRACT}${PLATFORM_HOSTED_CONTRACT}${playabilityContract(archetype)}
`;
}

/** Pointer that replaces the inlined manual once it lives in the workspace. */
function externalizedContractNote(): string {
  return `

【平台硬约定已随工作区提供 / Contract lives in the workspace】
- 完整平台契约（内核底座、game.json 形状、引擎 Scene、能力库、Phaser TS 约定、托管环境、可玩性硬契约）见工作区根目录 \`${CLI_CONTEXT_FILENAME}\`，CLI 已把它并入系统上下文。
- 本提示不再复述这些规则；如有冲突以 \`${CLI_CONTEXT_FILENAME}\` 为准。**不要**修改或删除该文件。`;
}

/**
 * Lean FIX contract — do NOT re-inject full skeleton/iteration manuals.
 * Token stopgap: fixer only sees errors + minimal hard rules.
 */
const FIX_HEAD = `\n\n【FIX 子 Agent 契约 / Lean Fix Contract — 只修错误，不重写】
- 你是 **fixer**：只根据下方错误摘要修改**最少文件**，禁止整盘重写。
- **禁止**在 game.json 写入 runtime 不执行的字段：gameFlow、sceneConfig、spawners、entities_templates、scene.rules 对象。若已有则删除。
- assets 仅允许 .png/.webp；禁止 .svg。
- **保留** MiniMax 真资产：\`player\`/\`background\`/\`enemy\`/\`item\`/\`bgm\`/\`sfx_*\`/\`npc_*\`；**禁止**把已有 \`assetId\` 改回纯 shape 色块。
- **Juice 保活**：不要删除 \`PlatformSceneHelper\` / \`GameUiKit\` / \`preloadGameAudio\` / \`playSfx\` / \`burst\` / \`followPlayer\` / \`installPauseMenu\`。
- 叙事问题：优先修 \`public/STORY_BIBLE.json\`、\`public/CONTENT_GRAPH.json\`、\`public/story/*.json\` 的图边（终端 \`nextId: null\`）与 Scene 加载；不要只改 Title 文案。
- 复杂玩法用 src/scenes/*Scene.ts + bootstrap({ extraScenes })；不要发明未接线的 DSL。
- **种子错配**：若用户要象棋/棋类但磁盘仍是 \`GridArcadeScene\` / \`SPACE to score\` / \`ARCADE_KERNEL.json\`，**必须换成 BoardTurnScene + module-board**，只保留 juice/bootstrap。
- **不要**调用 npm run build / typecheck（平台会自动跑）。
- 修完即停；不要扩展无关功能。`;

export const FIX_CONTRACT = `${FIX_HEAD}
${PHASER_TYPESCRIPT_CONTRACT}${PLATFORM_HOSTED_CONTRACT}${PLAYABILITY_CONTRACT}`;

/** When PLATFORM_ALLOW_ASSET_FIX=true, FIX may regenerate failing art. */
export function buildFixContract(options?: {
  /** Drop the manuals the workspace context file already carries. */
  readonly contractInWorkspace?: boolean;
}): string {
  const base = options?.contractInWorkspace
    ? FIX_HEAD + externalizedContractNote()
    : FIX_CONTRACT;
  const allowAssets =
    process.env['PLATFORM_ALLOW_ASSET_FIX'] === 'true' ||
    process.env['PLATFORM_ALLOW_ASSET_FIX'] === '1';
  if (!allowAssets) {
    return base.replace(
      '禁止整盘重写。',
      '禁止整盘重写、禁止重新生成资产。',
    );
  }
  return `${base}

【资产修复许可 / Asset FIX allowed】
- 若门禁指出缺图、.svg、风格崩坏、MiniMax pack 缺槽：允许有限次调用 generate_game_assets 重生 **失败的那几项**（player/player_run/background/enemy/item/BGM/SFX），并更新 assets[]。
- 不要无故重做全部资产；保持 style_anchor 一致；实体继续用 assetId 接线；sprite 默认抠图，场景图禁止抠图。`;
}

export const BEYOND_BASELINE_CONTRACT = `

【超越基线 / Beyond OpenGame demo floor】
- 不要只做到「能移动的方块」或单场景空壳；必须有 **可通关路径**（胜负/任务完成）。
- 有 MechanicSpec.loops 时：必须实现**点名循环**（走棋/钓鱼/布防…），不要用无关街机或空格壳冒充。
- 非 grid_logic：≥2 个有意义 Scene，含 Title/玩法/结束 之一组合；技能或战斗或对话至少一类做深。
- 资产：角色与背景必须是 png/webp，风格统一；禁止用色块冒充成品美术（可用程序图形仅作 fallback 并在注释标明）。
- 目标：同提示下明显强于「无模板 + 随意聊天模型」一稿，并向官方画廊 Demo 的可展示度靠近。`;

export const MULTI_ROLE_CONTRACT = `

【多角色编排提示 / Multi-role（同一会话内扮演）】
1. **Designer**：先确认 GDD 可玩验收清单（胜负条件、关卡节拍）。
2. **Artist**：style_anchor + generate_game_assets。
3. **GameplayCoder**：实现 Scene/DSL，接好 extraScenes。
4. **QA**：自检胜负跳转、无未实现 JSON 字段、无 .svg。
按顺序完成，不要跳过 Designer 验收清单。`;

export function buildLeanFixPrompt(options: {
  readonly userPrompt: string;
  readonly errorBlock: string;
  readonly workspaceSummaryText?: string;
  readonly briefSnippet?: string;
  readonly extraBlock?: string;
  /** Set when the workspace already carries the durable contract. */
  readonly contractInWorkspace?: boolean;
}): string {
  const visionExtra =
    options.extraBlock ??
    (globalThis as { __ogVisionFix?: string }).__ogVisionFix ??
    '';
  const parts = [
    '【FIX 轮 — 稀疏上下文】',
    options.briefSnippet ? `【Brief】\n${options.briefSnippet.slice(0, 800)}` : '',
    options.workspaceSummaryText
      ? `【工作区摘要】\n${options.workspaceSummaryText.slice(0, 1000)}`
      : '',
    `【用户原始需求（参考，勿借机大改）】\n${options.userPrompt.slice(0, 600)}`,
    options.errorBlock,
    visionExtra,
    buildFixContract(
      options.contractInWorkspace === undefined
        ? undefined
        : { contractInWorkspace: options.contractInWorkspace },
    ),
  ].filter(Boolean);
  return parts.join('\n\n');
}

export interface GameParamsInput {
  readonly theme?: string;
  readonly variant?: string;
  readonly difficulty?: number;
  readonly musicStyle?: string;
  readonly gameSpeed?: number;
  readonly timeLimit?: number;
  readonly effectsVolume?: number;
  readonly lives?: number;
  /** The art-style picker's choice — an {@link ArtStyleId}. */
  readonly artStyleId?: string;
  /** Legacy intake field; older clients still send the tone here. */
  readonly artTone?: string;
}

const MUSIC_STYLE_HINTS: Record<string, string> = {
  chiptune: '8-bit/chiptune BGM，使用 generate_game_assets 生成或引用 assets',
  synthwave: '80s synthwave 电子 BGM',
  orchestral: '管弦乐氛围 BGM',
  ambient: '环境氛围音乐，低干扰',
  rock: '摇滚节奏 BGM',
  jazz: '爵士轻快节奏',
};

export function buildEnhancedPrompt(options: {
  basePrompt: string;
  gameParams?: GameParamsInput;
  imagesCount?: number;
  isIteration: boolean;
  workspaceSummary?: WorkspaceGameSummary;
  conversationTurns?: ConversationTurn[];
  pipelineContext?: string;
  archetype?: string;
  /**
   * When false, skip BEYOND/MULTI_ROLE even if env says beyond=true.
   * Progressive gates should pass false on the first CODE round.
   */
  includeBeyond?: boolean;
  /**
   * True once {@link CLI_CONTEXT_FILENAME} is on disk, so the durable manual can
   * be dropped from the prompt and read from the CLI's system context instead.
   */
  contractInWorkspace?: boolean;
}): string {
  let prompt = options.basePrompt;

  if (options.pipelineContext) {
    prompt = `${options.pipelineContext}\n\n${prompt}`;
  }
  if (options.archetype && options.archetype !== 'grid_logic') {
    prompt = `${prompt}\n\n【Archetype=${options.archetype}】必须使用 ENGINE_SCENE 契约：src/scenes/* + extraScenes。`;
  }
  if (options.conversationTurns && options.conversationTurns.length > 0) {
    prompt = `${formatConversationForPrompt(options.conversationTurns)}\n\n${prompt}`;
  }
  if (options.isIteration && options.workspaceSummary?.hasExistingGame) {
    prompt = `${prompt}\n\n【当前工作区游戏摘要 / Existing game】\n${options.workspaceSummary.summaryText}`;
  }

  const styleInstructions: string[] = [];
  const gp = options.gameParams;
  if (gp) {
    const themeInstructions: Record<string, string> = {
      cyberpunk: '使用霓虹色彩(#00fff9, #ff00ff)，深色背景(#0a0a0f)',
      pixel: '使用精细像素艺术风格，锐利像素边缘，不要模糊插值',
      neon: '使用发光效果，鲜艳的霓虹色彩',
      minimal: '使用极简主义设计，扁平化纯色背景',
      nature: '使用自然绿色调(#22c55e)',
      space: '使用太空科幻主题(#818cf8)，星空背景',
      retro: '使用复古街机风格(#ef4444)',
      fantasy: '使用奇幻魔法主题(#8b5cf6)',
    };
    // The picker's ids are the authority; `theme` is the legacy channel.
    const artStyleId = gp.artStyleId ?? gp.artTone;
    if (isArtStyleId(artStyleId)) {
      const profile = artStyleProfile(artStyleId);
      styleInstructions.push(
        `美术风格: ${profile.artStyle}（${profile.promptSuffix}）`,
      );
      styleInstructions.push(
        profile.pixelPerfect
          ? 'Phaser 渲染开启 pixelArt/roundPixels，纹理不要平滑'
          : 'Phaser 渲染关闭 pixelArt，开启纹理平滑与 devicePixelRatio 分辨率',
      );
    } else if (gp.theme && themeInstructions[gp.theme]) {
      styleInstructions.push(themeInstructions[gp.theme]);
    }
    const variantInstructions: Record<string, string> = {
      classic: '经典游戏模式',
      endless: '无尽生存挑战，难度随时间递增',
      pvp: '双人对战',
      'time-attack': `计时挑战 ${gp.timeLimit || 60} 秒内获得最高分`,
      puzzle: '解谜模式',
      'boss-rush': '每关一个 Boss',
    };
    if (gp.variant && variantInstructions[gp.variant]) {
      styleInstructions.push(variantInstructions[gp.variant]);
    }
    if (gp.difficulty) {
      const names = ['', '简单', '普通', '困难', '噩梦', '地狱'];
      const d = Math.min(Math.max(gp.difficulty, 1), 5);
      styleInstructions.push(`难度: ${names[d]}`);
    }
    if (gp.gameSpeed && gp.gameSpeed !== 1) {
      styleInstructions.push(`游戏速度: ${gp.gameSpeed}x`);
    }
    if (gp.lives && gp.lives > 0) {
      styleInstructions.push(`生命数: ${gp.lives}（HUD lives 开启）`);
    }
    if (gp.musicStyle && MUSIC_STYLE_HINTS[gp.musicStyle]) {
      styleInstructions.push(`音乐风格: ${MUSIC_STYLE_HINTS[gp.musicStyle]}`);
    }
    if (gp.effectsVolume !== undefined && gp.effectsVolume >= 0) {
      styleInstructions.push(`音效音量偏好: ${gp.effectsVolume}%`);
    }
  }

  if (styleInstructions.length > 0) {
    prompt = `${prompt}\n\n【游戏配置要求】\n${styleInstructions.join('\n')}`;
  }
  if (options.imagesCount && options.imagesCount > 0) {
    prompt += `\n\n【用户上传的参考图片】\n用户上传了 ${options.imagesCount} 张参考图片，请理解其风格意图。`;
  }

  const contract = options.contractInWorkspace
    ? (options.isIteration ? ITERATION_HEAD : SKELETON_HEAD) +
      externalizedContractNote()
    : options.isIteration
      ? ITERATION_CONTRACT
      : SKELETON_CONTRACT;
  let out = prompt + contract;
  const beyondEnv =
    process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] === 'true' ||
    process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] === '1';
  const includeBeyond = options.includeBeyond ?? beyondEnv;
  if (includeBeyond) {
    out += BEYOND_BASELINE_CONTRACT + MULTI_ROLE_CONTRACT;
  }
  return out;
}
