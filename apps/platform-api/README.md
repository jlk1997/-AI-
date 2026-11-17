# @opengame/platform-api

HTTP BFF for the hosted platform: dev auth, projects, chat messages (enqueue `generate` jobs), deployments, preview presigns, usage, Stripe webhook stub + static billing plans, templates, project members, and bench job enqueue. Product gaps and roadmap: `docs/platform/strategic-roadmap-and-gaps.md`.

## Run

Requires Postgres, Redis, MinIO, and env vars (see repo root `.env.example` section **Hosted platform**).

```bash
npm run migrate --workspace=@opengame/platform-db
npm run dev --workspace=@opengame/platform-api
```

Build `@opengame/platform-db` first so `dist/` exists for workspace resolution (`npm run build --workspace=@opengame/platform-db`).
