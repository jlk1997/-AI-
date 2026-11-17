# @opengame/platform-worker

BullMQ worker on queue `platform`. It runs **OpenGame CLI** in an isolated workspace, then **npm ci** + **npm run build**, uploads `dist/` and logs to S3, and records deployments. **Bench** runs `PLATFORM_BENCH_COMMAND` when set, otherwise the workspace `test:ci` / `test` script.

Provider keys and MiniMax multi-modal behavior live in **@opengame/opengame-core** (same as local CLI). Set `PLATFORM_OPENGAME_PROVIDER_PREFLIGHT=minimax` (or `all`) to fail fast before spawn when env is incomplete; see `docs/platform/opengame-minimax-one-stop.md`.

## Run

```bash
npm run dev --workspace=@opengame/platform-worker
```

Use the same `PLATFORM_*` infrastructure variables as the API (database, Redis, S3), plus paths from `.env.example` (`PLATFORM_WORK_ROOT`, `PLATFORM_OPENGAME_CLI`, template and docs dirs).
