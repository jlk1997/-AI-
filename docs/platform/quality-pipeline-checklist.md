# Quality pipeline checklist (game + world)

Full-link gates for OpenGame platform quality uplift. Each row must pass before a generate job may be marked succeeded.

| # | Stage | Game | World | Gate / artifact |
|---|--------|------|-------|-----------------|
| 1 | Chat UI / mode | `mode=game` | `mode=world` + WorldPanel | User sees acceptance hints |
| 2 | Job enqueue | `generate` | `world_generate` / `world_edit` / `world_train` | Job type correct |
| 3 | Plan / design | classify + `GAME_DESIGN.md` + playable checklist | WorldGDD depth via planner templates + agentic | Spec/GDD on disk |
| 4 | Scaffold | `PLATFORM_PROJECT_SCAFFOLD_MODE=engine` + archetype modules | Presenter scaffold (phaser/three) | Not bare skeleton for complex games |
| 5 | OpenGame CLI / tools | CODE + ASSET phases | World asset phase (style_anchor sprites) when enabled | CLI exit 0 |
| 6 | Multimodal assets | `generate_game_assets` ≥ character+bg+bgm+sfx | Region/NPC/tile refs under Spec style | png/webp only |
| 7 | L2 neural / agentic | — | `WORLD_AGENTIC_ON_GENERATE` + metrics in Spec | `presentation.agenticDiff` |
| 8 | L3 LingBot | — | mock path always; real when `weightsReady` | sidecar health |
| 9 | Runtime play | Phaser + DSL / Scenes | Spec-driven explore + textured presenter | Playable loop |
| 10 | QA | `runGameQualityGate` + playability smoke + FIX | `runWorldQualityGate` + FIX rebuild | `ok: true` |
| 11 | Deploy / preview | S3 + previewUrl | Same + `lingbot.json` / spatialAssets | Preview loads |
| 12 | Eval / regression | `docs/platform/quality-eval-set.md` | L1 / +L2 / +L3 blind tiers | Beyond ChatGPT baseline |

## Env switches (quality)

| Var | Intent |
|-----|--------|
| `PLATFORM_PROJECT_SCAFFOLD_MODE=engine` | Restore Template Skill |
| `PLATFORM_USE_ARCHETYPE_SCAFFOLD=true` | Inject module deps + Scene stubs |
| `PLATFORM_GAME_QUALITY_MODE=strict` | Audio + richer content required |
| `PLATFORM_ALLOW_ASSET_FIX=true` | FIX may regenerate assets |
| `WORLD_AGENTIC_ON_GENERATE=true` | L2 productize α |
| `WORLD_QUALITY_GATE=true` | Fail world job if Spec too thin |
| `PLATFORM_SOCIETY_SEED_SOFT=1` | Yellow-pass a society seed that has 0 real lines or thin spread (default: hard fail) |
| `LINGBOT_MODE` | mock until weightsReady; then real |

## Success definition (beyond original OpenGame demos)

- Game: win/lose reachable; not movement-only; real assets; multi-scene for non-grid archetypes; **engine scaffolds ship playable kernels** (not `implement gameplay` TODOs).
- World (巷议社会镇): named places/jobs/people from the prompt; seed default **16h** has **real dialogue** and spread (or `PLATFORM_SOCIETY_SEED_SOFT=1` yellow pass); embed miss / hash fallback labeled in the observatory; L3 mock/real labeled in UI — prettier posters must not hide an empty mind. RPG worlds still use ≥3 regions / quests / pressure. SSOT: [`world-generation.md`](./world-generation.md).
- World FIX on society jobs may only add residents / bind places / edit identity — no combat quests to pass the gate.

## Phase-2 landed (follow-up implementation)

| Item | Status |
|------|--------|
| Playable Scene kernels in `workspace.ts` | done |
| Stub TODO detection in `gameQualityGate` | done |
| World FIX iterations (`WORLD_MAX_FIX_ITERATIONS`) | done |
| World `runWorldAssetPhase` placeholders + `ASSET_BRIEF.json` | done |
| GDD Playable Acceptance Checklist on disk | done |
| `finish-when-ready.ps1 -RestartSidecar` / `-Once` | done |
| GeneratePage quality banners | done |

## Phase-3 landed

