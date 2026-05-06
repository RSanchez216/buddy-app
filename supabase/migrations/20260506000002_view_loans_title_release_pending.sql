-- Lender-side mirror of the driver-purchase title release work:
-- when Monas has paid off a loan, the lender owes Monas the title
-- documents for each financed equipment item. A loan can finance
-- multiple items (1 truck or 5 trailers), each with its own
-- loan_equipment.has_title boolean.
--
-- Adds:
--   • title_received_count / title_pending_count on v_loans_summary
--   • title_release_pending = (status='paid_off' AND any has_title=false)
--   • loan_events CHECK widened with 'title_received' /
--     'titles_received_bulk' for the per-equipment + loan-level
--     audit events the UI writes
--
-- Day-1 baseline: 12 of 61 loans flag true (every paid-off loan, since
-- the ClickUp import defaulted has_title=false on every equipment row).
-- The alert panel exists exactly so Rebeca can audit and clear them.

ALTER TABLE loan_events
  DROP CONSTRAINT IF EXISTS loan_events_event_type_check;

ALTER TABLE loan_events
  ADD CONSTRAINT loan_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'paydown', 'restructure', 'rate_change', 'balance_correction',
    'transfer', 'note', 'loan_merged',
    'title_received', 'titles_received_bulk'
  ]));

CREATE OR REPLACE VIEW v_loans_summary AS
SELECT
  l.id,
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
  l.payment_status_notes,
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
  (SELECT count(*) FROM loan_equipment WHERE loan_equipment.loan_id = l.id) AS equipment_count,
  (SELECT min(loan_payments.due_date)
     FROM loan_payments
     WHERE loan_payments.loan_id = l.id
       AND loan_payments.status = 'pending'
       AND loan_payments.due_date >= CURRENT_DATE) AS next_due_date,
  GREATEST(0, COALESCE((
    SELECT CURRENT_DATE - min(loan_payments.due_date)
      FROM loan_payments
     WHERE loan_payments.loan_id = l.id
       AND loan_payments.status = 'pending'
       AND loan_payments.due_date < CURRENT_DATE), 0)) AS days_behind,
  (SELECT count(*) FROM loan_payments
    WHERE loan_payments.loan_id = l.id
      AND loan_payments.status = 'pending'
      AND loan_payments.due_date < CURRENT_DATE) AS overdue_count,

  -- Title-release derived fields
  (SELECT count(*) FROM loan_equipment le
    WHERE le.loan_id = l.id AND le.has_title = true) AS title_received_count,
  (SELECT count(*) FROM loan_equipment le
    WHERE le.loan_id = l.id AND le.has_title = false) AS title_pending_count,
  CASE
    WHEN l.status = 'paid_off' AND EXISTS (
      SELECT 1 FROM loan_equipment le
      WHERE le.loan_id = l.id AND le.has_title = false
    ) THEN true
    ELSE false
  END AS title_release_pending
FROM loans l
LEFT JOIN loan_entities e ON l.entity_id = e.id
LEFT JOIN loan_lenders ld ON l.lender_id = ld.id
LEFT JOIN funding_accounts fa ON l.funding_account_id = fa.id;

GRANT SELECT ON v_loans_summary TO authenticated;
