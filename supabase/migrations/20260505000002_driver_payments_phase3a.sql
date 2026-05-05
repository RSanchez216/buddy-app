-- Phase 3A — Payment recording foundation.
--
-- Adds:
--   • driver_purchase_payments.payment_source ENUM-via-CHECK
--   • sync_driver_purchase_balance trigger — DELTA-based; safer than
--     recomputing from total_value because some Phase 2B-imported rows
--     have a current_balance that already reflects pre-BUDDY payment
--     history. The delta approach treats current_balance as a running
--     ledger that decrements with each actual_amount delta, so importing
--     historical state stays intact.
--   • generate_expected_driver_payments() — daily eager-generation
--     function. Anchored at greatest(purchase_date | last_period_end+1,
--     current_date − 7) so we don't fabricate hundreds of fake "missed
--     weeks" for old imports while still catching last week's miss.
--   • pg_cron schedule at 10 UTC (matches refresh_loan_health_daily)
--   • v_driver_purchase_summary extended with payment-derived fields:
--     last_charged_date, days_since_last_payment, expected_this_week,
--     collected_this_week, expected_this_month, collected_this_month,
--     is_behind, amount_behind, periods_behind

-- ── 1. payment_source ───────────────────────────────────────────────────
ALTER TABLE driver_purchase_payments
  ADD COLUMN IF NOT EXISTS payment_source text NOT NULL DEFAULT 'manual';

ALTER TABLE driver_purchase_payments
  DROP CONSTRAINT IF EXISTS driver_purchase_payments_payment_source_check;

ALTER TABLE driver_purchase_payments
  ADD CONSTRAINT driver_purchase_payments_payment_source_check
  CHECK (payment_source IN ('manual','payroll_import','generated','reversal'));

-- ── 2. Sync trigger ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_driver_purchase_balance()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_delta  numeric := 0;
  v_target uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_delta  := COALESCE(NEW.actual_amount, 0);
    v_target := NEW.driver_purchase_id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_delta  := COALESCE(NEW.actual_amount, 0) - COALESCE(OLD.actual_amount, 0);
    v_target := NEW.driver_purchase_id;
  ELSIF TG_OP = 'DELETE' THEN
    v_delta  := -COALESCE(OLD.actual_amount, 0);
    v_target := OLD.driver_purchase_id;
  END IF;

  IF v_delta <> 0 THEN
    UPDATE driver_purchases
       SET current_balance = GREATEST(COALESCE(current_balance, 0) - v_delta, 0),
           updated_at = now()
     WHERE id = v_target;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_balance_on_payment ON driver_purchase_payments;
CREATE TRIGGER trg_sync_balance_on_payment
AFTER INSERT OR UPDATE OR DELETE ON driver_purchase_payments
FOR EACH ROW EXECUTE FUNCTION sync_driver_purchase_balance();

-- ── 3. Eager generation function ────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_expected_driver_payments()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase     record;
  v_period_start date;
  v_period_end   date;
  v_horizon_end  date;
  v_max_existing date;
BEGIN
  v_horizon_end := current_date + interval '30 days';

  FOR v_purchase IN
    SELECT dp.id, dp.payment_amount, dp.payment_frequency, dp.purchase_date
    FROM driver_purchases dp
    JOIN driver_purchase_statuses s ON s.id = dp.status_id
    WHERE s.is_active_state = true
      AND dp.payment_amount IS NOT NULL
      AND dp.payment_amount > 0
      AND dp.payment_frequency IS NOT NULL
  LOOP
    SELECT max(period_end) INTO v_max_existing
    FROM driver_purchase_payments
    WHERE driver_purchase_id = v_purchase.id;

    -- Anchor: continue from the last existing period, but never look
    -- further back than current_date − 7. That catches "missed last
    -- week" without backfilling years of fake misses on old imports.
    v_period_start := GREATEST(
      COALESCE(v_max_existing + 1, v_purchase.purchase_date, current_date - 7),
      current_date - 7
    );

    WHILE v_period_start <= v_horizon_end LOOP
      v_period_end := CASE v_purchase.payment_frequency
        WHEN 'weekly'   THEN v_period_start + 6
        WHEN 'biweekly' THEN v_period_start + 13
        WHEN 'monthly'  THEN (v_period_start + interval '1 month' - interval '1 day')::date
      END;

      INSERT INTO driver_purchase_payments (
        driver_purchase_id, period_start, period_end, period_type,
        expected_amount, actual_amount, payment_source
      ) VALUES (
        v_purchase.id, v_period_start, v_period_end, v_purchase.payment_frequency,
        v_purchase.payment_amount, 0, 'generated'
      )
      ON CONFLICT (driver_purchase_id, period_start, period_end) DO NOTHING;

      v_period_start := v_period_end + 1;
    END LOOP;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_expected_driver_payments() TO authenticated;

-- ── 4. pg_cron schedule ─────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('generate-driver-purchase-expected-payments');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'generate-driver-purchase-expected-payments',
  '0 10 * * *',
  $cron$ SELECT public.generate_expected_driver_payments(); $cron$
);

