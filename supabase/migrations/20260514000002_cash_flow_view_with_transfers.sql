-- Extend v_cash_flow_events with two transfer branches: outgoing leg on the
-- source's debit_date, incoming leg on the destination's credit_date. Both
-- legs reference the same transfer.id via reference_id, so clicking either
-- leg opens the same edit modal. event_id is prefixed by leg direction so
-- the two rows don't collide as React keys.
--
-- status carries 'in_transit' when credit_date > debit_date (so the UI can
-- mark the gap) or 'settled' when they match. Label embeds the counterpart
-- date when in transit so the chip can hint at when the money lands.

DROP VIEW IF EXISTS public.v_cash_flow_events;

CREATE VIEW public.v_cash_flow_events AS
  SELECT lp.id::text AS event_id,
    COALESCE(lp.paid_date, lp.planned_pay_date, lp.due_date) AS event_date,
    lp.due_date AS original_due_date,
    l.entity_id,
    e.name AS entity_name,
    'outflow'::text AS direction,
    'loan'::text AS category,
    lp.scheduled_amount AS amount,
    concat(ld.name, ' — ', l.loan_id_external) AS label,
    l.id::text AS reference_id,
    'loan'::text AS reference_type,
    lp.status,
    false AS is_draggable,
    true AS due_date_locked,
    l.funding_account_id,
    fa.name AS funding_account_name
   FROM loan_payments lp
     JOIN loans l ON lp.loan_id = l.id
     LEFT JOIN loan_entities e ON l.entity_id = e.id
     LEFT JOIN loan_lenders ld ON l.lender_id = ld.id
     LEFT JOIN funding_accounts fa ON l.funding_account_id = fa.id
  WHERE lp.status = ANY (ARRAY['pending'::text, 'partial'::text, 'paid'::text])
UNION ALL
 SELECT i.id::text AS event_id,
    COALESCE(i.planned_pay_date, i.due_date) AS event_date,
    i.due_date AS original_due_date,
    NULL::uuid AS entity_id,
    NULL::text AS entity_name,
    'outflow'::text AS direction,
    'ap_bill'::text AS category,
    i.amount,
    concat(COALESCE(v.name, 'Vendor'::text), ' — ', COALESCE(i.invoice_number, 'no #'::text)) AS label,
    i.id::text AS reference_id,
    'invoice'::text AS reference_type,
    i.status,
    true AS is_draggable,
    false AS due_date_locked,
    i.funding_account_id,
    fa.name AS funding_account_name
   FROM invoices i
     LEFT JOIN vendors v ON i.vendor_id = v.id
     LEFT JOIN funding_accounts fa ON i.funding_account_id = fa.id
  WHERE (lower(i.status) = ANY (ARRAY['pending'::text, 'scheduled'::text, 'approved'::text, 'paid'::text]))
    AND i.due_date IS NOT NULL AND i.deleted_at IS NULL
UNION ALL
 SELECT co.id::text AS event_id,
    COALESCE(co.paid_date, co.planned_pay_date, co.due_date) AS event_date,
    co.due_date AS original_due_date,
    co.entity_id,
    e.name AS entity_name,
    'outflow'::text AS direction,
        CASE
            WHEN co.recurring_template_id IS NOT NULL THEN 'recurring'::text
            ELSE 'custom'::text
        END AS category,
    co.amount,
    co.description AS label,
    co.id::text AS reference_id,
        CASE
            WHEN co.recurring_template_id IS NOT NULL THEN 'recurring'::text
            ELSE 'custom'::text
        END AS reference_type,
    co.status,
    true AS is_draggable,
    false AS due_date_locked,
    co.funding_account_id,
    fa.name AS funding_account_name
   FROM custom_outflows co
     LEFT JOIN loan_entities e ON co.entity_id = e.id
     LEFT JOIN funding_accounts fa ON co.funding_account_id = fa.id
  WHERE (co.status = ANY (ARRAY['planned'::text, 'paid'::text])) AND co.cash_impacting = true