| Item | Status |
|------|--------|
| L2-beta `probeWorldPlayability` + gate integration | done |
| L3 startRegion `spatialAssets` stamp (+ ALL_REGIONS) | done |
| Brief `artStyle` <-> world `styleAnchor` coupling | done |
| ArtDirector image gate (non-grid >=1 png) | done |
| `scripts/quality-eval-smoke.mjs` regression | done |

## Phase-4 landed (product-visible loops)

| Item | Status |
|------|--------|
| Presenter loads `ASSET_BRIEF` sprites | done |
| L3 require playable videoUrl/assetUrl (reject JSON-only mock) | done |
| Offline LingBot mock emits PNG poster | done |
| World tip style → game coder context | done |
| ArtDirector on-disk png/webp check | done |
| `toL3PresentationManifest` counts playable posters | done |

## Phase-5 landed (first-screen + gates)

| Item | Status |
|------|--------|
| TitleScene plays L3 `assetUrl` PNG poster (not video-only) | done |
| Playability smoke fails under strict when Playwright missing | done |
| ArtDirector audio on-disk check (strict/beyond) | done |
| Post-`applySpatialResults` L3 revalidation | done |
| WorldPanel surfaces L2 agenticDiff tags | done |
| three3d Presenter loads ASSET_BRIEF + L3 poster | done |
| Sidecar mock poster PNG (`_png_frame`) | done |
| `PLATFORM_WORK_ROOT` Windows-local path | done |

## Phase-6 landed (kernels + FIX + UX)

| Item | Status |
|------|--------|
| TD kernel uses `WaveManager` + `EconomyManager` (place towers, 3 waves) | done |
| Battle kernel uses `TurnManager` phases | done |
| `PLATFORM_ALLOW_ASSET_FIX` re-runs ASSET phase on disk failures | done |
| World edit/rebuild/agentic share `assertWorldL3Playable` | done |
| CinematicLayer `preferStaticSpec` — mock steps don't clobber posters | done |
| `finish-when-ready.ps1` reads `LINGBOT_CKPT_DIR` from `.env` | done |
| AgentQualityPanel acceptance checklist | done |

## Phase-7 landed (acceptance UX + archetype kernels)

| Item | Status |
|------|--------|
| Acceptance checklist lifecycle uses `done` | done |
| Shared `deriveAcceptanceChecks` + LivePreview game strip | done |
| Win-path detect requires `registry.set('won')` / Victory|GameOver|Ending | done |
| TD gate requires WaveManager + EconomyManager | done |
| Platformer kernel uses `PlatformSceneHelper` | done |
| Top-down kernel uses `WorldSceneHelper` | done |
| WorldPanel closes prior LingBot session before open | done |

## Phase-8 landed (dialogue / grid win / quality UX)

| Item | Status |
|------|--------|
| Chapter kernel uses `DialogueManager` | done |
| grid_logic skills win via `addScore.winAt` + gate | done |
| LivePreview `onOpenQuality` + quality tab auto-switch on fail | done |
| Acceptance checklist evidence-first (game; world L2/L3) | done |
| TD WaveManager/won unit tests | done |
| WorldPanel L2 train/imagine status strip | done |

## Phase-9 landed (win loop / endings / world strip)

| Item | Status |
|------|--------|
| `og:win` → Victory/GameOver/overlay + HUD `og:score` | done |
| Ending/Victory/GameOver kernels show score + pulse | done |
| World EndingScene uses styleAnchor + quest summary | done |
| grid_logic beyond requires image + ASSET phase | done |
| LivePreview acceptance strip for world mode | done |
| World L2/L3 checklist evidence-first | done |
| `worldL3Gate` unit tests | done |
| Eval smoke hard-fails playability probe issues | done |

## Phase-10 landed (false-green / win-path / audio / L2-L3 UX)

| Item | Status |
|------|--------|
| Acceptance strip: remove softOnDone false greens | done |
| Non-grid beyond always requires detectWinLoseInScenes | done |
| ArtDirector: non-grid ≥2 images; audio ASSET-FIX + sfx_win/lose ids | done |
| World gate requires agenticDiff when WORLD_AGENTIC_ON_GENERATE | done |
| L2 manifest `ran` + ReadyStrip L3 CTA | done |
| World procedural-v2 silhouette sprites | done |
| Playability smoke `__ogPlayProbe` progress (optional hard via PLATFORM_SMOKE_REQUIRE_PROGRESS) | done |

