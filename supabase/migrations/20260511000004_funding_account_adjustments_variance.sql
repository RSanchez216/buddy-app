-- Variance reconciliation: when a recorded balance differs from the
-- prior day's projected ending, store the difference as a signed
-- "reconciliation adjustment" on the previous day. Adjustments are
-- real entries that flow through projected_balances() and surface on
-- the calendar with a yellow flag until a human classifies them.

CREATE TABLE public.funding_account_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funding_account_id UUID NOT NULL REFERENCES public.funding_accounts(id) ON DELETE CASCADE,
  adjustment_date DATE NOT NULL,
  amount NUMERIC NOT NULL,
  source_balance_entry_id UUID NOT NULL REFERENCES public.funding_account_balance_entries(id) ON DELETE CASCADE,
  classification TEXT
    CHECK (classification IS NULL OR classification IN (
      'bank_fee',
      'untracked_transfer',
      'untracked_deposit',
      'refund',
      'unauthorized_charge',
      'unidentified',
      'other'
    )),
  notes TEXT,
  classified_by UUID REFERENCES public.users(id),
  classified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_faa_account_date ON public.funding_account_adjustments (funding_account_id, adjustment_date);
CREATE INDEX idx_faa_source_entry ON public.funding_account_adjustments (source_balance_entry_id);
CREATE INDEX idx_faa_unclassified
  ON public.funding_account_adjustments (funding_account_id)
  WHERE classification IS NULL;

CREATE TRIGGER trg_faa_updated_at
  BEFORE UPDATE ON public.funding_account_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.funding_account_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_select_faa ON public.funding_account_adjustments FOR SELECT USING (true);
CREATE POLICY auth_insert_faa ON public.funding_account_adjustments FOR INSERT WITH CHECK (true);
CREATE POLICY auth_update_faa ON public.funding_account_adjustments FOR UPDATE USING (true);
CREATE POLICY auth_delete_faa ON public.funding_account_adjustments FOR DELETE USING (true);

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
      ), 0) AS total_adjustment
    FROM date_series ds
  ),
  walk AS (
    SELECT
      a.as_of_date,
      a.balance                                                          AS starting_balance,
      f.total_inflow                                                     AS inflow,
      f.total_outflow                                                    AS outflow,
      f.total_adjustment                                                 AS adjustment,
      a.balance + f.total_inflow - f.total_outflow + f.total_adjustment  AS ending_balance,
      TRUE                                                               AS is_anchor_day,
      1                                                                  AS rn
    FROM anchor a
    JOIN daily_flows f ON f.date = a.as_of_date

    UNION ALL

    SELECT
      f.date,
      w.ending_balance,
      f.total_inflow,
      f.total_outflow,
      f.total_adjustment,
      w.ending_balance + f.total_inflow - f.total_outflow + f.total_adjustment,
      FALSE,
      w.rn + 1
    FROM walk w
    JOIN daily_flows f ON f.date = w.as_of_date + 1
    WHERE w.as_of_date + 1 <= p_end_date
  )
  SELECT as_of_date, starting_balance, inflow, outflow, adjustment, ending_balance, is_anchor_day
  FROM walk
  ORDER BY as_of_date;
$$;

GRANT EXECUTE ON FUNCTION public.projected_balances(UUID, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_balance_entry_variance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_account_id   UUID;
  v_from_date    DATE;
  v_entry        RECORD;
  v_has_prior    BOOLEAN;
  v_expected     NUMERIC;
  v_variance     NUMERIC;
  v_threshold    NUMERIC := 0.01;
BEGIN
  v_account_id := COALESCE(NEW.funding_account_id, OLD.funding_account_id);
  v_from_date  := LEAST(
                    COALESCE(NEW.as_of_date, OLD.as_of_date),
                    COALESCE(OLD.as_of_date, NEW.as_of_date)
                  );

  FOR v_entry IN
    SELECT *
    FROM public.funding_account_balance_entries
    WHERE funding_account_id = v_account_id
      AND as_of_date >= v_from_date
    ORDER BY as_of_date ASC, entered_at ASC
  LOOP
    DELETE FROM public.funding_account_adjustments
    WHERE source_balance_entry_id = v_entry.id;

    SELECT EXISTS (
      SELECT 1 FROM public.funding_account_balance_entries
      WHERE funding_account_id = v_account_id
        AND as_of_date < v_entry.as_of_date
    ) INTO v_has_prior;

    IF v_has_prior THEN
      SELECT pb.ending_balance INTO v_expected
      FROM public.projected_balances(v_account_id, v_entry.as_of_date - 1) pb
      WHERE pb.as_of_date = v_entry.as_of_date - 1;

      IF v_expected IS NOT NULL THEN
        v_variance := v_entry.balance - v_expected;
        IF ABS(v_variance) > v_threshold THEN
          INSERT INTO public.funding_account_adjustments (
            funding_account_id, adjustment_date, amount, source_balance_entry_id
          ) VALUES (
            v_account_id,
            v_entry.as_of_date - 1,
            v_variance,
            v_entry.id
          );
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_fabe_sync_variance
  AFTER INSERT OR UPDATE OR DELETE
  ON public.funding_account_balance_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_balance_entry_variance();

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
  END                           AS days_since_balance,
  COALESCE(adj.unclassified_count, 0) AS unclassified_adjustments_count,
  COALESCE(adj.unclassified_total, 0) AS unclassified_adjustments_total
FROM public.funding_accounts fa
LEFT JOIN LATERAL (
  SELECT e.*
  FROM public.funding_account_balance_entries e
  WHERE e.funding_account_id = fa.id
  ORDER BY e.as_of_date DESC, e.entered_at DESC
  LIMIT 1
) latest ON TRUE
LEFT JOIN LATERAL (
  SELECT count(*) AS unclassified_count, SUM(ABS(a.amount)) AS unclassified_total
  FROM public.funding_account_adjustments a
  WHERE a.funding_account_id = fa.id
    AND a.classification IS NULL
) adj ON TRUE;

GRANT SELECT ON public.v_funding_accounts_with_balance TO authenticated;
