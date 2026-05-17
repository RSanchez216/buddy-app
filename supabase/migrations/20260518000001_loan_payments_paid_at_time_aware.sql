-- loan_payments time-awareness — paid_at column + projected_balances rewrite
--
-- Mirrors the work already done for custom_outflows + invoices. loan_payments
-- was the last outflow source still using a naive "if status=paid, exclude"
-- model in the projection. With paid_at, the anchor day can correctly include
-- a payment marked paid AFTER the balance was entered (because the balance
-- doesn't yet reflect it) and exclude one marked paid BEFORE the balance
-- (because the balance already does).

ALTER TABLE public.loan_payments
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

UPDATE public.loan_payments
SET paid_at = updated_at
WHERE status = 'paid' AND paid_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lp_paid_at
  ON public.loan_payments (loan_id, paid_date, paid_at)
  WHERE status = 'paid';

CREATE OR REPLACE FUNCTION public.projected_balances(
  p_funding_account_id UUID,
  p_end_date           DATE
)
RETURNS TABLE (
  as_of_date       DATE,
  starting_balance NUMERIC,
  inflow           NUMERIC,
  outflow          NUMERIC,
  adjustment       NUMERIC,
  transfer_in      NUMERIC,
  transfer_out     NUMERIC,
  ending_balance   NUMERIC,
  is_anchor_day    BOOLEAN
)
LANGUAGE sql STABLE
AS $$
  WITH RECURSIVE anchor AS (
    SELECT e.as_of_date, e.balance, e.entered_at
    FROM public.funding_account_balance_entries e
    WHERE e.funding_account_id = p_funding_account_id
      AND e.as_of_date <= p_end_date
    ORDER BY e.as_of_date DESC, e.entered_at DESC
    LIMIT 1
  ),
  date_series AS (
    SELECT generate_series(
      (SELECT as_of_date FROM anchor),
      p_end_date,
      INTERVAL '1 day'
    )::date AS d
  ),
  daily_flows AS (
    SELECT
      ds.d AS date,
      COALESCE((
        SELECT SUM(lp.scheduled_amount)
        FROM public.loan_payments lp
        JOIN public.loans l ON l.id = lp.loan_id
        WHERE l.funding_account_id = p_funding_account_id
          AND (
            (ds.d <> (SELECT as_of_date FROM anchor)
              AND lp.status IN ('pending','partial')
              AND COALESCE(lp.planned_pay_date, lp.due_date) = ds.d)
            OR
            (ds.d = (SELECT as_of_date FROM anchor) AND (
              (lp.status IN ('pending','partial') AND COALESCE(lp.planned_pay_date, lp.due_date) = ds.d)
              OR
              (lp.status = 'paid'
                AND lp.paid_date = ds.d
                AND lp.paid_at IS NOT NULL
                AND lp.paid_at > (SELECT entered_at FROM anchor))
            ))
          )
      ), 0) +
      COALESCE((
        SELECT SUM(co.amount)
        FROM public.custom_outflows co
        WHERE co.funding_account_id = p_funding_account_id
          AND co.cash_impacting = TRUE
          AND (
            (ds.d <> (SELECT as_of_date FROM anchor)
              AND co.status = 'planned'
              AND COALESCE(co.planned_pay_date, co.due_date) = ds.d)
            OR
            (ds.d = (SELECT as_of_date FROM anchor) AND (
              (co.status = 'planned' AND COALESCE(co.planned_pay_date, co.due_date) = ds.d)
              OR
              (co.status = 'paid'
                AND co.paid_date = ds.d
                AND co.paid_at IS NOT NULL
                AND co.paid_at > (SELECT entered_at FROM anchor))
            ))
          )
      ), 0) +
      COALESCE((
        SELECT SUM(i.amount)
        FROM public.invoices i
        WHERE i.funding_account_id = p_funding_account_id
          AND i.deleted_at IS NULL
          AND (
            (ds.d <> (SELECT as_of_date FROM anchor)
              AND i.status IN ('Pending','Approved')
              AND COALESCE(i.planned_pay_date, i.due_date) = ds.d)
            OR
            (ds.d = (SELECT as_of_date FROM anchor) AND (
              (i.status IN ('Pending','Approved') AND COALESCE(i.planned_pay_date, i.due_date) = ds.d)
              OR
              (i.status = 'Paid'
                AND i.paid_date = ds.d
                AND i.paid_at IS NOT NULL
                AND i.paid_at > (SELECT entered_at FROM anchor))
            ))
          )
      ), 0) AS total_outflow,
      COALESCE((
        SELECT SUM(eid.amount)
        FROM public.expected_inflow_deposits eid
        JOIN public.expected_inflows ei ON ei.id = eid.expected_inflow_id
        WHERE eid.funding_account_id = p_funding_account_id
          AND ei.status = 'pending'
          AND ei.expected_date = ds.d
      ), 0) AS total_inflow,
      COALESCE((
        SELECT SUM(a.amount)
        FROM public.funding_account_adjustments a
        WHERE a.funding_account_id = p_funding_account_id
          AND a.adjustment_date = ds.d
      ), 0) AS total_adjustment,
      COALESCE((
        SELECT SUM(t.amount)
        FROM public.funding_account_transfers t
        WHERE t.from_funding_account_id = p_funding_account_id
          AND t.debit_date = ds.d
          AND (
            ds.d <> (SELECT as_of_date FROM anchor)
            OR t.created_at > (SELECT entered_at FROM anchor)
          )
      ), 0) AS total_transfer_out,
      COALESCE((
        SELECT SUM(t.amount)
        FROM public.funding_account_transfers t
        WHERE t.to_funding_account_id = p_funding_account_id
          AND t.credit_date = ds.d
          AND (
            ds.d <> (SELECT as_of_date FROM anchor)
            OR t.created_at > (SELECT entered_at FROM anchor)
          )
      ), 0) AS total_transfer_in
    FROM date_series ds
  ),
  walk AS (
    SELECT
      a.as_of_date,
      a.balance                                                                                                AS starting_balance,
      f.total_inflow                                                                                           AS inflow,
      f.total_outflow                                                                                          AS outflow,
      f.total_adjustment                                                                                       AS adjustment,
      f.total_transfer_in                                                                                      AS transfer_in,
      f.total_transfer_out                                                                                     AS transfer_out,
      a.balance + f.total_inflow - f.total_outflow + f.total_adjustment + f.total_transfer_in - f.total_transfer_out  AS ending_balance,
      TRUE                                                                                                     AS is_anchor_day,
      1                                                                                                        AS rn
    FROM anchor a
    JOIN daily_flows f ON f.date = a.as_of_date

    UNION ALL

    SELECT
      f.date,
      w.ending_balance,
      f.total_inflow,
      f.total_outflow,
      f.total_adjustment,
      f.total_transfer_in,
      f.total_transfer_out,
      w.ending_balance + f.total_inflow - f.total_outflow + f.total_adjustment + f.total_transfer_in - f.total_transfer_out,
      FALSE,
      w.rn + 1
    FROM walk w
    JOIN daily_flows f ON f.date = w.as_of_date + 1
    WHERE w.as_of_date + 1 <= p_end_date
  )
  SELECT as_of_date, starting_balance, inflow, outflow, adjustment, transfer_in, transfer_out, ending_balance, is_anchor_day
  FROM walk
  ORDER BY as_of_date;
$$;

GRANT EXECUTE ON FUNCTION public.projected_balances(UUID, DATE) TO authenticated;
