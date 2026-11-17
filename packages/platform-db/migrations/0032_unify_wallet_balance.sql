-- One wallet column. 加戏包 / 巷议包 fold into 开镇礼.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'wallets'
      AND column_name = 'jiaxi_balance'
  ) THEN
    INSERT INTO ledger_entries (organization_id, kind, points, balance_after, note, meta)
    SELECT
      organization_id,
      'adjust',
      jiaxi_balance + xiangyi_balance,
      balance + jiaxi_balance + xiangyi_balance,
      '并栏：加戏包与巷议包并入点数',
      jsonb_build_object(
        'fromJiaxi', jiaxi_balance,
        'fromXiangyi', xiangyi_balance
      )
    FROM wallets
    WHERE jiaxi_balance > 0 OR xiangyi_balance > 0;

    UPDATE wallets
    SET
      balance = balance + jiaxi_balance + xiangyi_balance,
      jiaxi_balance = 0,
      xiangyi_balance = 0
    WHERE jiaxi_balance > 0 OR xiangyi_balance > 0;

    ALTER TABLE wallets DROP COLUMN IF EXISTS jiaxi_balance;
    ALTER TABLE wallets DROP COLUMN IF EXISTS xiangyi_balance;
  END IF;
END $$;

INSERT INTO schema_migrations (id)
VALUES ('0032_unify_wallet_balance')
ON CONFLICT (id) DO NOTHING;
