-- Funding Account Balances
--
-- Already applied to the database. This file exists so the migrations
-- folder is the source of truth alongside the live schema.
--
-- Adds balance tracking to funding_accounts so the Payment Calendar
-- can roll a real end-of-day cash projection from reconciled balances.

-- 1) New columns
ALTER TABLE funding_accounts
  ADD COLUMN IF NOT EXISTS current_balance     numeric,
  ADD COLUMN IF NOT EXISTS balance_as_of_date  date,
  ADD COLUMN IF NOT EXISTS balance_updated_at  timestamptz,
  ADD COLUMN IF NOT EXISTS balance_updated_by  uuid REFERENCES auth.users(id);

COMMENT ON COLUMN funding_accounts.current_balance    IS 'Most recent reconciled cash balance. Negative values allowed (overdraft).';
COMMENT ON COLUMN funding_accounts.balance_as_of_date IS 'The business date the balance was true for (often the bank statement date).';
COMMENT ON COLUMN funding_accounts.balance_updated_at IS 'When the balance was last edited in BUDDY. Auto-stamped by trigger.';
COMMENT ON COLUMN funding_accounts.balance_updated_by IS 'Auth user id of whoever last edited the balance.';

-- 2) Auto-stamp balance_updated_at whenever the balance or its as-of date changes
CREATE OR REPLACE FUNCTION public.funding_accounts_touch_balance_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.current_balance IS NOT NULL OR NEW.balance_as_of_date IS NOT NULL THEN
      NEW.balance_updated_at := COALESCE(NEW.balance_updated_at, now());
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.current_balance    IS DISTINCT FROM OLD.current_balance)
     OR (NEW.balance_as_of_date IS DISTINCT FROM OLD.balance_as_of_date) THEN
    NEW.balance_updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS funding_accounts_balance_touch ON funding_accounts;
CREATE TRIGGER funding_accounts_balance_touch
  BEFORE INSERT OR UPDATE ON funding_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.funding_accounts_touch_balance_updated_at();

-- 3) One-time cleanup: deactivate funding accounts that no loan references.
-- Idempotent — re-running on a fresh database will also catch orphans.
UPDATE funding_accounts fa
SET is_active = false
WHERE fa.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM loans l WHERE l.funding_account_id = fa.id
  );
