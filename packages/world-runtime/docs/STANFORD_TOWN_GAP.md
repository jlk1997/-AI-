/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Architecture note: Society sim vs Phaser map were dual-track until the
 * Stanford-town unified stage (SocietyReplayScene + society_replay.json).
 *
 * Before: Observatory (DB timeline) ⊥ Map roam (Spec RPG) — no shared poses.
 * After: Map iframe plays society events; inspector is a side panel only.
 */

# Stanford Town gap (resolved in code)

## Problem
World felt like a cheap RPG template because generative-agent life lived only in
the React Observatory dashboard, while the Phaser presenter played a frozen Spec
quest game. Fast-forward wrote Postgres; the map never read it.

## Acceptance checklist
- [x] World generate → right stage shows town map with named residents (not text-only dashboard).
- [x] Fast-forward → agents move + dialogue bubbles on map (postMessage hot-reload).
- [x] Click agent → side inspector memories; whisper → recompute from **playback cursor** (not fromSimTime=0).
- [x] Direct preview-dist URL defaults to `?mode=observe` (SocietyReplayScene).
- [x] `?mode=play` keeps legacy RPG roam for debug only.
- [x] `society_replay.json` written before vite build + mirrored to S3; API sync run/intervene republishes.
- [x] Spec SSOT defaults to `createSocietyTownWorld` (no ore/wolf win-loop); quality/depth pads NPCs not enemies.
- [x] Planner system prompt prefers schedules/gossip over mandatory quests/enemies.

## Stage presentation (second pass)
The unified stage played the right data but read wrong: the map sat letterboxed
inside a black frame, every line of a tick popped at once and then never left,
and residents were letter blobs that twitched a tile back and forth.

- [x] Canvas fills the panel: observe mode scales with `RESIZE`, and the world
      camera zooms to the map (`cameraFit.ts`) instead of leaving bars. A second
      camera carries the HUD so chrome stays put while the world zooms.
- [x] One line at a time: a tick's turns are laid out on a wall clock
      (`speechSchedule.ts`) — serial inside a conversation, staggered between
      concurrent ones — so speaking order is legible.
- [x] Bubbles expire on reading time, and the parent caption follows whichever
      line is currently on screen rather than the newest row of the log.
- [x] Residents get procedural four-direction walk sheets
      (`characterSprite.ts`) when the art pipeline produced no atlas.
- [x] No more snap-back: authoritative position is decided per resident, so a
      trail being replayed is not overwritten by the live roster.
- [x] Sim side matches: arrival parks on a stable spot instead of re-rolling a
      random offset each tick, and crowd gravity needs a clear margin before it
      redirects somebody mid-walk (`anchors.ts`, `tick.ts`).

## Key files
- `SocietyTownStage.tsx` — unified stage + cursor-aware intervene
- `SocietyReplayScene.ts` — map replay + postMessage protocol
- `ui/cameraFit.ts`, `ui/speechSchedule.ts`, `ui/characterSprite.ts` — stage presentation
- `societyReplayExport.ts` (worker/api) — artifact publish
- `worldPipeline.ts` — seed → public replay → build → upload
