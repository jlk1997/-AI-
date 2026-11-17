# Worker Pool, Workspace Externalization & Stripe Billing (P4)

Status: in-progress (P4 / 24-month plan)

This document covers the three P4 deliverables that unblock horizontal scaling
and commercial launch:

1. **Worker pool** — multiple `platform-worker` replicas consuming the same
   BullMQ queue with bounded per-process concurrency.
2. **Workspace externalization** — content-addressed S3 archive of every
   project's workspace so any worker can resume on any project without local
   affinity.
3. **Stripe webhook + plan-aware quotas** — signed webhook events sync
   subscriptions into Postgres, and `assertCanEnqueueJob` uses the
   org's plan (with optional row-level overrides) to gate work.

---

## 1. Worker pool & concurrency

`apps/platform-worker/src/index.ts` now reads `PLATFORM_WORKER_CONCURRENCY`
(default `1`) and forwards it to BullMQ's `Worker` constructor. The Redis
connection used by `Worker` is separate from the queue connection and the
publisher connection so subscriber state never bleeds across components.

Operationally:

* Run N replicas of the worker process; BullMQ's distributed lock guarantees
  each job is processed exactly once.
* Set `PLATFORM_WORKER_CONCURRENCY=2..8` per replica based on the CPU budget
  of the underlying VM. The bottleneck for generate jobs is `npm install` +
  `vite build` (single-threaded-ish), so 2–4 per replica is a sane default.

There is no project affinity. Multiple jobs for the same project can land on
different workers; workspace externalization (below) handles the data plane.

## 2. Workspace externalization

### Why
Before P4 each worker held the only copy of `${PLATFORM_WORK_ROOT}/projects/${id}/repo`.
That coupled the queue to host identity and broke the pool model.

### Design
Each project workspace is persisted as a manifest of content-addressed S3
objects under `${PLATFORM_WORKSPACE_ARCHIVE_PREFIX}/projects/${id}/`:

```text
${prefix}/projects/${id}/manifest.json
${prefix}/projects/${id}/blobs/${sha256}
```

The manifest schema (v1):

```jsonc
{
  "version": 1,
  "savedAt": "2026-05-13T05:30:00Z",
  "files": {
    "package.json": { "sha256": "...", "size": 1234, "mode": 33188 },
    "src/main.ts":  { "sha256": "...", "size":  890, "mode": 33188 }
  }
}
```

Why content addressing instead of a tarball:

* `node_modules` is excluded entirely (re-installed locally), so the archive is
  only the source tree — content-addressed blobs give us free deduplication for
  unchanged files between jobs.
* No native `tar` dependency: pure node + `@aws-sdk/client-s3`.
* Manifest is trivially diff-able in the S3 console for postmortems.

Always-excluded directories: `node_modules`, `.git`, `dist`, `.cache`, `.turbo`.

### Flow
* Before scaffolding (`ensureScaffold`): if `PLATFORM_WORKSPACE_ARCHIVE_PREFIX`
  is set and `package.json` doesn't exist locally, attempt
  `restoreWorkspaceFromS3`. On success we skip scaffolding entirely.
* After a successful generate FSM run we call `saveWorkspaceToS3` (best-effort —
  failure here is logged but doesn't fail the user-visible job because the
  preview is already deployed).

When archive mode is off (no env var set) the worker behaves exactly as before.

## 3. Stripe webhook & plan-aware quotas

### Schema delta (`0003_p4_subscriptions_stripe.sql`)
Adds to `subscriptions`:

* `stripe_subscription_id`, `stripe_price_id` — sync targets for Stripe.
* `daily_job_limit_override`, `max_concurrent_jobs_override` — per-org escape
  hatches that override plan defaults without redeploying.
* `current_period_end`, `cancel_at_period_end` — mirrors of Stripe.
* `updated_at` — for ordering.
* Partial unique indexes on `stripe_customer_id` and `stripe_subscription_id`
  so webhook handlers stay O(1).

### Webhook (`POST /webhooks/stripe`)
* Verifies the `Stripe-Signature` HMAC with `verifyStripeSignature` (no
  Stripe SDK dependency — see `apps/platform-api/src/lib/stripe.ts`).
* Handles `customer.subscription.{created,updated,deleted}`.
* Resolves the target org via existing `stripe_customer_id` row, falling back
  to `metadata.organization_id` on the customer object. If both fail we log
  and 200-out so Stripe stops retrying.
* `plan` is derived from `PLATFORM_STRIPE_PRICE_MAP` (e.g.
  `price_pro_monthly:pro,price_studio_yearly:studio`).

### Quota resolution (`resolveOrgQuota`)
Used by both `assertCanEnqueueJob` and the new `GET /billing/quota` endpoint:

1. Read the org's `subscriptions` row.
2. Compute `plan = sub.status == 'active' ? sub.plan : 'free'`.
3. `dailyJobLimit = sub.dailyJobLimitOverride ?? PLAN_DAILY[plan] ?? envDefault`.
4. `maxConcurrent  = sub.maxConcurrentJobsOverride ?? PLAN_CONCURRENCY[plan] ?? envDefault`.

This means **plan changes via Stripe webhook take effect on the next job
enqueue** without any cache invalidation step.

### New billing endpoints
| Verb | Path                | Purpose                                |
|------|---------------------|----------------------------------------|
| GET  | `/billing/plans`    | Public plan catalog (id, limits)        |
| GET  | `/billing/quota`    | Caller-org-effective quota              |
| POST | `/billing/link`     | Pre-link a Stripe Customer to the org   |

The CLI / web app uses `/billing/link` after creating the Stripe Customer in
Stripe Checkout. Once linked, every subscription event automatically updates
the org without us caring about `metadata.organization_id`.

---

## 4. Required env vars (P4-introduced)

```bash
# Worker pool
PLATFORM_WORKER_CONCURRENCY=4
# Workspace externalization (set both to enable):
PLATFORM_WORKSPACE_ARCHIVE_PREFIX=opengame/workspaces

# Stripe billing (set all three for prod):
PLATFORM_STRIPE_API_KEY=sk_live_...
PLATFORM_STRIPE_WEBHOOK_SECRET=whsec_...
PLATFORM_STRIPE_PRICE_MAP=price_pro_monthly:pro,price_studio_yearly:studio

# Plan limits (otherwise fall back to PLATFORM_DAILY_JOB_LIMIT_PER_ORG):
PLATFORM_PLAN_DAILY_LIMITS=free:50,pro:5000,studio:50000
PLATFORM_PLAN_CONCURRENCY_LIMITS=free:2,pro:8,studio:32
```

## 5. Rollout plan

1. Apply migration `0003_p4_subscriptions_stripe.sql`.
2. Deploy API/worker with the new code; archive mode and Stripe stay disabled
   until the env vars are set. Behavior is byte-compatible with P3 in this
   "dark launch" mode.
3. Enable workspace archive in staging; verify a cold-start worker can
   recover a project's workspace from S3 within ~5 seconds for typical sizes.
4. Configure Stripe products + prices, set `PLATFORM_STRIPE_PRICE_MAP`,
   register the webhook URL at `https://api.example.com/v1/webhooks/stripe`,
   and flip the flag in production.

## 6. Out of scope (deferred to P5+)
* Stripe Checkout Sessions / Customer Portal — we keep the API surface
  minimal; the IDE can embed `stripe-buy-button` or use the Stripe Hosted
  Checkout against the customer id stored via `/billing/link`.
* Usage-based metering (per-token / per-minute). The model events are already
  in `usage_events`; ingestion into Stripe's Meter API is a P5 stretch goal.
