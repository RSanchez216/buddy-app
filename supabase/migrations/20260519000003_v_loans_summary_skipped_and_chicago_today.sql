-- v_loans_summary: fix days_behind undercount + Chicago-time the date
-- comparisons + add unresolved-skipped fields.
--
-- 1) days_behind was scoped to status='pending' past-due rows, so a loan
--    with only skipped past-due rows showed 0 days behind. Broaden to
--    include status IN ('pending','skipped'). Verified 6 active loans
--    were undercounted before this change.
-- 2) days_behind, next_due_date, and overdue_count all used CURRENT_DATE
--    (UTC) and were wrong for ~5 hours each day (Chicago 7pm → midnight
--    UTC). Switch to (now() AT TIME ZONE 'America/Chicago')::date.
-- 3) Add unresolved_skipped_count and unresolved_skipped_amount so the
--    list page can show a per-loan SKIPPED column and offer a filter.
--
-- overdue_count keeps its pending-only scope on purpose — it drives the
-- existing Past Due Loans KPI tile and the Past Due Only filter chip.
-- Broadening overdue_count would silently change those surfaces.
--
-- Postgres CREATE OR REPLACE VIEW disallows reordering existing columns,
-- so the two new fields are appended at the end. Ordinal position is
-- not load-bearing for any frontend consumer.

CREATE OR REPLACE VIEW public.v_loans_summary AS
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
  e.name  AS entity_name,
  ld.name AS lender_name,
  fa.name AS funding_account_name,
  (SELECT count(*) FROM loan_equipment WHERE loan_equipment.loan_id = l.id) AS equipment_count,

  -- next_due_date: earliest pending row dated today-or-later (Chicago).
  (SELECT min(lp.due_date)
     FROM loan_payments lp
    WHERE lp.loan_id = l.id
      AND lp.status = 'pending'
      AND lp.due_date >= (now() AT TIME ZONE 'America/Chicago')::date
  ) AS next_due_date,

  -- days_behind: any unresolved past-due row (pending OR skipped) puts
  -- the loan off schedule. Chicago time.
  GREATEST(0, COALESCE((
    SELECT (now() AT TIME ZONE 'America/Chicago')::date - min(lp.due_date)
      FROM loan_payments lp
     WHERE lp.loan_id = l.id
       AND lp.status IN ('pending', 'skipped')
       AND lp.due_date < (now() AT TIME ZONE 'America/Chicago')::date
  ), 0)) AS days_behind,

  -- overdue_count: pending past-due only — drives Past Due tile + filter.
  (SELECT count(*)
     FROM loan_payments lp
    WHERE lp.loan_id = l.id
      AND lp.status = 'pending'
      AND lp.due_date < (now() AT TIME ZONE 'America/Chicago')::date
  ) AS overdue_count,

  (SELECT count(*) FROM loan_equipment le WHERE le.loan_id = l.id AND le.has_title = true)  AS title_received_count,
  (SELECT count(*) FROM loan_equipment le WHERE le.loan_id = l.id AND le.has_title = false) AS title_pending_count,
  CASE
    WHEN l.status = 'paid_off' AND EXISTS (
      SELECT 1 FROM loan_equipment le WHERE le.loan_id = l.id AND le.has_title = false
    ) THEN true
    ELSE false
  END AS title_release_pending,

  -- Unresolved skipped past-due: count + dollar total. Appended at the
  -- end because CREATE OR REPLACE VIEW can't insert columns mid-list.
  (SELECT count(*)
     FROM loan_payments lp
    WHERE lp.loan_id = l.id
      AND lp.status = 'skipped'
      AND lp.due_date < (now() AT TIME ZONE 'America/Chicago')::date
  ) AS unresolved_skipped_count,
  (SELECT COALESCE(sum(lp.scheduled_amount), 0)
     FROM loan_payments lp
    WHERE lp.loan_id = l.id
      AND lp.status = 'skipped'
      AND lp.due_date < (now() AT TIME ZONE 'America/Chicago')::date
  ) AS unresolved_skipped_amount

FROM loans l
  LEFT JOIN loan_entities e   ON l.entity_id = e.id
  LEFT JOIN loan_lenders  ld  ON l.lender_id = ld.id
  LEFT JOIN funding_accounts fa ON l.funding_account_id = fa.id;

NOTIFY pgrst, 'reload schema';
