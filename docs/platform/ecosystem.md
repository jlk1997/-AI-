# Ecosystem: Public API, Plugin Marketplace, Public Bench Leaderboard & i18n (P5)

Status: **API present, UI default-hidden** (`VITE_SHOW_ECOSYSTEM`). Path SSOT: [public-api-map.md](./public-api-map.md).

> Older drafts said `/public/*`. The live mounts are `/v1/public/*` (product) and `/api/public/*` (embed).

P5 turns OpenGame from a closed creator IDE into an open ecosystem. The four
deliverables in this phase are intentionally independent so each can ship
behind its own flag once production traffic warrants it.

---

## 1. Public open API

We expose a small set of **unauthenticated**, CORS-friendly endpoints under
`/public/*`. They are aggressively cached at the CDN (we set
`Cache-Control: public, max-age=60, s-maxage=300` on every response) and never
mutate user state.

| Verb | Path                                  | Purpose                                  |
|------|---------------------------------------|------------------------------------------|
| GET  | `/public/bench`                       | Public bench-leaderboard runs            |
| GET  | `/public/games/:slugOrId/embed`       | Embed metadata + iframe URL for a game   |
| GET  | `/public/plugins`                     | Search public plugins                    |
| GET  | `/public/plugins/:slug`               | Plugin detail + versions                 |

Embed URLs are only returned when a CDN base or a verified custom domain is
present — presigned URLs would expire mid-session, which makes them unsuitable
for embed scenarios.

External integrators do **not** need an API key for these endpoints. Internal
write endpoints continue to require a session JWT (issued via `/auth/dev-token`
or, in production, the upcoming OAuth flow).

## 2. Plugin marketplace

### Schema (`0004_p5_ecosystem.sql`)
* `plugin_packages` — one row per `slug` (owner = `organization_id` +
  `author_user_id`).
* `plugin_versions` — many-to-one against `plugin_packages`, unique on
  `(plugin_id, version)`. Each version persists `storage_key` (S3 tarball),
  `sha256` (integrity check), an optional semver `runtime_peer_range`, and a
  JSON `manifest` summarizing exported behaviors / skill kinds.

### API
| Verb | Path                          | Auth   | Purpose                              |
|------|-------------------------------|--------|--------------------------------------|
| POST | `/plugins`                    | JWT    | Reserve a slug + create the package  |
| POST | `/plugins/:slug/versions`     | JWT    | Publish a new version                |
| POST | `/plugins/:slug/install`      | JWT    | Bumps `install_count` (analytics)    |
| GET  | `/public/plugins`             | public | Search                               |
| GET  | `/public/plugins/:slug`       | public | Detail + version history             |

Tarballs are uploaded out-of-band via presigned PUTs. The publish wizard in
`platform-web` (forthcoming) computes the sha256 locally, hits the presigned
PUT, then calls `/plugins/:slug/versions` with the storage key. Server-side
we never trust the client's manifest — a future P5 enhancement will re-extract
the tarball into an isolated sandbox to validate exports.

### Frontend
`apps/platform-web/src/pages/Plugins.tsx` shows a paginated grid of plugins
with full-text-ish search (case-insensitive `slug` / `name` LIKE) and an
**Install** button that bumps the install counter and is intended to drive
future "Add to project" flows.

## 3. Public Bench leaderboard

The existing `bench_runs` table now carries `is_public` + `public_label`.
Authors can flip a run public via `POST /bench-runs/:id/publish`. The public
catalog lives at `GET /public/bench` and is sorted by `createdAt DESC` for the
MVP — future iterations will derive a composite score sort once the bench
runner emits a canonical headline metric.

`apps/platform-web/src/pages/BenchBoard.tsx` renders the leaderboard with a
top-3-metric summary per row, suitable for showcasing the platform's
"诚实失败" stance: real numbers, no curated marketing data.

## 4. Internationalization (i18n)

We introduce a minimal in-house i18n shim at
`apps/platform-web/src/services/i18n.ts`. We deliberately avoid pulling in
`i18next` — the platform-web UI ships < 200 user-facing strings, and a
hand-maintained dictionary is the right tool until we cross 1000+ strings or
need pluralization rules.

### Highlights
* `t(key, vars?)` — runtime lookup with `{var}` interpolation.
* `useT()` — React hook that re-renders consumers when the locale changes.
* `setLocale('en'|'zh-CN')` — persists to localStorage and switches Ant
  Design's component locale (`enUS` / `zhCN`).
* Auto-detects from `navigator.language` (falls back to `en`).
* Missing-key fallback returns the key itself so translators see the surface
  area in dev mode.

### Supported locales (P5 MVP)
* `en` — authoritative source.
* `zh-CN` — the original site language. Existing in-file Chinese strings stay
  put for backward compatibility; new strings should use `t('...')`.

### Where to add new strings
Edit both `en` and `zh-CN` dictionaries in
`apps/platform-web/src/services/i18n.ts`. Adding a language is a one-line
change (append a new entry to `DICTIONARIES`); we recommend starting with `ja`
and `ko` once the community signals demand.

---

## 5. Out of scope (deferred to P6+)
* Server-side rendered embed pages (currently the embed endpoint returns JSON
  metadata; the host site builds the iframe).
* OAuth / API-key issuance for partner integrations (we'll need rate limits,
  scopes, and audit logs before opening this beyond signed JWTs).
* Full-text plugin search (Postgres `tsvector` index) — current LIKE query is
  sufficient until ~10K plugins.
* Locale negotiation per project (currently the locale is global to the UI;
  generated games carry their own locale strings independently).
