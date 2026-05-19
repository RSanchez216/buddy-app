-- Flip the generate_recurring_instances() INSERT default from
-- cash_impacting = TRUE to FALSE. The Quick Line Add and Batch Detail
-- "+ Add line" surfaces already default unchecked; this brings the
-- function-generated rows in line so the recurring-template path stops
-- producing visibly different state from the manual paths.
--
-- A one-shot data backfill runs alongside this migration via the MCP
-- session: UPDATE custom_outflows SET cash_impacting = FALSE WHERE
-- recurring_template_id IS NOT NULL AND status = 'planned' AND
-- planned_pay_date >= today. Currently affects the 52 Vanguard
-- instances from 2026-05-21 through 2027-05-13. Audit-logged.

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
      FALSE
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
