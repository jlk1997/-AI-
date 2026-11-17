# Quality evaluation set (beyond baseline)

Use these prompts for regression. Score: playable minutes (0–10), clear win path (0/1), art (1–5), systems depth (1–5). Target: beat ChatGPT one-shot and prior skeleton+MiniMax coding baseline.

## Game prompts (6+)

1. Flappy-style one-tap flyer with score, death, restart.
2. Snake with growing body, food, wall death, HUD score.
3. 2048 with merge rules and win at 2048 tile.
4. Short platformer: run, jump, 1 enemy, flag at end (2 scenes min).
5. Top-down fetch quest: talk NPC, pick item, return (dialogue + inventory).
6. Micro tower defense: place 1 tower type, 3 waves, lose on leak.

## Multi-turn iteration prompts (3+)

Run after a successful game from prompts 4–6. Score: intent landed (0/1), visible change (0/1), no juice regression (0/1).

1. **Harder + Boss:** 「更难一点，加一个 Boss」— expect CHANGE_PLAN.json, boss-tagged entity or Boss scene, measurable harder signal, smoke still progresses.
2. **Art style swap:** 「画风换成赛博朋克」— expect GDD art style updated, MiniMax pack force-regen, assets visibly different style.
3. **Fetch deepen:** (after top-down) 「先跟 NPC 对话才能拿道具」— expect Guide/E talk gate or equivalent; inventory/progress registry.

## World prompts (4+)

1. Traitor smith town with forest danger (expect ≥3 regions after depth).
2. Dungeon key + boss loop.
3. Forest mystery with two quest lines.
4. LingBot cinematic world (spatialBackend lingbot) — mock must not block play; real only if weightsReady.

## Society world prompts (4+)

Score: named people/places match the prompt (0/1), seed has real dialogue (0/1), no Stanford-square collapse (0/1), interview cites a whisper (0/1), same-day re-ask does not recite (0/1).

1. **Canal boat 10:** 「运河货船 10 名船员的可观察社会，值班官「维加」和补网人「阿禾」必须出现，不要塌回无名广场。」— expect crew pack, 10 NPCs, 维加/阿禾 authored (not padded pool names), no `town_square`.
2. **Cloister hours:** 「修道院日课：抄经房、菜园、礼拜堂。修士「清远」管抄经。」— cloister pack, those places, 清远 present.
3. **Named occupation:** 「渔村铁匠「老陈」必须出现，码头和晒网场也要在。」— occupation + places land; 老陈 is authored.
4. **No square collapse:** 「不要塌回无名广场模板。灯笼巷夜市，摊主「林嫂」。」— no scaffold town ids; 林嫂 kept.

G7 interview: after a paid 巷议 / whisper, interview must cite that memory id; asking the same question again the same day must refuse verbatim recitation.

World generation SSOT: [`world-generation.md`](./world-generation.md). Default society seed is **16h** (not 6h).

## Blind tiers (world)

| Tier | Config | What to judge |
|------|--------|----------------|
| L1 | agentic off, lingbot off | Spec thickness + presenter art |
| L1+L2 | agentic on | Region/quest/rule counts rise; `agenticDiff` present |
| L1+L2+L3 | lingbot mock/real | Cinematic slot + honest mock/real tag |

## LingBot readiness

- `weightsReady`: 8× `model-*-of-00008.safetensors` under `LINGBOT_CKPT_DIR/transformers` each ≥1GB, plus repo `generate.py`.
- P3 default cinematic only after real clip success rate is acceptable; mock never counts as real success.
- L3 mock must stamp a **browser-playable** poster (`png`/`mp4`), never JSON-only `data:application/json`.
- Regression: `npm run quality:eval-smoke`.
- Society G7 (offline, no MiniMax): `npm run quality:society-promises`.
- Multi-turn offline: `npm run quality:multiturn-smoke`（横版→更难+Boss→赛博画风：parse + DSL seed + GDD align）.
- Blind scorecard: `npm run quality:blind-scorecard`（自动项 + `docs/platform/blind-scorecard-latest.json` 人工清单）.
- CI gate: `.github/workflows/platform.yml` runs eval-smoke + multiturn + blind-scorecard.

## Success metrics (Phase-24–34)

| Check | Pass bar |
|-------|----------|
| Multi-turn三连（横版→更难+Boss→赛博画风）玩法可见 | ≥ 80% blind |
| Same chain 画风可见变化 | ≥ 80% blind + ASSET_FINGERPRINT 哈希变化 |
| Intent Gate Boss/harder 假绿（REQUIRE_REAL） | ~0 |
| CODE 冲掉 Boss 后 | Scene 契约自动回注 bossPresent |
| ChangePlan abort | `RECOVERY.json` + 用户可见「建议下一句」+ 一键填入聊天 |
| World expand 新区 cinematic 与 dirty Spec 一致 | no stale start poster；≤5 区全海报；修订列表可见 dirtyRegions |
| 世界增量编辑 | 二次确认；时间线提示海报刷新 |
| Lab mock `/step` 标成「真视频」/出片完成 | 0（仅 videoUrl 算 clip finish） |
| Reset「重做」后走首轮 scaffold（非假迭代） | CHANGE_PLAN intent=reset + 无旧 game.json |
| `quality:eval-smoke` ChangePlan 三 fixture | parse harder+Boss / cyberpunk / addScene |
| Boss 生成路径 | Scene 含 `bossPresent` / `setData('boss')` |
| 参考图上传 | `public/refs` + MiniMax `subject_reference`（可关） |
