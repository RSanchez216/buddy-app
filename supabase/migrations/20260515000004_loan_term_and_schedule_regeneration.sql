-- Loan term + schedule regeneration.
--
-- Adds loans.term_months as a first-class field (was previously implicit in
-- the spread between first_payment_date and maturity_date). Backfills from
-- existing data; production has two maturity_date conventions (some loans
-- set maturity = last payment date; others set maturity = first + term*month)
-- so the backfill formula assumes the former. Loans following the latter
-- convention will backfill to term+1 and need manual correction in the UI —
-- e.g., ALLY-TEE CYBERTRUCK backfills to 73 instead of 72.
--
-- regenerate_loan_schedule(p_loan_id) is idempotent — it only inserts pending
-- rows for dates not already present in loan_payments. Existing paid /
-- partial / skipped rows are never modified. Safe to call repeatedly.

ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS term_months SMALLINT;

UPDATE public.loans
SET term_months = (
  EXTRACT(YEAR FROM AGE(maturity_date, first_payment_date)) * 12
  + EXTRACT(MONTH FROM AGE(maturity_date, first_payment_date)) + 1
)::smallint
WHERE term_months IS NULL
  AND first_payment_date IS NOT NULL
  AND maturity_date IS NOT NULL;

CREATE OR REPLACE FUNCTION public.regenerate_loan_schedule(p_loan_id UUID)
RETURNS TABLE (rows_inserted INT, total_rows INT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_loan RECORD;
  v_existing_dates DATE[];
  v_expected_date DATE;
  v_inserted INT := 0;
  v_total INT;
BEGIN
  SELECT * INTO v_loan FROM public.loans WHERE id = p_loan_id;

  IF v_loan.first_payment_date IS NULL OR v_loan.term_months IS NULL OR v_loan.monthly_payment IS NULL THEN
    RAISE EXCEPTION 'Loan % missing first_payment_date, term_months, or monthly_payment', p_loan_id;
  END IF;

  SELECT array_agg(due_date) INTO v_existing_dates
  FROM public.loan_payments
  WHERE loan_id = p_loan_id;

  FOR i IN 0..(v_loan.term_months - 1) LOOP
    v_expected_date := v_loan.first_payment_date + (i * INTERVAL '1 month');

    IF v_existing_dates IS NULL OR NOT (v_expected_date = ANY(v_existing_dates)) THEN
      INSERT INTO public.loan_payments (
        loan_id, due_month, due_date, scheduled_amount, status, planned_pay_date
      ) VALUES (
        p_loan_id,
        date_trunc('month', v_expected_date)::date,
        v_expected_date,
        v_loan.monthly_payment,
        'pending',
        v_expected_date
      );
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_total FROM public.loan_payments WHERE loan_id = p_loan_id;

  RETURN QUERY SELECT v_inserted, v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.regenerate_loan_schedule(UUID) TO authenticated;
