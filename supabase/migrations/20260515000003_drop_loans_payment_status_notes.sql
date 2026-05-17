-- Drop loans.payment_status_notes — a free-text Loadify-import leftover with
-- no semantic meaning, never user-maintained. The "1 payment overdue" notes
-- it carried were stale; real overdue logic lives in loan_payments.
--
-- v_loans_summary depended on the column, so we drop and recreate the view
-- without it before dropping the column. View shape is otherwise identical
-- to the previous definition.

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
    l.interest_rate,
    l.monthly_payment,
    l.due_day,
    l.autopay,
    l.start_date,
    l.first_payment_date,
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

ALTER TABLE public.loans
  DROP COLUMN IF EXISTS payment_status_notes;

GRANT SELECT ON public.v_loans_summary TO authenticated;