UNION ALL
 SELECT d.id::text AS event_id,
    COALESCE(ei.received_date, ei.expected_date) AS event_date,
    ei.expected_date AS original_due_date,
    ei.entity_id,
    e.name AS entity_name,
    'inflow'::text AS direction,
        CASE
            WHEN ei.source_type = 'factor'::text THEN 'factor_advance'::text
            ELSE 'expected_income'::text
        END AS category,
    d.amount,
        CASE
            WHEN ei.source_type = 'factor'::text THEN concat(f.name, ' → ', COALESCE(fa.name, 'Unassigned'::text))
            ELSE COALESCE(ei.source, 'Income'::text)
        END AS label,
    ei.id::text AS reference_id,
    'inflow'::text AS reference_type,
    ei.status,
    true AS is_draggable,
    false AS due_date_locked,
    d.funding_account_id,
    fa.name AS funding_account_name
   FROM expected_inflow_deposits d
     JOIN expected_inflows ei ON d.expected_inflow_id = ei.id
     LEFT JOIN loan_entities e ON ei.entity_id = e.id
     LEFT JOIN factors f ON ei.factor_id = f.id
     LEFT JOIN funding_accounts fa ON d.funding_account_id = fa.id
  WHERE ei.status = ANY (ARRAY['pending'::text, 'received'::text])
UNION ALL
 SELECT a.id::text AS event_id,
    a.adjustment_date AS event_date,
    a.adjustment_date AS original_due_date,
    NULL::uuid AS entity_id,
    NULL::text AS entity_name,
    CASE WHEN a.amount >= 0 THEN 'inflow'::text ELSE 'outflow'::text END AS direction,
    'adjustment'::text AS category,
    ABS(a.amount) AS amount,
    CASE
      WHEN a.classification IS NULL THEN 'Reconciliation Adjustment'::text
      ELSE 'Reconciliation: ' || a.classification
    END AS label,
    a.id::text AS reference_id,
    'adjustment'::text AS reference_type,
    CASE WHEN a.classification IS NULL THEN 'needs_review'::text ELSE 'classified'::text END AS status,
    false AS is_draggable,
    true AS due_date_locked,
    a.funding_account_id,
    fa.name AS funding_account_name
   FROM funding_account_adjustments a
     LEFT JOIN funding_accounts fa ON a.funding_account_id = fa.id
UNION ALL
 -- Transfer OUT leg — sits on source's debit_date
 SELECT 'transfer-out-' || t.id::text AS event_id,
    t.debit_date AS event_date,
    t.credit_date AS original_due_date,
    NULL::uuid AS entity_id,
    NULL::text AS entity_name,
    'outflow'::text AS direction,
    'transfer'::text AS category,
    t.amount,
    CASE
      WHEN t.credit_date > t.debit_date
        THEN '→ Transfer to ' || COALESCE(fa_to.name, '—') || ' · settles ' || to_char(t.credit_date, 'Mon DD')
      ELSE '→ Transfer to ' || COALESCE(fa_to.name, '—')
    END AS label,
    t.id::text AS reference_id,
    'transfer_out'::text AS reference_type,
    CASE WHEN t.credit_date > t.debit_date THEN 'in_transit'::text ELSE 'settled'::text END AS status,
    false AS is_draggable,
    true AS due_date_locked,
    t.from_funding_account_id AS funding_account_id,
    fa_from.name AS funding_account_name
   FROM funding_account_transfers t
     JOIN funding_accounts fa_from ON fa_from.id = t.from_funding_account_id
     LEFT JOIN funding_accounts fa_to ON fa_to.id = t.to_funding_account_id
UNION ALL
 -- Transfer IN leg — sits on destination's credit_date
 SELECT 'transfer-in-' || t.id::text AS event_id,
    t.credit_date AS event_date,
    t.debit_date AS original_due_date,
    NULL::uuid AS entity_id,
    NULL::text AS entity_name,
    'inflow'::text AS direction,
    'transfer'::text AS category,
    t.amount,
    CASE
      WHEN t.credit_date > t.debit_date
        THEN '← Transfer from ' || COALESCE(fa_from.name, '—') || ' · debited ' || to_char(t.debit_date, 'Mon DD')
      ELSE '← Transfer from ' || COALESCE(fa_from.name, '—')
    END AS label,
    t.id::text AS reference_id,
    'transfer_in'::text AS reference_type,
    CASE WHEN t.credit_date > t.debit_date THEN 'in_transit'::text ELSE 'settled'::text END AS status,
    false AS is_draggable,
    true AS due_date_locked,
    t.to_funding_account_id AS funding_account_id,
    fa_to.name AS funding_account_name
   FROM funding_account_transfers t
     LEFT JOIN funding_accounts fa_from ON fa_from.id = t.from_funding_account_id
     JOIN funding_accounts fa_to ON fa_to.id = t.to_funding_account_id;
