# @opengame/platform-db

Drizzle schema and SQL migration for the hosted platform (users, organizations, projects, jobs, artifacts, deployments, usage, subscriptions, project members, template packages, bench runs).

## Migrate

```bash
PLATFORM_DATABASE_URL=postgresql://... npm run migrate --workspace=@opengame/platform-db
```

## Build

```bash
npm run build --workspace=@opengame/platform-db
```

Consumers (`platform-api`, `platform-worker`) resolve this package via `dist/`; build this workspace before typechecking or running those apps.
