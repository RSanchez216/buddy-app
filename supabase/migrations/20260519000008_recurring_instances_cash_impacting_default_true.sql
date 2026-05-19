-- Revert 20260519000007. After a real-world data incident where the
-- accounting manager read "Cash" as referring to physical paper money
-- rather than money moving through bank accounts and authorized a bulk
-- FALSE flip, we're putting the default back to TRUE so generated rows
-- contribute to the Payment Calendar's cash-flow projection by default.
-- The user-facing label is being renamed "Cash" -> "Bank impact" in the
-- companion frontend change so the meaning is no longer ambiguous.
--
-- Function body is otherwise identical to 20260519000007 / 20260519000005;
-- only the cash_impacting literal in the INSERT VALUES list flips.

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