## Phase-11 landed (frontier UX / LingBot real)

| Item | Status |
|------|--------|
| `.env` `LINGBOT_MODE=real` + sidecar reads `.env` (no force-mock) | done |
| Research lab always visible (empty + ready world) | done |
| Top-bar flask + TechFriendlyStrip L1/L2/L3 | done |
| Sidecar-down copy-start + need-world CTA | done |
| Onboarding world step 5 = Research lab | done |

## Phase-12 landed (real MiniMax art — no placeholders)

| Item | Status |
|------|--------|
| Fix MiniMax image/video host (`/v1` strip) + `.env` base URLs | done |
| Disable procedural audio when `OPENGAME_AUDIO_PROVIDER=minimax` | done |
| World ASSET = MiniMax sprites + BGM/SFX; hard-fail (no procedural-v2) | done |
| L3 posters via MiniMax (ban 1×1 data-URI stamp) | done |
| Asset authenticity probes (size + near-solid PNG) in game/world gates | done |
| `WORLD_REQUIRE_REAL_ASSETS` / `PLATFORM_REQUIRE_REAL_ASSETS` | done |
| Presenter loads `assets[]` + audio (not only legacy placeholders) | done |
| Dual-write `placeholders` → same MiniMax files for old scaffolds | done |
| Deterministic `runGameAssetPhase` (MiniMax seed + patch game.json) | done |
| MiniMax audio path: no ABC/procedural fallback when provider=minimax | done |

## Phase-13 landed (close remaining fake-asset holes)

| Item | Status |
|------|--------|
| LingBot offline: no more 1×1 mock poster; defer to MiniMax | done |
| `applySpatialResults` probes data-URI + on-disk spatial PNG; rewrite fakes | done |
| World disk gate also scans `public/spatial/*.png` | done |
| Game ASSET: CODE 后 patch `game.json`；ALLOW_PLACEHOLDER 硬失败 | done |
| Runtime auto-play `sfx_win` / `sfx_lose` on og:win / og:lose | done |
| PNG authenticity: RGB + RGBA / grayscale sampling | done |
| Procedural audio blocked under `*_REQUIRE_REAL_ASSETS` too | done |

Run: restart **platform-worker**；若改了 `lingbot.ts` / runtime 需 `npm run build -w @opengame/world-runtime` 与 `npm run build -w @opengame/runtime`。世界约 5 图+3 音 + L3 海报；游戏约 2 图+3 音。禁止 mock/纯色占位。Sidecar: `start-tier-b.ps1` → `/health` `mode=real` `readyReal=true`。

## Phase-14 landed (fake-success / fake frames)

| Item | Status |
|------|--------|
| Sidecar `_png_frame` = 640×360 Pillow PNG (no 1×1) | done |
| Session/step mark `presentationMock` + Lab/UI fallback badges | done |
| `WORLD_QUALITY_GATE` L3 assert aligned with FIX gate (`!== false`, soft opt-out) | done |

## Phase-15 landed (game product feel)

| Item | Status |
|------|--------|
| Engine kernels load MiniMax `player.png` / `background.png` | done |
| GDD scene names → strong role kernels (no SPACE stub) | done |
| CLI ASSET skipped when MiniMax seed on (`PLATFORM_ENABLE_CLI_ASSET`) | done |
| `PLATFORM_SMOKE_REQUIRE_PROGRESS=true` | done |
| Acceptance strip prefers structured gate/smoke/asset details | done |

## Phase-16 landed (LingBot deep link)

| Item | Status |
|------|--------|
| `?mode=world&lab=1` opens Research Lab | done |
| Marble stub hidden + refused on persist/generate | done |
| Clip fallback / failure visibility in Lab | done |

## Phase-17 landed (L2 dynamics honesty)

| Item | Status |
|------|--------|
| API train sync + imagine read/write `public/dynamics.json` | done |
| `train_rssm.py` docstring: DynamicsMLP not RSSM | done |
| `world_chunks` documented as reserved / unused | done |

## Phase-18 landed (engine-grade product feel)

