-- Returns accounts that the calendar should prompt the user to
-- reconcile right now: (a) active, (b) balance is stale (>=3 days)
-- or has never been recorded, and (c) has at least one pending flow
-- scheduled inside the visible date range.
--
-- Called from both Day mode (start = end = the focused day) and Week
-- mode (start = monday, end = sunday). One signature handles both.
--
-- Idle accounts that happen to be stale don't surface — there's no
-- urgency. Fresh accounts that have flows today don't surface either
-- — projection is already accurate.

CREATE OR REPLACE FUNCTION public.accounts_needing_balance_update(
  p_start_date date,
  p_end_date   date
)
RETURNS TABLE (
  funding_account_id   uuid,
  name                 text,
  bank_name            text,
  last_four            text,
  days_since_balance   int,
  is_first_recording   boolean
)
LANGUAGE sql STABLE
AS $$
  SELECT
    v.id,
    v.name,
    v.bank_name,
    v.last_four,
    v.days_since_balance,
    (v.balance_as_of_date IS NULL) AS is_first_recording
  FROM public.v_funding_accounts_with_balance v
  WHERE v.is_active = TRUE
    AND (v.days_since_balance IS NULL OR v.days_since_balance >= 3)
    AND (
      EXISTS (
        SELECT 1
        FROM public.loan_payments lp
        JOIN public.loans l ON l.id = lp.loan_id
        WHERE l.funding_account_id = v.id
          AND lp.status IN ('pending','partial')
          AND COALESCE(lp.planned_pay_date, lp.due_date) BETWEEN p_start_date AND p_end_date
      )
      OR EXISTS (
        SELECT 1
        FROM public.custom_outflows co
        WHERE co.funding_account_id = v.id
          AND co.status = 'planned'
          AND co.cash_impacting = TRUE
          AND COALESCE(co.planned_pay_date, co.due_date) BETWEEN p_start_date AND p_end_date
      )
      OR EXISTS (
        SELECT 1
        FROM public.invoices i
        WHERE i.funding_account_id = v.id
          AND i.status IN ('Pending','Approved')
          AND i.deleted_at IS NULL
          AND COALESCE(i.planned_pay_date, i.due_date) BETWEEN p_start_date AND p_end_date
      )
      OR EXISTS (
        SELECT 1
        FROM public.expected_inflow_deposits eid
        JOIN public.expected_inflows ei ON ei.id = eid.expected_inflow_id
        WHERE eid.funding_account_id = v.id
          AND ei.status = 'pending'
          AND ei.expected_date BETWEEN p_start_date AND p_end_date
      )
    )
  ORDER BY v.days_since_balance DESC NULLS FIRST, v.name;
$$;

GRANT EXECUTE ON FUNCTION public.accounts_needing_balance_update(date, date) TO authenticated;
