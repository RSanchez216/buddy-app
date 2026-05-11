-- v_unassigned_funding_items — actionable items that lack a
-- funding_account_id, surfaced together for the Payment Calendar's
-- warning panel. Four sources unioned:
--   • Active loans (cascades to their pending loan_payments via loan_id)
--   • Planned custom outflows
--   • Pending invoices (Approved kept in the filter for forward-compat
--     even though only 'Pending' exists in the data today)
--   • Pending expected_inflows that have NO deposit splits at all
--     (a partial split is intentional; only the zero-split case lands
--     on the calendar as "Unassigned")

CREATE OR REPLACE VIEW public.v_unassigned_funding_items AS

SELECT
  'loan'::text                                          AS source_type,
  l.id                                                  AS source_id,
  COALESCE(l.task_name, l.contract_number, '(unnamed loan)') AS label,
  ll.name                                               AS subtitle,
  le.name                                               AS entity_name,
  l.monthly_payment                                     AS amount,
  (
    SELECT MIN(lp.due_date)
    FROM public.loan_payments lp
    WHERE lp.loan_id = l.id
      AND lp.status IN ('pending','partial')
      AND lp.due_date >= CURRENT_DATE
  )                                                     AS next_due_date,
  (
    SELECT COUNT(*)
    FROM public.loan_payments lp
    WHERE lp.loan_id = l.id
      AND lp.status IN ('pending','partial')
  )                                                     AS pending_count,
  l.contract_number                                     AS reference
FROM public.loans l
LEFT JOIN public.loan_lenders ll  ON ll.id = l.lender_id
LEFT JOIN public.loan_entities le ON le.id = l.entity_id
WHERE l.funding_account_id IS NULL
  AND l.status = 'active'

UNION ALL

SELECT
  'custom_outflow'::text,
  co.id,
  co.description,
  co.category                                            AS subtitle,
  le.name,
  co.amount,
  COALESCE(co.planned_pay_date, co.due_date),
  NULL::bigint,
  NULL::text
FROM public.custom_outflows co
LEFT JOIN public.loan_entities le ON le.id = co.entity_id
WHERE co.funding_account_id IS NULL
  AND co.status = 'planned'

UNION ALL

SELECT
  'invoice'::text,
  i.id,
  COALESCE('Invoice ' || i.invoice_number, '(no number)'),
  v.name                                                 AS subtitle,
  NULL::text,
  i.amount,
  COALESCE(i.planned_pay_date, i.due_date),
  NULL::bigint,
  i.invoice_number
FROM public.invoices i
LEFT JOIN public.vendors v ON v.id = i.vendor_id
WHERE i.funding_account_id IS NULL
  AND i.status IN ('Pending','Approved')
  AND i.deleted_at IS NULL

UNION ALL

SELECT
  'expected_inflow'::text,
  ei.id,
  COALESCE(ei.description, ei.source, 'Expected inflow'),
  ei.source                                              AS subtitle,
  le.name,
  ei.amount,
  ei.expected_date,
  NULL::bigint,
  NULL::text
FROM public.expected_inflows ei
LEFT JOIN public.loan_entities le ON le.id = ei.entity_id
WHERE ei.status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM public.expected_inflow_deposits d WHERE d.expected_inflow_id = ei.id
  );

GRANT SELECT ON public.v_unassigned_funding_items TO authenticated;
