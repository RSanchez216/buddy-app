-- Rebuild v_cash_flow_events to expose funding_account_id + funding_account_name
-- on every UNION ALL branch.
--
-- Inflow rows still carry the inflow's `funding_account_id` column (legacy
-- single-bank attribution). Inflows that split across multiple banks via
-- expected_inflow_deposits have their per-bank breakdown handled client-side
-- by the calendar — this view just gives us a single chip per inflow.
--
-- Idempotent: CREATE OR REPLACE VIEW. Running this on a database that already
-- has the columns is a no-op for the column structure, but does refresh the
-- definition (in case generate_recurring_instances or other downstream
-- references changed).

DROP VIEW IF EXISTS public.v_cash_flow_events;

CREATE VIEW public.v_cash_flow_events AS
  SELECT
    lp.id::text AS event_id,
    COALESCE(lp.paid_date, lp.planned_pay_date, lp.due_date) AS event_date,
    lp.due_date AS original_due_date,
    l.entity_id,
    e.name AS entity_name,
    'outflow'::text AS direction,
    'loan'::text    AS category,
    lp.scheduled_amount AS amount,
    concat(ld.name, ' — ', l.loan_id_external) AS label,
    l.id::text  AS reference_id,
    'loan'::text AS reference_type,
    lp.status,
    false AS is_draggable,
    true  AS due_date_locked,
    l.funding_account_id,
    fa.name AS funding_account_name
  FROM loan_payments lp
  JOIN loans l            ON lp.loan_id  = l.id
  LEFT JOIN loan_entities  e  ON l.entity_id = e.id
  LEFT JOIN loan_lenders   ld ON l.lender_id = ld.id
  LEFT JOIN funding_accounts fa ON l.funding_account_id = fa.id
  WHERE lp.status IN ('pending', 'partial', 'paid')

  UNION ALL
  SELECT
    i.id::text,
    COALESCE(i.planned_pay_date, i.due_date),
    i.due_date,
    NULL::uuid,
    NULL::text,
    'outflow',
    'ap_bill',
    i.amount,
    concat(COALESCE(v.name, 'Vendor'), ' — ', COALESCE(i.invoice_number, 'no #')),
    i.id::text,
    'invoice',
    i.status,
    true,  false,
    i.funding_account_id,
    fa.name
  FROM invoices i
  LEFT JOIN vendors          v  ON i.vendor_id = v.id
  LEFT JOIN funding_accounts fa ON i.funding_account_id = fa.id
  WHERE LOWER(i.status) IN ('pending', 'scheduled', 'approved', 'paid')
    AND i.due_date IS NOT NULL
    AND i.deleted_at IS NULL

  UNION ALL
  SELECT
    co.id::text,
    COALESCE(co.paid_date, co.planned_pay_date, co.due_date),
    co.due_date,
    co.entity_id,
    e.name,
    'outflow',
    CASE WHEN co.recurring_template_id IS NOT NULL THEN 'recurring' ELSE 'custom' END,
    co.amount,
    co.description,
    co.id::text,
    CASE WHEN co.recurring_template_id IS NOT NULL THEN 'recurring' ELSE 'custom' END,
    co.status,
    true,  false,
    co.funding_account_id,
    fa.name
  FROM custom_outflows co
  LEFT JOIN loan_entities    e  ON co.entity_id = e.id
  LEFT JOIN funding_accounts fa ON co.funding_account_id = fa.id
  WHERE co.status IN ('planned', 'paid')

  UNION ALL
  SELECT
    ei.id::text,
    COALESCE(ei.received_date, ei.expected_date),
    ei.expected_date,
    ei.entity_id,
    e.name,
    'inflow',
    'expected_income',
    COALESCE(ei.received_amount, ei.amount),
    ei.source,
    ei.id::text,
    'inflow',
    ei.status,
    true,  false,
    ei.funding_account_id,
    fa.name
  FROM expected_inflows ei
  LEFT JOIN loan_entities    e  ON ei.entity_id = e.id
  LEFT JOIN funding_accounts fa ON ei.funding_account_id = fa.id
  WHERE ei.status IN ('pending', 'received');

-- generate_recurring_instances: ensure newly-generated custom_outflows
-- inherit the template's funding_account_id. CREATE OR REPLACE is safe.
CREATE OR REPLACE FUNCTION public.generate_recurring_instances(
  p_template_id   uuid,
  p_through_date  date DEFAULT (CURRENT_DATE + '1 year'::interval)
)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  tmpl RECORD;
  cursor_date DATE;
  inserted_count INT := 0;
BEGIN
  SELECT * INTO tmpl
  FROM recurring_expense_templates
  WHERE id = p_template_id AND is_active = TRUE;

  IF NOT FOUND THEN RETURN 0; END IF;

  cursor_date := tmpl.start_date;

  WHILE cursor_date <= LEAST(p_through_date, COALESCE(tmpl.end_date, p_through_date)) LOOP
    INSERT INTO custom_outflows (
      entity_id,
      recurring_template_id,
      due_date,
      amount,
      description,
      category,
      status,
      funding_account_id
    )
    VALUES (
      tmpl.entity_id,
      tmpl.id,
      cursor_date,
      tmpl.amount,
      tmpl.name,
      tmpl.category,
      'planned',
      tmpl.funding_account_id
    )
    ON CONFLICT DO NOTHING;

    inserted_count := inserted_count + 1;

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
