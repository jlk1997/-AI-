-- Money and identity for the China-first release.
--
-- Billing used to be a Stripe-shaped hole: `subscriptions` stored Stripe ids and
-- quota counted job rows. Neither can express "I paid 30 yuan in WeChat and got
-- 500 generation points", which is the only transaction most of our users will
-- ever make. So payment becomes a ledger: a wallet per organisation, one signed
-- row per movement, and orders that any provider can settle.
--
-- Sign-in gets the same treatment. A WeChat user has no email, so `users.email`
-- becomes nullable and openid/unionid/phone join it as alternative identities.

ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS wechat_openid TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wechat_unionid TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wechat_openid
  ON users (wechat_openid) WHERE wechat_openid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wechat_unionid
  ON users (wechat_unionid) WHERE wechat_unionid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone
  ON users (phone) WHERE phone IS NOT NULL;

-- Stripe stays wired for a later overseas release, but it is no longer the
-- shape of the table.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'stripe';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider_customer_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT;
-- Points handed out each period by this plan; null means "use the plan default".
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS monthly_points INTEGER;
-- Guards against granting the same period twice when a webhook is redelivered.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS points_granted_for TEXT;

/*
 * One row per organisation. `balance` is the only number the request path reads,
 * and it is only ever moved by a conditional UPDATE, so two concurrent jobs
 * cannot both spend the last point.
 */
CREATE TABLE IF NOT EXISTS wallets (
  organization_id UUID PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0,
  lifetime_earned INTEGER NOT NULL DEFAULT 0,
  lifetime_spent INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wallets_balance_non_negative CHECK (balance >= 0)
);

/*
 * Orders are provider-agnostic on purpose. WeChat JSAPI, WeChat MWEB and Alipay
 * WAP differ only in `channel` and in what we stash in `prepay`; settlement,
 * idempotency and the resulting ledger entry are identical.
 */
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  channel TEXT NOT NULL,
  -- Our id at the provider. Unique so a redelivered notify cannot double-credit.
  out_trade_no TEXT NOT NULL UNIQUE,
  transaction_id TEXT,
  sku TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  points INTEGER NOT NULL DEFAULT 0,
  plan TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  paid_at TIMESTAMPTZ,
  prepay JSONB,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT orders_kind_check CHECK (kind IN ('points', 'subscription')),
  CONSTRAINT orders_status_check
    CHECK (status IN ('created', 'paid', 'failed', 'closed', 'refunded'))
);

CREATE INDEX IF NOT EXISTS idx_orders_org ON orders (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status, created_at DESC);

/*
 * Every movement of points, signed, with the balance it produced. This is what
 * a creator sees on the wallet screen, and what a remix royalty dispute is
 * settled from — so it is append-only by convention: corrections are new
 * `adjust` rows, never edits.
 */
CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  points INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  job_id UUID REFERENCES jobs (id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders (id) ON DELETE SET NULL,
  -- For royalties: the wallet the points came from.
  source_organization_id UUID REFERENCES organizations (id) ON DELETE SET NULL,
  community_game_id UUID REFERENCES community_games (id) ON DELETE SET NULL,
  note TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entries_kind_check
    CHECK (kind IN ('topup', 'grant', 'spend', 'refund', 'royalty', 'tip', 'adjust'))
);

CREATE INDEX IF NOT EXISTS idx_ledger_org
  ON ledger_entries (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_job ON ledger_entries (job_id);

-- Existing organisations get a wallet so the request path never has to branch
-- on "row missing" versus "zero balance".
INSERT INTO wallets (organization_id)
SELECT id FROM organizations
ON CONFLICT (organization_id) DO NOTHING;
