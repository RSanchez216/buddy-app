-- Factor inflows + deposit allocations
--
-- Spec for the rebuilt Add Income modal. All statements are idempotent
-- (IF NOT EXISTS / DROP IF EXISTS / CREATE OR REPLACE), so this file is
-- safe to re-run if any pieces are already in place.
--
-- Changes:
--   1. expected_inflows gains source_type, factor_id, gross_amount.
--      `amount` continues to hold the NET (what hits the bank);
--      `gross_amount` records what was submitted to the factor.
--   2. funding_account_id added to the four cash-event tables that don't
--      have it yet (custom_outflows, recurring_expense_templates, invoices,
--      and expected_inflows for completeness — though deposits drive the
--      bank attribution for inflows now).
--   3. Deposit allocation table — one inflow can split across N banks.
--   4. custom_outflows.source_inflow_id links a factor-fee outflow back to
--      the inflow that produced it. ON DELETE CASCADE keeps them in sync.
--   5. Trigger on expected_inflows that auto-syncs the factor fee row in
--      custom_outflows whenever the inflow changes.

-- 1) expected_inflows new columns
ALTER TABLE expected_inflows
  ADD COLUMN IF NOT EXISTS source_type   text DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS factor_id     uuid REFERENCES factors(id),
  ADD COLUMN IF NOT EXISTS gross_amount  numeric;

-- Defensive CHECK — only add it if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expected_inflows_source_type_check'
  ) THEN
    ALTER TABLE expected_inflows
      ADD CONSTRAINT expected_inflows_source_type_check
      CHECK (source_type IN ('other','factor'));
  END IF;
END$$;

-- 2) funding_account_id on cash event tables (idempotent)
ALTER TABLE custom_outflows             ADD COLUMN IF NOT EXISTS funding_account_id uuid REFERENCES funding_accounts(id);
ALTER TABLE recurring_expense_templates ADD COLUMN IF NOT EXISTS funding_account_id uuid REFERENCES funding_accounts(id);
ALTER TABLE invoices                    ADD COLUMN IF NOT EXISTS funding_account_id uuid REFERENCES funding_accounts(id);
ALTER TABLE expected_inflows            ADD COLUMN IF NOT EXISTS funding_account_id uuid REFERENCES funding_accounts(id);

CREATE INDEX IF NOT EXISTS idx_invoices_funding_account            ON invoices            (funding_account_id) WHERE funding_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_custom_outflows_funding_account     ON custom_outflows     (funding_account_id) WHERE funding_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recurring_templates_funding_account ON recurring_expense_templates (funding_account_id) WHERE funding_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expected_inflows_funding_account    ON expected_inflows    (funding_account_id) WHERE funding_account_id IS NOT NULL;

-- 3) Deposit allocation table
CREATE TABLE IF NOT EXISTS expected_inflow_deposits (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  expected_inflow_id  uuid        NOT NULL REFERENCES expected_inflows(id) ON DELETE CASCADE,
  funding_account_id  uuid        NOT NULL REFERENCES funding_accounts(id),
  amount              numeric     NOT NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expected_inflow_deposits_inflow  ON expected_inflow_deposits (expected_inflow_id);
CREATE INDEX IF NOT EXISTS idx_expected_inflow_deposits_account ON expected_inflow_deposits (funding_account_id);

ALTER TABLE expected_inflow_deposits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_expected_inflow_deposits" ON expected_inflow_deposits;
DROP POLICY IF EXISTS "auth_insert_expected_inflow_deposits" ON expected_inflow_deposits;
DROP POLICY IF EXISTS "auth_update_expected_inflow_deposits" ON expected_inflow_deposits;
DROP POLICY IF EXISTS "auth_delete_expected_inflow_deposits" ON expected_inflow_deposits;
CREATE POLICY "auth_select_expected_inflow_deposits" ON expected_inflow_deposits FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_expected_inflow_deposits" ON expected_inflow_deposits FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_expected_inflow_deposits" ON expected_inflow_deposits FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_delete_expected_inflow_deposits" ON expected_inflow_deposits FOR DELETE TO authenticated USING (true);

-- 4) custom_outflows.source_inflow_id — links auto-generated factor fees back to the inflow
ALTER TABLE custom_outflows
  ADD COLUMN IF NOT EXISTS source_inflow_id uuid REFERENCES expected_inflows(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_custom_outflows_source_inflow ON custom_outflows (source_inflow_id) WHERE source_inflow_id IS NOT NULL;

-- 5) Factor fee sync trigger
-- After every INSERT or UPDATE on expected_inflows, recompute the linked
-- factor-fee row. The simplest correct implementation: always delete any
-- existing fee row for this inflow then re-insert if applicable. The
-- ON DELETE CASCADE on source_inflow_id handles inflow deletes for free.
CREATE OR REPLACE FUNCTION public.expected_inflows_sync_factor_fee()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  fac RECORD;
  fee_amount numeric;
BEGIN
  DELETE FROM custom_outflows WHERE source_inflow_id = NEW.id;

  IF NEW.source_type = 'factor'
     AND NEW.factor_id IS NOT NULL
     AND NEW.gross_amount IS NOT NULL
     AND NEW.status <> 'cancelled' THEN
    SELECT * INTO fac FROM factors WHERE id = NEW.factor_id;
    IF FOUND AND fac.fee_rate IS NOT NULL AND fac.fee_rate > 0 THEN
      fee_amount := round((NEW.gross_amount * fac.fee_rate)::numeric, 2);
      INSERT INTO custom_outflows (
        due_date,
        description,
        amount,
        category,
        status,
        source_inflow_id,
        funding_account_id,
        entity_id
      ) VALUES (
        COALESCE(NEW.received_date, NEW.expected_date),
        'Factor fee — ' || fac.name,
        fee_amount,
        'fee',
        CASE WHEN NEW.status = 'received' THEN 'paid' ELSE 'planned' END,
        NEW.id,
        fac.default_deposit_account_id,
        NEW.entity_id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS expected_inflows_factor_fee_sync ON expected_inflows;
CREATE TRIGGER expected_inflows_factor_fee_sync
  AFTER INSERT OR UPDATE ON expected_inflows
  FOR EACH ROW
  EXECUTE FUNCTION public.expected_inflows_sync_factor_fee();
