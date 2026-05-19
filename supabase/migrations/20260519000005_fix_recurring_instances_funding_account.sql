-- Fix generate_recurring_instances so generated custom_outflows carry the
-- template's funding_account_id (was being dropped on insert, causing every
-- recurring instance to land in the Unassigned Items panel).
--
-- Same INSERT also adds planned_pay_date (= due_date for new instances so the
-- Payment Calendar's time-aware projection just works) and cash_impacting
-- (= TRUE, matching the manual-create default).
--
-- Secondary cleanup:
--   * Default p_through_date now uses Chicago-local "today" + 1 year,
--     standardizing with the rest of the codebase's timezone rule.
--   * inserted_count now reflects rows actually inserted (FOUND after the
--     conflict-guarded INSERT), not loop iterations — so callers get an
--     honest delta when a template is re-generated.

CREATE OR REPLACE FUNCTION public.generate_recurring_instances(
  p_template_id uuid,
  p_through_date date DEFAULT ((now() AT TIME ZONE 'America/Chicago')::date + INTERVAL '1 year')::date
)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  tmpl           RECORD;
  cursor_date    DATE;
  inserted_count INT := 0;
BEGIN
  SELECT * INTO tmpl
  FROM public.recurring_expense_templates
  WHERE id = p_template_id AND is_active = TRUE;

  IF NOT FOUND THEN RETURN 0; END IF;

  cursor_date := tmpl.start_date;

  WHILE cursor_date <= LEAST(p_through_date, COALESCE(tmpl.end_date, p_through_date)) LOOP
    INSERT INTO public.custom_outflows (
      entity_id,
      recurring_template_id,
      due_date,
      planned_pay_date,
      amount,
      description,
      category,
      status,
      funding_account_id,
      cash_impacting
    )
    VALUES (
      tmpl.entity_id,
      tmpl.id,
      cursor_date,
      cursor_date,
      tmpl.amount,
      tmpl.name,
      tmpl.category,
      'planned',
      tmpl.funding_account_id,
      TRUE
    )
    ON CONFLICT DO NOTHING;

    IF FOUND THEN
      inserted_count := inserted_count + 1;
    END IF;

    cursor_date := CASE tmpl.frequency
      WHEN 'weekly'      THEN cursor_date + INTERVAL '1 week'
      WHEN 'biweekly'    THEN cursor_date + INTERVAL '2 weeks'
      WHEN 'monthly'     THEN cursor_date + INTERVAL '1 month'
      WHEN 'quarterly'   THEN cursor_date + INTERVAL '3 months'
      WHEN 'annually'    THEN cursor_date + INTERVAL '1 year'
      WHEN 'semimonthly' THEN
        CASE WHEN EXTRACT(DAY FROM cursor_date) < COALESCE(tmpl.second_day_of_month, 15)
             THEN date_trunc('month', cursor_date)::date + (COALESCE(tmpl.second_day_of_month, 15) - 1)
             ELSE (date_trunc('month', cursor_date) + INTERVAL '1 month')::date + (tmpl.day_of_month - 1)
        END
    END::DATE;
  END LOOP;

  RETURN inserted_count;
END;
$function$;

NOTIFY pgrst, 'reload schema';
