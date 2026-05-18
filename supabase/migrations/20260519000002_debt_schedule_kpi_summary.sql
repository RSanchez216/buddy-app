-- KPI summary RPC for the Debt Schedule page's 3-capsule band layout.
-- Returns a single row with the 9 tile values across the Act Now,
-- Upcoming, and Overview bands. Timezone-anchored to America/Chicago
-- so "today" matches what the rest of the app uses (Payment Calendar,
-- projected_balances, etc.). SECURITY DEFINER so non-admin authenticated
-- users can also read the aggregates without per-loan RLS lookups.

CREATE OR REPLACE FUNCTION public.debt_schedule_kpi_summary()
RETURNS TABLE(
  past_due_loans_count       INTEGER,
  past_due_amount            NUMERIC,
  skipped_unresolved_amount  NUMERIC,
  skipped_unresolved_count   INTEGER,
  due_next_30d_amount        NUMERIC,
  due_next_30d_count         INTEGER,
  due_31_60d_amount          NUMERIC,
  due_31_60d_count           INTEGER,
  due_61_90d_amount          NUMERIC,
  due_61_90d_count           INTEGER,
  total_active_debt          NUMERIC,
  active_loans_count         INTEGER,
  paid_off_ytd_count         INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    -- Past Due Loans: count of distinct active loans with at least one
    -- overdue pending payment.
    (SELECT count(DISTINCT lp.loan_id)::int
       FROM public.loan_payments lp
       JOIN active_loan_ids a ON a.id = lp.loan_id
      WHERE lp.status = 'pending' AND lp.due_date < v_today),
    -- Past Due Amount: dollar sum of those overdue pending payments.
    (SELECT COALESCE(sum(lp.scheduled_amount), 0)
       FROM public.loan_payments lp
       JOIN active_loan_ids a ON a.id = lp.loan_id
      WHERE lp.status = 'pending' AND lp.due_date < v_today),
    -- Skipped Unresolved amount + count: status='skipped' on active
    -- loans only; skipped rows on paid-off loans are historical noise.
    (SELECT COALESCE(sum(lp.scheduled_amount), 0)
       FROM public.loan_payments lp
       JOIN active_loan_ids a ON a.id = lp.loan_id
      WHERE lp.status = 'skipped' AND lp.due_date < v_today),
    (SELECT count(*)::int
       FROM public.loan_payments lp
       JOIN active_loan_ids a ON a.id = lp.loan_id
      WHERE lp.status = 'skipped' AND lp.due_date < v_today),
    -- Due Next 30 Days (inclusive of today, matching Payment Calendar).
    (SELECT COALESCE(sum(lp.scheduled_amount), 0)
       FROM public.loan_payments lp
       JOIN active_loan_ids a ON a.id = lp.loan_id
      WHERE lp.status = 'pending' AND lp.due_date BETWEEN v_today AND v_today + 30),
    (SELECT count(*)::int
       FROM public.loan_payments lp
       JOIN active_loan_ids a ON a.id = lp.loan_id
      WHERE lp.status = 'pending' AND lp.due_date BETWEEN v_today AND v_today + 30),
    -- Due 31-60 Days
    (SELECT COALESCE(sum(lp.scheduled_amount), 0)
       FROM public.loan_payments lp
       JOIN active_loan_ids a ON a.id = lp.loan_id
      WHERE lp.status = 'pending' AND lp.due_date BETWEEN v_today + 31 AND v_today + 60),
    (SELECT count(*)::int
       FROM public.loan_payments lp
       JOIN active_loan_ids a ON a.id = lp.loan_id
      WHERE lp.status = 'pending' AND lp.due_date BETWEEN v_today + 31 AND v_today + 60),
    -- Due 61-90 Days
    (SELECT COALESCE(sum(lp.scheduled_amount), 0)
       FROM public.loan_payments lp
       JOIN active_loan_ids a ON a.id = lp.loan_id
      WHERE lp.status = 'pending' AND lp.due_date BETWEEN v_today + 61 AND v_today + 90),
    (SELECT count(*)::int
       FROM public.loan_payments lp
       JOIN active_loan_ids a ON a.id = lp.loan_id
      WHERE lp.status = 'pending' AND lp.due_date BETWEEN v_today + 61 AND v_today + 90),
    -- Total Active Debt
    (SELECT COALESCE(sum(l.current_balance), 0)
       FROM public.loans l
      WHERE l.status = 'active'),
    -- Active Loans
    (SELECT count(*)::int FROM public.loans WHERE status = 'active'),
    -- Paid Off YTD (last_updated_at as the "paid off date" proxy; loans
    -- table doesn't carry a dedicated paid_off_at timestamp).
    (SELECT count(*)::int
       FROM public.loans
      WHERE status = 'paid_off'
        AND last_updated_at >= v_year_start);
END;
$function$;

ALTER FUNCTION public.debt_schedule_kpi_summary() OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.debt_schedule_kpi_summary() TO authenticated;

NOTIFY pgrst, 'reload schema';
