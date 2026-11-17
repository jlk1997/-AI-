# Public API map (SSOT)

Two public surfaces exist on purpose. Do not add a third.

| Surface | Mount | Audience | CORS |
|---------|-------|----------|------|
| **Product public** | `/v1/public/*` | Players, WeChat, pay notify, play-url, share cards | Same as `/v1` (web origins in production) |
| **Embed / ecosystem** | `/api/public/*` | Third-party sites, API keys, `/embed.js` | `origin: *` (embed needs it) |

## `/v1/public/*` (product)

Typical paths: play-url, share-card, WeChat JS-SDK, phone/WeChat auth, pay notify, billing catalog, community challenges, tonight alley charts (`GET /v1/community/alley` — hottest/remixed are China-day `community_day_stats`, living is the social clock), official/community template catalog (`GET /v1/public/templates?channel=official`). Studio pin/apply uses authed `GET|POST /v1/templates`. Full job logs: authed `GET /v1/jobs/:id/log` (API proxies S3). Workspace snapshot / build cache / dead-letter requeue: authed `GET /v1/projects/:id/workspace-archive`, `GET .../build-cache`, `POST .../dead-letters/:id/requeue`. Collaborators: authed `GET /v1/orgs`, `GET|POST /v1/projects/:id/members` (invite writes `organization_members`). Standalone build: authed `POST /v1/projects/:id/build`. `GET /v1/projects` with no org (or `organizationId=all`) lists every game across the caller’s memberships. Invite deep links: `/play/:slug?invite={handle}` (SPA stores the handle and `POST /v1/billing/invite` claims it after login). Play-url issues at most 40 sessions/hour/IP.

Crawler OG: WeChat and other unfurl bots do not run the SPA. In production, proxy `{web}/play/:slug` for crawler User-Agents (MicroMessenger, Weibo, Slackbot, facebookexternalhit) to `GET /v1/public/games/:slug/share.html`. Copy-paste Caddy/nginx: [share-og-proxy.md](./share-og-proxy.md). Vite `shareOgPlugin` only covers `vite` / `vite preview`. Play-url and visit share IP+user hit keys so guest-then-login does not double-count tonight's chart. Dead-letter / failed-job retry claims the source row once (`result.requeuedTo`) and re-checks org quota inside that claim. One dead-letter row per job (`0030`). Studio shows an author alert without requiring `PLATFORM_ALERT_WEBHOOK_URL`. Concurrent world restore / presentation persist returns **409** when `tipRevision` moved; the loser is not charged.

Session JWT is **not** required for these. Pay notify verifies provider signatures.

## `/api/public/*` (embed)

Typical paths: games list/embed, leaderboard, plugins, bench leaderboard, `whoami`.

Auth: anonymous (tight IP rate limit) or `X-API-Key` / Bearer key.

## Deprecated aliases

Older docs mentioned `/public/*` without a prefix. That path is **not** mounted. Use `/v1/public` or `/api/public`.

`GET /v1/public/plugins` remains as a convenience alias of the embed catalog. New clients should call `/api/public/plugins`.

Half-finished plugin / bench **UI** is hidden unless `VITE_SHOW_ECOSYSTEM=true`.
