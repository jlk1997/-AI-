-- Course stake / settle writes course_* ledger kinds. The check still
-- stopped at 0018 (purchase/sale/adjust), so visitor stakes 23514'd.
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_kind_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_kind_check
  CHECK (kind IN (
    'topup',
    'grant',
    'spend',
    'refund',
    'royalty',
    'tip',
    'purchase',
    'sale',
    'adjust',
    'course_stake',
    'course_payout',
    'course_void',
    'course_rake'
  ));

INSERT INTO schema_migrations (id)
VALUES ('0037_course_ledger_kinds')
ON CONFLICT (id) DO NOTHING;
