# platform-rpg-starter

Minimal **ui_heavy** engine-mode example: Scene stubs + `@opengame/module-dialogue` / `@opengame/module-combat`.

## Run locally

From monorepo root (after `npm run platform:dev:prepare`):

```bash
cd examples/platform-rpg-starter
npm install
npm run dev
```

## What it demonstrates

- `src/scenes/*Scene.ts` registered via `bootstrap({ extraScenes })`
- `public/game.json` only holds meta/assets/dialogue[] — no fake `gameFlow`
- `TurnManager` + `DialogueManager` imported in Battle/Chapter scenes

Copy this layout when testing platform `PLATFORM_PROJECT_SCAFFOLD_MODE=engine`.
