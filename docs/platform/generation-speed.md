# Generation speed: progressive gates, deterministic fixes, caches

Why a `generate` job used to take 15–40 minutes and "kept attempting", and what
changed.

## Root causes

1. **Every gate ran at full strictness from round 1.** `PLATFORM_GAME_QUALITY_MODE=strict`
   plus `PLATFORM_QUALITY_BEYOND_BASELINE` plus `PLATFORM_SMOKE_REQUIRE_PROGRESS`
   meant round 1 had to satisfy art direction, audio authenticity, win-path
   detection and smoke progress simultaneously. One miss restarted a whole CLI
   Agent round.
2. **One-character TypeScript errors cost a full Agent round.** `TS2554`
   (`lineStyle(color)`), `TS2779` (optional-chain assignment), `TS18047` /
   `TS2531` null guards were passed to the model as *prompt hints*.
3. **Each round redid heavy work.** The linked `packages/runtime` was rebuilt on
   every `validateBuild`, Playwright re-ran against byte-identical `dist/`, and
   the MiniMax asset phase re-probed unchanged PNGs.
4. **The attempt count was the only brake**, so a job's cost was unbounded in
   wall-clock terms.

## What runs now

### Progressive gate tiers (`PLATFORM_GATE_ESCALATION`)

| tier | checks | outcome |
|------|--------|---------|
| `baseline` | `game.json` DSL, entry-only `tsc`, `vite build`, canvas smoke, ChangePlan intent, juice baseline | preview is **published immediately** (`PREVIEW` agent phase) and the job is treated as delivered |
| `quality` | everything the env asks for: `strict`, beyond-baseline art/audio, smoke progress signals | preview is republished on success |

- `progressive` (default) stays on `baseline` until a playable build ships, then
  escalates for the remaining budget.
- A failed escalation round can never revoke the preview the user is already
  playing: the job still succeeds and `jobs.result.reachedTargetGateTier` is
  `false`.
- Real-asset policy is **not** relaxed by the baseline tier — `requireRealAssets()`
  is pinned so placeholders still cannot pass.
- `strict-first` restores the old behavior for regression hunting.

Implementation: `apps/platform-worker/src/gateEscalation.ts`.

### Deterministic codemods before the Agent

`apps/platform-worker/src/deterministicFix.ts` parses `tsc` diagnostics and
applies line/column-targeted edits:

| code | edit |
|------|------|
| `TS2554` on `lineStyle` | `lineStyle(color)` → `lineStyle(2, color)` |
| `TS2779` | `a?.b.c = v` → `a!.b.c = v` |
| `TS18047` / `TS18048` | bangs the expression tsc names in the message |
| `TS2531` / `TS2532` | recovers the property-access receiver at the column and bangs it |
| `TS2741` (`Vector2Like`) | completes the missing `x` / `y` |

Up to two passes run after a failed build, each followed by a re-validate. Only
when the compiler still complains do we spend an Agent round. The timeline
distinguishes the two: `deterministic-codemod` versus `opengame-cli`.

### Fingerprint caches

`apps/platform-worker/src/buildCache.ts`, all mtime/size based:

- **Linked runtime rebuild** — skipped when `dist/index.d.ts` exists and the
  recorded source fingerprint matches (marker lives in the runtime's own `dist/`).
- **Playability smoke** — keyed by `dist` fingerprint **and** gate tier, because
  identical bytes can legitimately pass `baseline` and fail once progress signals
  are required.
- **MiniMax asset top-up** — when neither `public/assets/*` nor the DSL moved, the
  pre-smoke pass degrades to `patchOnly` wiring.

Caches live in `<workspace>/.opengame-cache/` and are excluded from the S3
workspace archive so another worker never inherits a stale verdict.

### Time budget instead of a fixed attempt count

`apps/platform-worker/src/generationBudget.ts`:

- `PLATFORM_GENERATION_TIME_BUDGET_MS` (default `900000`) bounds the whole loop.
  When it is spent we stop opening rounds; if a playable baseline exists we
  deliver it and say so, otherwise the job fails.
- `PLATFORM_CLI_TIMEOUT_MS` caps round 1 (CODE). FIX rounds decay to about
  `base / 3` then `base / 4`, floored at 120s, and are clamped to the budget left.

## Recommended settings

```dotenv
PLATFORM_MAX_FIX_ITERATIONS=4
PLATFORM_GATE_ESCALATION=progressive
PLATFORM_GENERATION_TIME_BUDGET_MS=900000
PLATFORM_CLI_TIMEOUT_MS=720000
# keep the top bar — escalation decides when it applies
PLATFORM_GAME_QUALITY_MODE=strict
PLATFORM_QUALITY_BEYOND_BASELINE=true
PLATFORM_SMOKE_REQUIRE_PROGRESS=true
```

Restart `platform:dev` / the worker after editing these.