-- ── 5. View extension ───────────────────────────────────────────────────
-- Adds payment-derived fields. Keeps every existing column so callers
-- (PurchaseFormModal hydration, list page, detail page) don't break.
CREATE OR REPLACE VIEW v_driver_purchase_summary AS
SELECT
  dp.id,
  dp.entity_id,
  e.name AS entity_name,
  d.id AS driver_id,
  d.full_name AS driver_name,
  d.internal_id AS driver_internal_id,
  d.phone AS driver_phone,
  d.id_number AS driver_id_number,
  d.id_type AS driver_id_type,
  dp.truck_number,
  dp.vin,
  dp.equipment_type,
  dp.equipment_id,
  dp.underlying_loan_id,
  l.lender_id AS underlying_lender_id,
  ldr.name AS underlying_lender_name,
  l.loan_id_external AS underlying_loan_number,
  l.current_balance AS underlying_loan_balance,
  l.monthly_payment AS underlying_loan_payment,
  CASE
    WHEN dp.underlying_loan_id IS NULL THEN NULL::numeric
    ELSE COALESCE(l.current_balance, 0) - COALESCE(dp.current_balance, 0)
  END AS coverage_gap,
  CASE
    WHEN dp.underlying_loan_id IS NOT NULL
     AND COALESCE(l.current_balance, 0) > COALESCE(dp.current_balance, 0) THEN true
    ELSE false
  END AS is_underwater,
  dp.purchase_type,
  dp.status_id,
  s.name AS status_name,
  s.color_hex AS status_color,
  s.is_active_state,
  s.is_terminal,
  dp.total_value,
  dp.downpayment,
  dp.sale_price,
  dp.current_balance,
  dp.payment_amount,
  dp.payment_frequency,
  dp.purchase_date,
  dp.contract_signed_date,
  dp.fully_paid_date,
  dp.title_transferred,
  dp.qb_completed,
  dp.notes,
  dp.original_clickup_id,
  dp.created_at,
  dp.updated_at,

  -- ── Phase 3A payment-derived fields ────────────────────────────────
  (SELECT max(period_end) FROM driver_purchase_payments p
    WHERE p.driver_purchase_id = dp.id AND p.actual_amount > 0
  ) AS last_charged_date,

  (SELECT current_date - max(period_end) FROM driver_purchase_payments p
    WHERE p.driver_purchase_id = dp.id AND p.actual_amount > 0
  ) AS days_since_last_payment,

  (SELECT COALESCE(sum(expected_amount), 0) FROM driver_purchase_payments p
    WHERE p.driver_purchase_id = dp.id
      AND p.period_start <= date_trunc('week', current_date)::date + 6
      AND p.period_end   >= date_trunc('week', current_date)::date
  ) AS expected_this_week,

  (SELECT COALESCE(sum(actual_amount), 0) FROM driver_purchase_payments p
    WHERE p.driver_purchase_id = dp.id
      AND p.period_start <= date_trunc('week', current_date)::date + 6
      AND p.period_end   >= date_trunc('week', current_date)::date
  ) AS collected_this_week,

  (SELECT COALESCE(sum(expected_amount), 0) FROM driver_purchase_payments p
    WHERE p.driver_purchase_id = dp.id
      AND p.period_start <= (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date
      AND p.period_end   >= date_trunc('month', current_date)::date
  ) AS expected_this_month,

  (SELECT COALESCE(sum(actual_amount), 0) FROM driver_purchase_payments p
    WHERE p.driver_purchase_id = dp.id
      AND p.period_start <= (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date
      AND p.period_end   >= date_trunc('month', current_date)::date
  ) AS collected_this_month,

  -- behind = active + has at least one fully-elapsed period with actual_amount = 0.
  -- Grace: 7 days for weekly/biweekly, 35 days for monthly.
  CASE
    WHEN s.is_active_state = false THEN false
    WHEN dp.payment_frequency = 'monthly' AND EXISTS (
      SELECT 1 FROM driver_purchase_payments p
      WHERE p.driver_purchase_id = dp.id
        AND p.period_end < current_date - 35
        AND p.actual_amount = 0
    ) THEN true
    WHEN dp.payment_frequency IN ('weekly','biweekly') AND EXISTS (
      SELECT 1 FROM driver_purchase_payments p
      WHERE p.driver_purchase_id = dp.id
        AND p.period_end < current_date - 7
        AND p.actual_amount = 0
    ) THEN true
    ELSE false
  END AS is_behind,

  (SELECT COALESCE(sum(expected_amount - actual_amount), 0) FROM driver_purchase_payments p
    WHERE p.driver_purchase_id = dp.id
      AND p.period_end < current_date - CASE WHEN dp.payment_frequency = 'monthly' THEN 35 ELSE 7 END
      AND p.actual_amount = 0
  ) AS amount_behind,

  (SELECT count(*)::int FROM driver_purchase_payments p
    WHERE p.driver_purchase_id = dp.id
      AND p.period_end < current_date - CASE WHEN dp.payment_frequency = 'monthly' THEN 35 ELSE 7 END
      AND p.actual_amount = 0
  ) AS periods_behind

FROM driver_purchases dp
JOIN drivers d ON d.id = dp.driver_id
JOIN driver_purchase_statuses s ON s.id = dp.status_id
LEFT JOIN loan_entities e ON e.id = dp.entity_id
LEFT JOIN loans l ON l.id = dp.underlying_loan_id
LEFT JOIN loan_lenders ldr ON ldr.id = l.lender_id;

GRANT SELECT ON v_driver_purchase_summary TO authenticated;
