# Ecosystem, Plugin Market, Bench Public Board, i18n & Perf (P5)

Status: **partial** — API surfaces exist; plugin / bench / developer **UI is hidden** unless `VITE_SHOW_ECOSYSTEM=true`. Public path SSOT: [public-api-map.md](./public-api-map.md). Honest gap list: [strategic-roadmap-and-gaps.md](./strategic-roadmap-and-gaps.md).

P5 shipped the *schema and routes*. Treat marketplace install and custom-domain TLS as unfinished.

P5 closes the 24-month roadmap by exposing the platform to the outside world
and tightening the inside loop:

| Workstream            | What ships                                                         |
|-----------------------|--------------------------------------------------------------------|
| Public Ecosystem API  | `/api/public/*`, API keys, `/embed.js`, `@opengame/embed`           |
| Plugin Marketplace    | `plugin_packages` / `plugin_versions` + Developer Hub UI            |
| Public Bench Board    | `is_public` + `public_label` on `bench_runs`, replayable detail API |
| i18n                  | zh-CN + en-US dictionaries, runtime locale switch, error-code map   |
| Perf & UX             | Redis response cache, lazy routes, debounced search, AI prompt v2   |

---

## 1. Public Ecosystem API

Mounted at **`/api/public/*`** (separate from `/v1/*` so we can give it
distinct CORS, rate limit, and auth rules).

### Auth
| Mode      | How                                | Limit (default)        |
|-----------|------------------------------------|------------------------|
| Anonymous | No header                          | 30 req / min / IP      |
| API key   | `X-API-Key: og_pk_…` or `Bearer …` | `rateLimitPerMinute`   |

API keys are minted via `POST /v1/api-keys` (the raw secret is shown **once**;
we only store sha256). Each key has `scopes`: `embed:read`, `leaderboard:write`,
`plugins:read`, `bench:read`, or `*`.

### Endpoints
| Verb | Path                                  | Auth        |
|------|---------------------------------------|-------------|
| GET  | `/api/public/games`                   | none        |
| GET  | `/api/public/games/:slug/embed`       | none        |
| GET  | `/api/public/games/:slug/leaderboard` | none        |
| POST | `/api/public/games/:slug/leaderboard` | scope       |
| GET  | `/api/public/games/:slug/ratings`     | none        |
| GET  | `/api/public/plugins`                 | none        |
| GET  | `/api/public/plugins/:slug`           | none        |
| GET  | `/api/public/bench/leaderboard`       | none        |
| GET  | `/api/public/bench/runs/:id`          | none        |
| GET  | `/api/public/whoami`                  | key (diag.) |

Every response includes `X-RateLimit-{Limit,Remaining,Reset}` and is wrapped in
the shared `{ error, code, details }` envelope on failure.

### `/embed.js` SDK
3rd parties drop one tag into their HTML; the SDK hydrates all
`[data-opengame]` nodes:

```html
<div data-opengame="flappy-2026" data-width="800" data-height="600"></div>
<script src="https://api.opengame.dev/embed.js" defer></script>
```

For framework users, the `@opengame/embed` package exposes:
- `attachEmbed(el, slug, opts)` — vanilla
- `<OpenGameEmbed slug=".." />` — React

## 2. Plugin Marketplace

### Data model
- `plugin_packages` — slug, org, latest version, install count, tags, visibility.
- `plugin_versions` — version, S3 key, sha256, manifest, runtime peer range.

`(plugin_id, version)` is unique. Versions are **immutable** once published.

### Publishing flow
1. `POST /v1/plugins` to reserve a slug.
2. `POST /v1/plugins/:slug/upload` returns the canonical `storageKey`
   (`plugins/<slug>/<version>.tgz`).
