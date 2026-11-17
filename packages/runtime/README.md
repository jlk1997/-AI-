# @opengame/runtime

Phaser-based capability library for AI-generated 2D web games.

This is the **stability spine** of the "template-free" path: each user game starts from a *near-empty* Vite + Phaser + TS skeleton and imports `@opengame/runtime` to compose scenes, entities, behaviors, skill chains, UI widgets, saves and leaderboards. The Planner Agent emits a `game.json` DSL on top of this surface, and the runtime resolves it into a playable Phaser game.

## Surface

- `core/` — `World`, `Entity`, `Component`, `Scene` (ECS-lite, Phaser-aware)
- `behaviors/` — `Patrol`, `Chase`, `Shoot`, `Dialog`, `EightWayMovement`
- `skills/` — `SkillChain` (trigger → effect → cooldown)
- `ui/` — `Dialog`, `Choice`, `HUD`, `Quiz`
- `services/` — `SaveStore`, `Leaderboard`, `Analytics` (talks to platform API)
- `dsl/` — `game.json` JSON Schema + loader + **DialogueRunner** (根级 `dialogue[]` + `scene.dialogueKey`)
- `bootstrap.ts` — single-call entry the skeleton's `main.ts` invokes

## DSL honesty (what runtime actually runs)

| Supported in JSON | Not executed (use `src/scenes/*.ts`) |
|-------------------|-------------------------------------|
| `assets`, `audioTracks`, `skills[]`, `behaviors[]`, root `dialogue[]`, `scene.dialogueKey`, `entity.state` | `gameFlow`, `spawners`, `scene.rules` objects, `sceneConfig` |

Complex RPG / narrative / TD games should use **engine scaffold** + `@opengame/module-*` + `bootstrap({ extraScenes })`.

## Stability contract

- `1.x` is binary-compatible across patch and minor releases.
- Capabilities only **add**; deprecations live ≥ 1 minor before removal.
- Every minor must pass the three baseline PoCs (Flappy / Snake / 2048).
