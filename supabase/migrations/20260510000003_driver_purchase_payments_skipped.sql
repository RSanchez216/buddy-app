-- Skipped state — distinct from Missed. Skipped means "we agreed there's
-- no payment this period" (driver vacation, deferral, equipment in shop);
-- Missed means "the driver owes us and didn't pay". Visual treatment + the
-- Behind count both respect the distinction.

ALTER TABLE driver_purchase_payments
  ADD COLUMN skipped BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN skipped_at TIMESTAMPTZ,
  ADD COLUMN skipped_by UUID REFERENCES public.users(id),
  ADD COLUMN skip_reason TEXT;

COMMENT ON COLUMN driver_purchase_payments.skipped IS
  'TRUE when this period was deliberately skipped (driver vacation, agreed deferral, etc.). '
  'Skipped periods do NOT count toward periods_behind and do NOT affect the balance.';

-- Recreate v_driver_purchase_summary so is_behind, amount_behind, and
-- periods_behind exclude skipped periods. The rest of the view is
-- preserved byte-for-byte. CREATE OR REPLACE handles this fine since
-- we're not removing any columns — just changing the WHERE clauses.
CREATE OR REPLACE VIEW v_driver_purchase_summary AS
SELECT
  dp.id, dp.entity_id, e.name AS entity_name,
  d.id AS driver_id, d.full_name AS driver_name, d.internal_id AS driver_internal_id,
  d.phone AS driver_phone, d.id_number AS driver_id_number, d.id_type AS driver_id_type,
  dp.truck_number, dp.vin, dp.equipment_type, dp.equipment_id,
  dp.underlying_loan_id, l.lender_id AS underlying_lender_id, ldr.name AS underlying_lender_name,
  l.loan_id_external AS underlying_loan_number, l.current_balance AS underlying_loan_balance,
  l.monthly_payment AS underlying_loan_payment,
  CASE WHEN dp.underlying_loan_id IS NULL THEN NULL::numeric
       ELSE COALESCE(l.current_balance, 0) - COALESCE(dp.current_balance, 0) END AS coverage_gap,
  CASE WHEN dp.underlying_loan_id IS NOT NULL
        AND COALESCE(l.current_balance, 0) > COALESCE(dp.current_balance, 0) THEN true
       ELSE false END AS is_underwater,
  dp.purchase_type, dp.status_id, s.name AS status_name, s.color_hex AS status_color,
  s.is_active_state, s.is_terminal,
  dp.downpayment, dp.sale_price, dp.current_balance,
  dp.payment_amount, dp.payment_frequency,
  dp.purchase_date, dp.contract_signed_date, dp.fully_paid_date,
  dp.title_transferred, dp.qb_completed,
  dp.notes, dp.original_clickup_id, dp.created_at, dp.updated_at,
  (SELECT max(period_end) FROM driver_purchase_payments p
    WHERE p.driver_purchase_id = dp.id AND p.actual_amount > 0) AS last_charged_date,
  (SELECT current_date - max(period_end) FROM driver_purchase_payments p
    WHERE p.driver_purchase_id = dp.id AND p.actual_amount > 0) AS days_since_last_payment,
  (SELECT COALESCE(sum(expected_amount), 0) FROM driver_purchase_payments p
    WHERE p.driver_purchase_id = dp.id
      AND p.period_start <= date_trunc('week', current_date)::date + 6
      AND p.period_end   >= date_trunc('week', current_date)::date) AS expected_this_week,
  (SELECT COALESCE(sum(actual_amount), 0) FROM driver_purchase_payments p
    WHERE p.driver_purchase_id = dp.id
      AND p.period_start <= date_trunc('week', current_date)::date + 6
      AND p.period_end   >= date_trunc('week', current_date)::date) AS collected_this_week,
  (SELECT COALESCE(sum(expected_amount), 0) FROM driver_purchase_payments p
    WHERE p.driver_purchase_id = dp.id
      AND p.period_start <= (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date
      AND p.period_end   >= date_trunc('month', current_date)::date) AS expected_this_month,
  (SELECT COALESCE(sum(actual_amount), 0) FROM driver_purchase_payments p
    WHERE p.driver_purchase_id = dp.id
      AND p.period_start <= (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date
      AND p.period_end   >= date_trunc('month', current_date)::date) AS collected_this_month,
  CASE
    WHEN s.is_active_state = false THEN false
    WHEN dp.payment_frequency = 'monthly' AND EXISTS (
      SELECT 1 FROM driver_purchase_payments p
      WHERE p.driver_purchase_id = dp.id
        AND p.period_end < current_date - 35
        AND p.actual_amount = 0
        AND p.skipped = false) THEN true
    WHEN dp.payment_frequency IN ('weekly','biweekly') AND EXISTS (
      SELECT 1 FROM driver_purchase_payments p
      WHERE p.driver_purchase_id = dp.id
        AND p.period_end < current_date - 7
        AND p.actual_amount = 0
        AND p.skipped = false) THEN true
    ELSE false
  END AS is_behind,
  (SELECT COALESCE(sum(expected_amount - actual_amount), 0) FROM driver_purchase_payments p
    WHERE p.driver_purchase_id = dp.id
      AND p.period_end < current_date - CASE WHEN dp.payment_frequency = 'monthly' THEN 35 ELSE 7 END
      AND p.actual_amount = 0
      AND p.skipped = false) AS amount_behind,
  (SELECT count(*)::int FROM driver_purchase_payments p
    WHERE p.driver_purchase_id = dp.id
      AND p.period_end < current_date - CASE WHEN dp.payment_frequency = 'monthly' THEN 35 ELSE 7 END
      AND p.actual_amount = 0
      AND p.skipped = false) AS periods_behind,
  CASE
    WHEN s.name = 'Fully Paid' AND COALESCE(dp.title_transferred, FALSE) = FALSE THEN TRUE
    ELSE FALSE
  END AS title_release_pending
FROM driver_purchases dp
JOIN drivers d ON d.id = dp.driver_id
JOIN driver_purchase_statuses s ON s.id = dp.status_id
LEFT JOIN loan_entities e ON e.id = dp.entity_id
LEFT JOIN loans l ON l.id = dp.underlying_loan_id
LEFT JOIN loan_lenders ldr ON ldr.id = l.lender_id;

GRANT SELECT ON v_driver_purchase_summary TO authenticated;

NOTIFY pgrst, 'reload schema';