3. CI uploads the tarball directly to S3 with worker creds.
4. `POST /v1/plugins/:slug/versions` registers `{version, storageKey, sha256, manifest, runtimePeerRange}`. `latestVersion` auto-bumps.
5. `POST /v1/plugins/:slug/install` increments `installCount` (used by the
   public listing's "Top plugins" sort).
6. `DELETE /v1/plugins/:slug` soft-unpublishes (`isPublic=false`) without
   freeing the slug.

The Developer Hub page (`/developer`) gives org owners a UI for the whole
flow + API key management.

## 3. Bench Public Leaderboard

`bench_runs` now carries `is_public` and `public_label`. Workers emit
structured scores by parsing the **last** JSON object printed on stdout by
`PLATFORM_BENCH_COMMAND`. We keep the "honest failure" rule: if the env var
isn't set, the bench job throws — no placeholder numbers.

Reproducibility hooks:
- Each row links `jobId` so the original logs are recoverable.
- `seed`, `label`, and the parsed scoring object travel together in `scores`.
- The public detail endpoint (`/api/public/bench/runs/:id`) returns the same
  shape used in the `/bench` UI's "row click → drawer" flow.

## 4. Internationalization

`apps/platform-web/src/services/i18n.ts` is a 5kb shim — zero deps, runtime
locale switching, and a `translateApiError()` helper that maps backend
`code` values to the dictionary.

Currently supported locales: `en`, `zh-CN`. Adding a new locale = drop a new
dictionary into `DICTIONARIES`.

The backend cooperates by emitting **stable codes**:
```json
{ "error": "Concurrent job limit reached (plan=free, limit=2)",
  "code":  "QUOTA_EXCEEDED",
  "details": { "plan": "free" } }
```

Codes are defined in `apps/platform-api/src/lib/errorCodes.ts`. Adding a
new code is a minor bump; removing one is a major.

## 5. Performance & UX hardening

### Backend
- `cacheJson(redis, key, ttl, producer)` helper backs the "hot read"
  endpoints (`/games`, `/plugins`, `/bench/leaderboard`) — typical TTL is
  30–60s. Same Redis used for the rate-limit window so we don't open more
  connections.
- Public endpoints set `Cache-Control: public, max-age=30, s-maxage=120` so
  a CDN can absorb the rest.

### Frontend
- Secondary routes (`/community`, `/profile`, `/developer`, `/plugins`,
  `/bench`) are now `React.lazy` — first paint of the IDE no longer ships
  the Monaco / Plugin Hub bundles.
- `useDebouncedValue` removes per-keystroke queries from the plugin search.
- Skeleton fallback (`<Spin>`) wraps the lazy `<Suspense>` so we never see
  a blank page during route navigation.

### AI satisfaction
Bigger wins than infrastructure work:
1. **Capability catalog** is now part of the system prompt (`SKELETON_CONTRACT`),
   so the AI immediately knows what's available in `@opengame/runtime` and
   stops re-inventing common behaviors.
2. **FIX-loop prompt v2** tells the AI exactly which files to keep stable
   and re-iterates the catalog, drastically reducing "regenerate the whole
   project" rewrites that thrash the build.
3. **Tighter error tails** (1.5KB per stream vs 4KB) reduce token cost per
   self-heal iteration without hurting localization of the failure.

## 6. Required env vars (P5)

```bash
# Nothing strictly *required* — every P5 feature is gated:
# - API keys: just create rows.
# - Embed SDK: works without auth.
# - Plugin marketplace: needs S3 (already configured for artifacts).
# - i18n: client-side toggle, no server config.
# - Cache: uses the same redis as BullMQ.

# Optional overrides:
PLATFORM_PUBLIC_BASE_URL=https://api.opengame.dev   # used to compute embed URLs + iframe src in `/embed.js`
```

## 7. What's intentionally left for v2

| Item                                          | Why deferred                           |
|-----------------------------------------------|----------------------------------------|
| Plugin runtime loader (`<script>` injection)  | Needs CSP review per host page         |
| Stripe Checkout Session helper                | Most users embed Stripe Buy Button now |
| Search ranking (BM25 / pgvector)              | Linear scan is fine < 10k plugins      |
| Webhook-based plugin install metrics          | Pull-based install count is sufficient |
| OpenAPI spec emission                         | Hono v4 has experimental support — wait |
