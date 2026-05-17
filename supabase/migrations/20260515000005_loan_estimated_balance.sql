-- Loan estimated balance: anchor-and-extrapolate pattern, modeled after the
-- funding accounts work in Slice 2. current_balance is treated as an anchor
-- (last confirmed truth from the lender / QB), and the UI extrapolates
-- forward via monthly_payment × months_elapsed.
--
-- The estimate intentionally ignores interest accrual and amortization splits
-- — the user's stated requirement is "estimated, not accurate." The anchor
-- refresh on the loan edit form is the accuracy lever.

ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS current_balance_as_of_date DATE,
  ADD COLUMN IF NOT EXISTS current_balance_updated_by UUID REFERENCES public.users(id);

UPDATE public.loans
SET current_balance_as_of_date = updated_at::date
WHERE current_balance IS NOT NULL
  AND current_balance_as_of_date IS NULL;

CREATE OR REPLACE FUNCTION public.estimated_loan_balance(p_loan_id UUID)
RETURNS NUMERIC
LANGUAGE sql STABLE
AS $$
  SELECT
    GREATEST(0, l.current_balance - (
      l.monthly_payment * GREATEST(0, (
        EXTRACT(YEAR FROM AGE((now() AT TIME ZONE 'America/Chicago')::date, l.current_balance_as_of_date)) * 12
        + EXTRACT(MONTH FROM AGE((now() AT TIME ZONE 'America/Chicago')::date, l.current_balance_as_of_date))
      )::int)
    ))
  FROM public.loans l
  WHERE l.id = p_loan_id
    AND l.current_balance IS NOT NULL
    AND l.current_balance_as_of_date IS NOT NULL
    AND l.monthly_payment IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.estimated_loan_balance(UUID) TO authenticated;

-- v_loans_summary needs the two new columns exposed for the Overview tab.
-- Drop + recreate; everything else is the prior definition verbatim.
DROP VIEW IF EXISTS public.v_loans_summary;

CREATE VIEW public.v_loans_summary AS
SELECT l.id,
    l.loan_id_external,
    l.task_name,
    l.contract_number,
    l.entity_id,
    l.lender_id,
    l.funding_account_id,
    l.loan_amount,
    l.current_balance,
    l.current_balance_as_of_date,
    l.current_balance_updated_by,
    l.interest_rate,
    l.monthly_payment,
    l.due_day,
    l.autopay,
    l.start_date,
    l.first_payment_date,
    l.term_months,
    l.maturity_date,
    l.status,
    l.description,
    l.cfo_flag,
    l.loadify_updated_at,
    l.last_updated_at,
    l.created_at,
    l.updated_at,
    l.created_by,
    e.name AS entity_name,
    ld.name AS lender_name,
    fa.name AS funding_account_name,
    ( SELECT count(*) AS count
           FROM loan_equipment
          WHERE loan_equipment.loan_id = l.id) AS equipment_count,
    ( SELECT min(loan_payments.due_date) AS min
           FROM loan_payments
          WHERE loan_payments.loan_id = l.id AND loan_payments.status = 'pending'::text AND loan_payments.due_date >= CURRENT_DATE) AS next_due_date,
    GREATEST(0, COALESCE(( SELECT CURRENT_DATE - min(loan_payments.due_date)
           FROM loan_payments
          WHERE loan_payments.loan_id = l.id AND loan_payments.status = 'pending'::text AND loan_payments.due_date < CURRENT_DATE), 0)) AS days_behind,
    ( SELECT count(*) AS count
           FROM loan_payments
          WHERE loan_payments.loan_id = l.id AND loan_payments.status = 'pending'::text AND loan_payments.due_date < CURRENT_DATE) AS overdue_count,
    ( SELECT count(*) AS count
           FROM loan_equipment le
          WHERE le.loan_id = l.id AND le.has_title = true) AS title_received_count,
    ( SELECT count(*) AS count
           FROM loan_equipment le
          WHERE le.loan_id = l.id AND le.has_title = false) AS title_pending_count,
        CASE
            WHEN l.status = 'paid_off'::text AND (EXISTS ( SELECT 1
               FROM loan_equipment le
              WHERE le.loan_id = l.id AND le.has_title = false)) THEN true
            ELSE false
        END AS title_release_pending
   FROM loans l
     LEFT JOIN loan_entities e ON l.entity_id = e.id
     LEFT JOIN loan_lenders ld ON l.lender_id = ld.id
     LEFT JOIN funding_accounts fa ON l.funding_account_id = fa.id;

GRANT SELECT ON public.v_loans_summary TO authenticated;
