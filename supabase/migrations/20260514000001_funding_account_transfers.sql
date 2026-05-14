-- Inter-account transfers — two-date model so we can model the "in transit"
-- float on inter-bank wires (money has left source but not yet arrived at
-- destination). Each row is a single transfer; the projection function reads
-- both legs (out on debit_date for source, in on credit_date for destination).

CREATE TABLE public.funding_account_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_funding_account_id UUID NOT NULL REFERENCES public.funding_accounts(id) ON DELETE RESTRICT,
  to_funding_account_id   UUID NOT NULL REFERENCES public.funding_accounts(id) ON DELETE RESTRICT,
  amount                  NUMERIC NOT NULL CHECK (amount > 0),
  debit_date              DATE NOT NULL,
  credit_date             DATE NOT NULL,
  notes                   TEXT,
  created_by              UUID REFERENCES public.users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fat_distinct_accounts CHECK (from_funding_account_id <> to_funding_account_id),
  CONSTRAINT fat_credit_after_debit CHECK (credit_date >= debit_date)
);

CREATE INDEX idx_fat_from_debit ON public.funding_account_transfers (from_funding_account_id, debit_date);
CREATE INDEX idx_fat_to_credit  ON public.funding_account_transfers (to_funding_account_id, credit_date);

CREATE TRIGGER trg_fat_updated_at
  BEFORE UPDATE ON public.funding_account_transfers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: open-to-authenticated, matching every other table in this schema.
-- Role-based gating happens in the app (canEdit / isAdmin) — the spec
-- suggested role-restricted policies, but introducing a new RLS pattern
-- here would diverge from the rest of the schema.
ALTER TABLE public.funding_account_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_select_fat ON public.funding_account_transfers FOR SELECT USING (true);
CREATE POLICY auth_insert_fat ON public.funding_account_transfers FOR INSERT WITH CHECK (true);
CREATE POLICY auth_update_fat ON public.funding_account_transfers FOR UPDATE USING (true);
CREATE POLICY auth_delete_fat ON public.funding_account_transfers FOR DELETE USING (true);

-- projected_balances v3 — adds transfer_in / transfer_out columns alongside
-- the existing inflow / outflow / adjustment columns. The recursive walk
-- still goes anchor → end_date, just summing one extra pair of flow types.

DROP FUNCTION IF EXISTS public.projected_balances(UUID, DATE);

CREATE FUNCTION public.projected_balances(
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
    SELECT e.as_of_date, e.balance
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
          AND lp.status IN ('pending','partial')
          AND COALESCE(lp.planned_pay_date, lp.due_date) = ds.d
      ), 0) +
      COALESCE((
        SELECT SUM(co.amount)
        FROM public.custom_outflows co
        WHERE co.funding_account_id = p_funding_account_id
          AND co.status = 'planned'
          AND co.cash_impacting = TRUE
          AND COALESCE(co.planned_pay_date, co.due_date) = ds.d
      ), 0) +
      COALESCE((
        SELECT SUM(i.amount)
        FROM public.invoices i
        WHERE i.funding_account_id = p_funding_account_id
          AND i.status IN ('Pending','Approved')
          AND i.deleted_at IS NULL
          AND COALESCE(i.planned_pay_date, i.due_date) = ds.d
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
      ), 0) AS total_transfer_out,
      COALESCE((
        SELECT SUM(t.amount)
        FROM public.funding_account_transfers t
        WHERE t.to_funding_account_id = p_funding_account_id
          AND t.credit_date = ds.d
      ), 0) AS total_transfer_in
    FROM date_series ds
  ),
  walk AS (
    SELECT
      a.as_of_date,
      a.balance                                                                                                                AS starting_balance,
      f.total_inflow                                                                                                           AS inflow,
      f.total_outflow                                                                                                          AS outflow,
      f.total_adjustment                                                                                                       AS adjustment,
      f.total_transfer_in                                                                                                      AS transfer_in,
      f.total_transfer_out                                                                                                     AS transfer_out,
      a.balance + f.total_inflow - f.total_outflow + f.total_adjustment + f.total_transfer_in - f.total_transfer_out           AS ending_balance,
      TRUE                                                                                                                     AS is_anchor_day,
      1                                                                                                                        AS rn
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
