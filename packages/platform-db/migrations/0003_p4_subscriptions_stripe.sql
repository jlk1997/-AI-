-- 0003_p4_subscriptions_stripe.sql
-- Adds Stripe billing fields and quota override columns to the subscriptions
-- table. All additions are nullable / have defaults so existing rows continue
-- to work without backfill.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_price_id text,
  ADD COLUMN IF NOT EXISTS daily_job_limit_override integer,
  ADD COLUMN IF NOT EXISTS max_concurrent_jobs_override integer,
  ADD COLUMN IF NOT EXISTS current_period_end timestamp with time zone,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

-- Stripe stores the customer id as a global key — keep it unique to make
-- `customer.subscription.*` webhook handlers a constant-time lookup.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_customer_id_uq
  ON subscriptions (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_subscription_id_uq
  ON subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
