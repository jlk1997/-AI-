# OpenGame-Bench MVP

The paper's 150-prompt public pipeline is **not** a separate framework yet.
This folder is the honest MVP: the same gates the worker already runs.

## What ships

| Artifact | Command / path |
|----------|----------------|
| Build + playability smoke | `apps/platform-worker` playability + quality gates |
| Multi-turn ChangePlan | `npm run quality:multiturn-smoke` |
| Blind scorecard | `npm run quality:blind-scorecard` |
| Eval needles | `npm run quality:eval-smoke` |
| Society promises | `npm run quality:society-promises` |
| Golden 8 prompts | [golden-prompts.json](./golden-prompts.json) |

## How to run a local bench job

Set `PLATFORM_BENCH_COMMAND` to a real command (for example `npm run quality:eval-smoke`).
If the variable is unset, the platform `bench` job **fails**. No fake scores.

## Release bar

A public OpenGame-Bench drop must include: this README, the golden prompt set,
the smoke scripts, and a note that VLM judging is optional — not a silent mock.