| Item | Status |
|------|--------|
| `patchGameJson` wires `entity.sprite.assetId=player` + strips dead DSL | done |
| `syncPublicAssetsToDist` before smoke + after quality | done |
| Smoke probe: pose delta + inputFrames; missing probe fails when required | done |
| CODE contracts preserve MiniMax assets / forbid shape overwrite | done |
| WorldExplore walls use tile texture; loaderror no longer fake-success | done |

## Phase-19 landed (engine-depth art + kernels)

| Item | Status |
|------|--------|
| Game MiniMax slots: player/background/**enemy/item** + entity wiring | done |
| Quality gate rejects shape-only tagged entities under real-asset policy | done |
| Platformer coins/score; TD/Battle/top-down use enemy/item sprites | done |
| Smoke-before: full `runGameAssetPhase` + sync; FIX regen syncs dist | done |
| World `wall.png` + Explore uses wall texture; disk gate requires it | done |

## Phase-20 landed (engine-grade render + pack gate)

| Item | Status |
|------|--------|
| DSL runtime: `background` full-bleed + sprite `setDisplaySize` + missing-texture warn | done |
| `wireEntitySprites` always binds resolved MiniMax slot (overwrite stale assetId) | done |
| Kernels: top-down enemy+exit art; TD towers use `item` tint; platformer goal tinted | done |
| Gate: MiniMax pack 4-slot required when pack ids / `PLATFORM_GAME_MINIMAX_ASSETS` | done |
| `issuesNeedAssetRegen` matches shape/assetId / wire MiniMax / pack missing | done |

## Phase-21 landed (engine feel shell + smoke honesty)

| Item | Status |
|------|--------|
| Title / Ending / Chapter shells use `background` + player portrait | done |
| Platformer textured ground (`createGround` + texture) + body sync to display size | done |
| DSL sprite `depth` + idle tween; Battle/TD write `hp`/`kills`/`progress` registry | done |
| Smoke: canvas clicks; `REQUIRE_PROGRESS` ignores bare keydown (needs gameplay signal) | done |
| FIX contract preserves MiniMax pack; wire strips misleading `shape` | done |

## Phase-22 landed (kernel juice pass)

| Item | Status |
|------|--------|
| Kernels preload/play BGM + win/lose/coin SFX; Ending loads audio before play | done |
| Platformer/top-down camera follow; coin/kill/place-tower particles + shake | done |
| Ground = tiled strip (not full-bleed stretch); `sfx_coin` aliases `sfx_win` | done |
| Bootstrap `__og_boot` preloads DSL assets so extraScenes hear BGM/SFX | done |
| Runtime `addScore` plays coin SFX; World portals use item texture when present | done |
| Acceptance strip: art honesty + smoke real-progress + juice signal row | done |

## Phase-23 landed (shell feel + juice survival)

| Item | Status |
|------|--------|
| Boot-first scene order + BGM singleton (no Title double-play race) | done |
| Parallax BG helper + ESC/P pause menu (resume/restart/mute) | done |
| HUD panel polish; DSL dual-layer parallax background | done |
| Juice survival contracts + gate soft-check for stripped helpers | done |
| Top-down fetch: talk NPC (E) → relic → return/exit + inventory registry | done |
| World BattleScene portraits + flash/shake/SFX | done |

## Phase-24 landed (multi-turn ChangePlan + intent gate)

| Item | Status |
|------|--------|
| `ChangePlan` parse → `public/CHANGE_PLAN.json` + GDD style/enemy patch | done |
| Iterate: artStyle / force → MiniMax asset regen with `styleOverride` | done |
| Chat path merges light `gameParams` (theme/difficulty heuristics) | done |
| Intent gate: `addBoss` / `harder` / artStyle against workspace | done |
| Session summary: prefer user intents; demote Job FSM noise | done |
| FIX: ChangePlan stuck after 2 identical failures → abort (no empty burn) | done |
| Smoke: CHANGE_PLAN present forces progress requirement | done |
| Eval set: 3 multi-turn iteration prompts | done |

## Phase-25 landed (world edit visual sync + LingBot honesty)

| Item | Status |
|------|--------|
| `world_edit` / agentic: dirty regions → `applySpatialResults` + remount | done |
| `planWorldOps` (1–5); refuse weak `set_flag` when edit looks substantial | done |
| World panel: regenerate confirm vs incremental edit; revision restore tip | done |
| Lab: `presentationMock` / `recordingOnly`; Real Clip only when `readyReal` | done |
| Offline clip → Spec `spatialAssets` called out as product path | done |

## Phase-26 landed (multi-turn hardening)

| Item | Status |
|------|--------|
| Reset intent: wipe playable markers → full classify/GDD/scaffold | done |
| Smoke ChangePlan probes (Boss/harder static) + registry fields on probe | done |
| `quality:eval-smoke` ChangePlan fixtures + reset/FIX strategy contracts | done |
| Intent gate: artStyle must **match** ChangePlan tokens in GDD | done |
| Chat merges GameConfigBar params + heuristics into `gameParams` | done |
| Explicit FIX `fixStrategy`: asset-only / scene-patch / abort | done |
| Session summary user bullet cap 480; planWorldOps pad for substantial edits | done |

## Phase-27 landed (ChangePlan runtime seed + juice lock + multiturn smoke)

| Item | Status |
|------|--------|
| `applyChangePlanToGameArtifacts`: seed boss entity + harder tunables + `og_intent.json` | done |
| Runtime bootstrap stamps registry from `og_intent` / CHANGE_PLAN | done |
| Juice 保活 hard when beyond / ChangePlan / REQUIRE_REAL (partial-scene regression) | done |
| grid_logic juice: skill `addScore`/`win`/`damage` play MiniMax SFX | done |
| `world_edit` post-op `ensureWorldDepth` before spatial refresh | done |
| `npm run quality:multiturn-smoke` — 三连 ChangePlan 离线断言 | done |

## Phase-28 landed (arcade kernels + juice hard-lock + blind scorecard)

| Item | Status |
|------|--------|
| Snake / Flappy / 2048 专属 juice 内核（`gridArcadeKernels` + module-platform） | done |
| grid_logic 首轮强制 engine 播种 Arcade Scene | done |
| `JUICE_BASELINE.json` 硬锁：CODE 冲掉 juice → 门禁失败 + FIX 恢复提示 | done |
| ChangePlan `addScene` 确定性播种 DSL + Scene stub | done |
| `npm run quality:blind-scorecard` 三连自动项 + 人工盲测清单 | done |

## Phase-29 landed (MiniMax art wire + ref images + CI gate)

| Item | Status |
|------|--------|
| `PlatformSceneHelper.preloadGameArt` + arcade 用真图槽（player/bg/enemy/item） | done |
| 街机 `game.json` 预声明 MiniMax assets[] / audioTracks[] | done |
| 参考图 URL/描述 → `REFERENCE_IMAGES.json` + MiniMax prompt 注入 | done |
| Smoke：beyond/strict / ChangePlan / ArcadeKernel 默认要求 progress | done |
| `platform.yml` CI：worker tests + eval/multiturn/blind scorecard | done |
| dist 同步 ChangePlan / og_intent / juice / arcade / reference manifests | done |

## Phase-30 landed (visible Boss/art + ref uploads + pad posters)

| Item | Status |
|------|--------|
| 横版 Level：`bossPresent`/`enemyCount` → 真 Boss + 加敌；`spriteOrRect` 显示 MiniMax | done |
| `preloadGameArt` 别名 `og_player`/`og_enemy`/… 与 arcade 键对齐 | done |
| ChangePlan `addScene` 种子改为可玩小关 + 美术 | done |
| 聊天 base64 → `public/refs` + `REFERENCE_IMAGES.json`（首轮也进 asset phase） | done |
| depth pad / 缺 spatial 区域补刷海报（生成 + 编辑） | done |
| Smoke：addBoss 要求 Scene 生成路径；盲测/eval 契约收紧；sidecar `presentationMock` | done |

## Phase-31 landed (art fingerprint + multimodal + multi-archetype Boss)

| Item | Status |
|------|--------|
| `ASSET_FINGERPRINT` / PREV：artStyle force 后哈希必须变化 + Scene 须显示纹理 | done |
| MiniMax `subject_reference`（URL 或 `public/refs` base64）；`PLATFORM_MINIMAX_SUBJECT_REF=false` 可关 | done |
| top-down / Battle / TD 内核读 `bossPresent`/`enemyCount`/`difficultyTier` | done |
| L3 门禁：≤5 区域或 padded/frontier 全须可播海报（不止 startRegion） | done |
| Quality gate：addBoss 生成路径 + artStyle 指纹联动 | done |

## Phase-32 landed (post-CODE reseed + Lab clip honesty)

| Item | Status |
|------|--------|
| CODE 通过后重放 `applyChangePlanToGameArtifacts` | done |
| `ensureChangePlanSceneContracts`：缺 Boss/harder/art/juice 时确定性注入 | done |
| FIX：artStyle→asset-only；juice/Boss→scene-patch + 契约补丁 | done |
| 冒烟前 artStyle/force 仍强制 MiniMax（不静默 skip） | done |
| Lab：clip 步骤仅 `videoUrl` 算 finish；mock `frameUrl` 标 error/不推进 | done |
| multiturn-smoke 覆盖 Scene 契约注入 | done |

## Phase-33 landed (recovery UX + world edit confirm)

| Item | Status |
|------|--------|
| `RECOVERY.json` + `formatRecoveryLogMessage`（ChangePlan abort） | done |
| 失败任务面板多行展示「建议下一句」 | done |
| `summarizeJobLogKey` 识别 ChangePlan 未落地恢复块 | done |
| 世界增量编辑 / 模板 chip：`Modal.confirm` 二次确认 | done |
| 编辑成功时间线提示 dirty 区域海报已刷新 | done |

## Phase-34 landed (one-click recovery + revision poster diff)

| Item | Status |
|------|--------|
| `parseRecoverySuggestedPrompts` + JobRetryPanel「用建议 N」填入聊天 | done |
| ChatInput `draftValue`/`draftNonce` 外部填入 | done |
| FAIL SSE 把 `suggestedPrompts` 写入助手错误气泡 | done |
| world_edit `opJson.dirtyRegions` 持久化 | done |
| 修订历史展示已刷海报区域 Tags | done |

## Phase-35 landed (send recovery + Spec revision diff)

| Item | Status |
|------|--------|
| JobRetryPanel / 错误气泡「直接发送」恢复建议 | done |
| FAIL `suggestedPrompts` 结构化挂到 Message + chips | done |
| `diffWorldSpecs` + Worker `opJson.diffSummary` | done |
| `GET /projects/:id/world/revisions/:rev/diff` | done |
| WorldPanel 修订「对比 tip」Modal + 摘要行 | done |

## Provider failover (MiniMax → Volcengine Ark)

| Item | Status |
|------|--------|
| `OPENGAME_FALLBACK_*` / `OPENAI_FALLBACK_*` env | done |
| Core modality + Worker image one-shot failover on 429/2056 | done |
| CLI agent retry once with Ark on quota | done |
| Audio music/speech soft-skip on quota (keep prior / juice) | done |
| Audio quota seed pack when no prior file (bgm/sfx) | done |
| ASSET timeline `failoverEvents` + `mixed-failover` quality | done |
| eval-smoke needles for Ark / withProviderFailover | done |

## Phase-37 landed (failover product visibility)

| Item | Status |
|------|--------|
| `takeProviderFailoverNotes` accumulate + drain in game/world ASSET | done |
| World ASSET emit failover details from ASSET_BRIEF | done |
| minimaxClient unit tests (image→Ark + music soft-skip) | done |

## Phase-36 landed (juice restore + entity/rule Spec diff)

| Item | Status |
|------|--------|
| `restoreJuiceFromBaseline` 从 JUICE_BASELINE 重注入 PlatformSceneHelper | done |
| CODE 后 / FIX `juiceStuck`/`scene-patch` 调用基线恢复 | done |
| `diffWorldSpecs` 输出 added/removed entities & rules | done |
| WorldPanel diff Modal 展示实体/规则变更 | done |
| juiceBaseline 单测 + eval/blind 静态门禁 | done |

## Success metrics (productization)

| Metric | Target |
|--------|--------|
| Multi-turn三连（横版→更难+Boss→赛博画风）玩法可见变化 | ≥ 80% blind |
| Same chain art-style visible change | ≥ 80% blind |
| Intent Gate Boss/harder false-green under REQUIRE_REAL | → ~0 |
| World expand: new region cinematic ≠ stale start poster | Spec keys match dirty regions |
| Lab: mock `/step` labeled as real video | 0 incidents |

