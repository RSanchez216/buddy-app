-- Pre-tracking cutoff: weeks where period_end < this date render as
-- "Pre-tracking" instead of "Missed". Cleans up the wall-of-red for
-- ClickUp-imported contracts that had years of payroll history outside
-- BUDDY.
ALTER TABLE driver_purchases
  ADD COLUMN payment_tracking_start_date DATE;

-- Backfill: default to contract creation date in BUDDY. Rebeca can
-- override per-contract via the new edit UI.
UPDATE driver_purchases
SET payment_tracking_start_date = created_at::date
WHERE payment_tracking_start_date IS NULL;

COMMENT ON COLUMN driver_purchases.payment_tracking_start_date IS
  'Weeks where period_end < this date render as "Pre-tracking" instead of "Missed". '
  'Default for existing contracts: contract creation date in BUDDY. '
  'Default for new contracts: purchase_date.';

NOTIFY pgrst, 'reload schema';
