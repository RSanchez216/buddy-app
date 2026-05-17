-- Fix regenerate_loan_schedule(): dedup against due_month (matches the
-- (loan_id, due_month) unique constraint), and use loans.due_day for the
-- generated day-of-month (clamped to month length for Feb / short months).
--
-- Bug: the previous version compared against existing due_date values.
-- When existing rows fell on a different day-of-month than the generator
-- (e.g., CCG-TRUCK rows on the 22nd while first_payment_date.day = 31),
-- the dedup check missed the collision and the INSERT failed with
-- duplicate key on (loan_id, due_month).
--
-- Also: previous version ignored loans.due_day, so generated rows landed
-- on the day-of-month of first_payment_date (often the 31st, with month
-- truncation). New rows now honor due_day when set.

CREATE OR REPLACE FUNCTION public.regenerate_loan_schedule(p_loan_id uuid)
RETURNS TABLE(rows_inserted integer, total_rows integer)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_loan            RECORD;
  v_existing_months DATE[];
  v_target_day      INT;
  v_month_start     DATE;
  v_last_day        DATE;
  v_expected_due    DATE;
  v_inserted        INT := 0;
  v_total           INT;
BEGIN
  SELECT * INTO v_loan FROM public.loans WHERE id = p_loan_id;

  IF v_loan.first_payment_date IS NULL
     OR v_loan.term_months IS NULL
     OR v_loan.monthly_payment IS NULL THEN
    RAISE EXCEPTION 'Loan % missing first_payment_date, term_months, or monthly_payment', p_loan_id;
  END IF;

  -- Compare against due_month (matches the unique constraint on (loan_id, due_month)),
  -- not due_date — existing rows may not share the same day-of-month as the generator.
  SELECT array_agg(due_month) INTO v_existing_months
  FROM public.loan_payments
  WHERE loan_id = p_loan_id;

  -- Anchor day-of-month: prefer loan.due_day, fall back to first_payment_date's day.
  v_target_day := COALESCE(
    v_loan.due_day,
    EXTRACT(DAY FROM v_loan.first_payment_date)::int
  );

  FOR i IN 0..(v_loan.term_months - 1) LOOP
    v_month_start := (date_trunc('month', v_loan.first_payment_date) + (i * INTERVAL '1 month'))::date;
    v_last_day    := (v_month_start + INTERVAL '1 month - 1 day')::date;

    -- Clamp target day to month length (handles Feb / 30-day months).
    v_expected_due := LEAST(
      (v_month_start + ((v_target_day - 1) * INTERVAL '1 day'))::date,
      v_last_day
    );

    IF v_existing_months IS NULL OR NOT (v_month_start = ANY(v_existing_months)) THEN
      INSERT INTO public.loan_payments (
        loan_id, due_month, due_date, scheduled_amount, status, planned_pay_date
      ) VALUES (
        p_loan_id,
        v_month_start,
        v_expected_due,
        v_loan.monthly_payment,
        'pending',
        v_expected_due
      )
      ON CONFLICT (loan_id, due_month) DO NOTHING;

      IF FOUND THEN
        v_inserted := v_inserted + 1;
      END IF;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_total FROM public.loan_payments WHERE loan_id = p_loan_id;

  RETURN QUERY SELECT v_inserted, v_total;
END;
$function$;

NOTIFY pgrst, 'reload schema';
