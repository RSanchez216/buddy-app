-- Add paid-off dollar amounts + all-time count to
-- debt_schedule_kpi_summary() so the Overview section can show both
-- YTD progress and total-to-date side-by-side.
--
-- New fields (appended at the end of the return signature):
--   paid_off_ytd_amount  numeric — sum of loan_amount for paid-off
--                                  loans updated in the current year
--   total_paid_off_count integer — all-time count of paid-off loans
--   total_paid_off_amount numeric — all-time sum of loan_amount on
--                                   paid-off loans
--
-- YTD continues to use last_updated_at >= year_start as the proxy
-- (matches the existing paid_off_ytd_count). The cleaner fix is a
-- dedicated paid_off_at column, parked as a follow-up so both YTD
-- numbers stay consistent with each other in the meantime.
--
-- Postgres requires DROP before changing a RETURNS TABLE signature.

DROP FUNCTION IF EXISTS public.debt_schedule_kpi_summary();

CREATE OR REPLACE FUNCTION public.debt_schedule_kpi_summary()
RETURNS TABLE(
  past_due_loans_count integer,
  past_due_amount numeric,
  past_due_payments_count integer,
  past_due_pending_count integer,
  past_due_pending_amount numeric,
  past_due_skipped_count integer,
  past_due_skipped_amount numeric,
  days_behind_max integer,
  days_behind_avg integer,
  due_next_30d_amount numeric,
  due_next_30d_count integer,
  due_31_60d_amount numeric,
  due_31_60d_count integer,
  due_61_90d_amount numeric,
  due_61_90d_count integer,
  total_active_debt numeric,
  active_loans_count integer,
  paid_off_ytd_count integer,
  paid_off_ytd_amount numeric,
  total_paid_off_count integer,
  total_paid_off_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_today      DATE := (now() AT TIME ZONE 'America/Chicago')::date;
  v_year_start DATE := date_trunc('year', v_today)::date;
BEGIN
  RETURN QUERY
  WITH active_loan_ids AS (
    SELECT id FROM public.loans WHERE status = 'active'
  ),
  past_due AS (
    SELECT lp.loan_id, lp.status, lp.scheduled_amount, lp.due_date,
           (v_today - lp.due_date) AS days_overdue
    FROM public.loan_payments lp
    JOIN active_loan_ids a ON a.id = lp.loan_id
    WHERE lp.status IN ('pending', 'skipped')
      AND lp.due_date < v_today
  )
  SELECT
    (SELECT count(DISTINCT loan_id)::int FROM past_due),
    (SELECT COALESCE(sum(scheduled_amount), 0) FROM past_due),
    (SELECT count(*)::int FROM past_due),
    (SELECT count(*)::int FROM past_due WHERE status = 'pending'),
    (SELECT COALESCE(sum(scheduled_amount), 0) FROM past_due WHERE status = 'pending'),
    (SELECT count(*)::int FROM past_due WHERE status = 'skipped'),
    (SELECT COALESCE(sum(scheduled_amount), 0) FROM past_due WHERE status = 'skipped'),
    (SELECT COALESCE(max(days_overdue), 0)::int FROM past_due),
    (SELECT COALESCE(round(avg(days_overdue)::numeric, 0), 0)::int FROM past_due),
    (SELECT COALESCE(sum(lp.scheduled_amount), 0)
       FROM public.loan_payments lp
       JOIN active_loan_ids a ON a.id = lp.loan_id
      WHERE lp.status = 'pending' AND lp.due_date BETWEEN v_today AND v_today + 30),
    (SELECT count(*)::int
       FROM public.loan_payments lp
       JOIN active_loan_ids a ON a.id = lp.loan_id
      WHERE lp.status = 'pending' AND lp.due_date BETWEEN v_today AND v_today + 30),
    (SELECT COALESCE(sum(lp.scheduled_amount), 0)
       FROM public.loan_payments lp
       JOIN active_loan_ids a ON a.id = lp.loan_id
      WHERE lp.status = 'pending' AND lp.due_date BETWEEN v_today + 31 AND v_today + 60),
    (SELECT count(*)::int
       FROM public.loan_payments lp
       JOIN active_loan_ids a ON a.id = lp.loan_id
      WHERE lp.status = 'pending' AND lp.due_date BETWEEN v_today + 31 AND v_today + 60),
    (SELECT COALESCE(sum(lp.scheduled_amount), 0)
       FROM public.loan_payments lp
       JOIN active_loan_ids a ON a.id = lp.loan_id
      WHERE lp.status = 'pending' AND lp.due_date BETWEEN v_today + 61 AND v_today + 90),
    (SELECT count(*)::int
       FROM public.loan_payments lp
       JOIN active_loan_ids a ON a.id = lp.loan_id
      WHERE lp.status = 'pending' AND lp.due_date BETWEEN v_today + 61 AND v_today + 90),
    (SELECT COALESCE(sum(l.current_balance), 0)
       FROM public.loans l
      WHERE l.status = 'active'),
    (SELECT count(*)::int FROM public.loans WHERE status = 'active'),
    (SELECT count(*)::int
       FROM public.loans
      WHERE status = 'paid_off'
        AND last_updated_at >= v_year_start),
    -- NEW: paid_off_ytd_amount
    (SELECT COALESCE(sum(loan_amount), 0)
       FROM public.loans
      WHERE status = 'paid_off'
        AND last_updated_at >= v_year_start),
    -- NEW: total_paid_off_count
    (SELECT count(*)::int FROM public.loans WHERE status = 'paid_off'),
    -- NEW: total_paid_off_amount
    (SELECT COALESCE(sum(loan_amount), 0) FROM public.loans WHERE status = 'paid_off');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.debt_schedule_kpi_summary() TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
