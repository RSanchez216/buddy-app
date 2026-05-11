-- Time-series replacement for the single-snapshot balance on
-- funding_accounts. Each row is "the account read $X on date Y per the
-- bank." The Payment Calendar's projected_balances() walks from the
-- most recent entry forward through scheduled flows.
--
-- Legacy funding_accounts.current_balance / balance_as_of_date are
-- left in place but no longer written/read by the new UI. A follow-up
-- cleanup PR drops them once we confirm nothing else reads them.

CREATE TABLE public.funding_account_balance_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funding_account_id UUID NOT NULL REFERENCES public.funding_accounts(id) ON DELETE CASCADE,
  as_of_date DATE NOT NULL,
  balance NUMERIC NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'quickbooks')),
  entered_by UUID REFERENCES public.users(id),
  entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (funding_account_id, as_of_date)
);

CREATE INDEX idx_fabe_account_date
  ON public.funding_account_balance_entries (funding_account_id, as_of_date DESC);

-- public.set_updated_at() already exists in the DB; reuse it
CREATE TRIGGER trg_fabe_updated_at
  BEFORE UPDATE ON public.funding_account_balance_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.funding_account_balance_entries ENABLE ROW LEVEL SECURITY;

-- Match the existing funding_accounts pattern: any authenticated user
-- can CRUD. Application layer enforces role-based access via canEdit.
CREATE POLICY auth_select_fabe ON public.funding_account_balance_entries FOR SELECT USING (true);
CREATE POLICY auth_insert_fabe ON public.funding_account_balance_entries FOR INSERT WITH CHECK (true);
CREATE POLICY auth_update_fabe ON public.funding_account_balance_entries FOR UPDATE USING (true);
CREATE POLICY auth_delete_fabe ON public.funding_account_balance_entries FOR DELETE USING (true);

-- Backfill from existing snapshots — idempotent
INSERT INTO public.funding_account_balance_entries (
  funding_account_id, as_of_date, balance, source, entered_by, entered_at, notes
)
SELECT
  fa.id,
  fa.balance_as_of_date,
  fa.current_balance,
  'manual',
  fa.balance_updated_by,
  COALESCE(fa.balance_updated_at, now()),
  'Backfilled from initial funding_accounts snapshot'
FROM public.funding_accounts fa
WHERE fa.current_balance IS NOT NULL
  AND fa.balance_as_of_date IS NOT NULL
ON CONFLICT (funding_account_id, as_of_date) DO NOTHING;

-- View for the Bank Accounts list page
CREATE OR REPLACE VIEW public.v_funding_accounts_with_balance AS
SELECT
  fa.id,
  fa.name,
  fa.bank_name,
  fa.last_four,
  fa.notes,
  fa.is_active,
  fa.created_at,
  latest.balance                AS balance,
  latest.as_of_date             AS balance_as_of_date,
  latest.entered_at             AS balance_entered_at,
  latest.entered_by             AS balance_entered_by,
  latest.source                 AS balance_source,
  CASE
    WHEN latest.as_of_date IS NULL THEN NULL
    ELSE ((now() AT TIME ZONE 'America/Chicago')::date - latest.as_of_date)::int
  END                           AS days_since_balance
FROM public.funding_accounts fa
LEFT JOIN LATERAL (
  SELECT e.*
  FROM public.funding_account_balance_entries e
  WHERE e.funding_account_id = fa.id
  ORDER BY e.as_of_date DESC, e.entered_at DESC
  LIMIT 1
) latest ON TRUE;

GRANT SELECT ON public.v_funding_accounts_with_balance TO authenticated;

-- Projection function. Walks from the most recent anchor on or before
-- p_end_date through every scheduled flow on the account up to
-- p_end_date. Returns one row per day. is_anchor_day flags the row
-- whose starting_balance came from a real recorded entry (vs. a
-- carry-forward from the prior day's ending).
CREATE OR REPLACE FUNCTION public.projected_balances(
  p_funding_account_id UUID,
  p_end_date           DATE
)
RETURNS TABLE (
  as_of_date       DATE,
  starting_balance NUMERIC,
  inflow           NUMERIC,
  outflow          NUMERIC,
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
      ), 0)
        AS total_outflow,
      COALESCE((
        SELECT SUM(eid.amount)
        FROM public.expected_inflow_deposits eid
        JOIN public.expected_inflows ei ON ei.id = eid.expected_inflow_id
        WHERE eid.funding_account_id = p_funding_account_id
          AND ei.status = 'pending'
          AND ei.expected_date = ds.d
      ), 0) AS total_inflow
    FROM date_series ds
  ),
  walk AS (
    SELECT
      a.as_of_date,
      a.balance              AS starting_balance,
      f.total_inflow         AS inflow,
      f.total_outflow        AS outflow,
      a.balance + f.total_inflow - f.total_outflow AS ending_balance,
      TRUE                   AS is_anchor_day,
      1                      AS rn
    FROM anchor a
    JOIN daily_flows f ON f.date = a.as_of_date

    UNION ALL

    SELECT
      f.date,
      w.ending_balance       AS starting_balance,
      f.total_inflow,
      f.total_outflow,
      w.ending_balance + f.total_inflow - f.total_outflow AS ending_balance,
      FALSE                  AS is_anchor_day,
      w.rn + 1
    FROM walk w
    JOIN daily_flows f ON f.date = w.as_of_date + 1
    WHERE w.as_of_date + 1 <= p_end_date
  )
  SELECT as_of_date, starting_balance, inflow, outflow, ending_balance, is_anchor_day
  FROM walk
  ORDER BY as_of_date;
$$;

GRANT EXECUTE ON FUNCTION public.projected_balances(UUID, DATE) TO authenticated;
