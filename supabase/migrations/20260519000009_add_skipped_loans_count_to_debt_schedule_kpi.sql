-- Add skipped_unresolved_loans_count to debt_schedule_kpi_summary() so the
-- Debt Schedule's Act Now section can render the Skipped Unresolved tile
-- at the same granularity as Past Due (loans count alongside payment
-- count). All other fields and their compute logic are byte-for-byte
-- unchanged. Postgres requires DROP before changing a RETURNS TABLE(...)
-- signature — CREATE OR REPLACE alone won't take a new column.

BEGIN;

DROP FUNCTION IF EXISTS public.debt_schedule_kpi_summary();

CREATE OR REPLACE FUNCTION public.debt_schedule_kpi_summary()
RETURNS TABLE(
  past_due_loans_count integer,
  past_due_amount numeric,
  skipped_unresolved_loans_count integer,   -- NEW
  skipped_unresolved_amount numeric,
  skipped_unresolved_count integer,
  due_next_30d_amount numeric,
  due_next_30d_count integer,
  due_31_60d_amount numeric,
  due_31_60d_count integer,
  due_61_90d_amount numeric,
  due_61_90d_count integer,
  total_active_debt numeric,
  active_loans_count integer,
  paid_off_ytd_count integer
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
  )
  SELECT
    (SELECT count(DISTINCT lp.loan_id)::int
       FROM public.loan_payments lp
       JOIN active_loan_ids a ON a.id = lp.loan_id
      WHERE lp.status = 'pending' AND lp.due_date < v_today),
    (SELECT COALESCE(sum(lp.scheduled_amount), 0)
       FROM public.loan_payments lp
       JOIN active_loan_ids a ON a.id = lp.loan_id
      WHERE lp.status = 'pending' AND lp.due_date < v_today),
    -- NEW: skipped_unresolved_loans_count
    (SELECT count(DISTINCT lp.loan_id)::int
       FROM public.loan_payments lp
       JOIN active_loan_ids a ON a.id = lp.loan_id
      WHERE lp.status = 'skipped' AND lp.due_date < v_today),
    (SELECT COALESCE(sum(lp.scheduled_amount), 0)
       FROM public.loan_payments lp
       JOIN active_loan_ids a ON a.id = lp.loan_id
      WHERE lp.status = 'skipped' AND lp.due_date < v_today),
    (SELECT count(*)::int
       FROM public.loan_payments lp
       JOIN active_loan_ids a ON a.id = lp.loan_id
      WHERE lp.status = 'skipped' AND lp.due_date < v_today),
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
        AND last_updated_at >= v_year_start);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.debt_schedule_kpi_summary() TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
