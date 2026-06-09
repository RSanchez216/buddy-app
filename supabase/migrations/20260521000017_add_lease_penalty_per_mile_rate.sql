-- Lease penalty (overage) per-mile rate. Vanguard monthly invoices carry
-- a DISTANCE PENALTY line (e.g. $0.25000/mi) that bills miles driven ABOVE
-- a free mileage allowance for the period — a third distance component
-- alongside fixed_charge and the base per_mile_rate.
--
-- Same philosophy as base per-mile: STORE THE RATE, defer the dollar
-- impact until mileage + the free allowance arrive via invoice/Loads
-- ingest. The free-allowance threshold is intentionally NOT modeled yet
-- (not present on a zero-overage invoice; may be per-unit vs pooled) —
-- capture it later with real over-cap data.
--
-- Stored on the vendor card (inherited) AND as a per-unit override on
-- trucks/trailers, mirroring base per-mile.

ALTER TABLE public.vendor_lease_rates
  ADD COLUMN IF NOT EXISTS penalty_per_mile_rate numeric;

ALTER TABLE public.trucks
  ADD COLUMN IF NOT EXISTS lease_penalty_per_mile numeric;

ALTER TABLE public.trailers
  ADD COLUMN IF NOT EXISTS lease_penalty_per_mile numeric;

-- Recreate fleet_equipment_cost (DROP+CREATE: output gains
-- penalty_per_mile_rate). Penalty is derived with the SAME precedence and
-- charge-gating as per_mile_rate: override → vendor card → NULL, and NULL
-- whenever lease_charge_active = false. No cost computation — reference
-- rate only.
DROP VIEW IF EXISTS public.fleet_equipment_cost;

CREATE VIEW public.fleet_equipment_cost AS
WITH base AS (
  SELECT 'truck'::text AS etype, t.id, t.unit_number, t.vin, t.ownership_stage,
         t.loan_equipment_id, t.lessor_vendor_id, t.lease_cost, t.lease_cost_period,
         t.lease_cost_per_mile, t.lease_penalty_per_mile, t.operational_status,
         t.owned_outright, t.lease_rate_override, t.is_total_loss, t.lease_charge_active
  FROM public.trucks t
  UNION ALL
  SELECT 'trailer'::text, tr.id, tr.unit_number, tr.vin, tr.ownership_stage,
         tr.loan_equipment_id, tr.lessor_vendor_id, tr.lease_cost, tr.lease_cost_period,
         tr.lease_cost_per_mile, tr.lease_penalty_per_mile, tr.operational_status,
         tr.owned_outright, tr.lease_rate_override, tr.is_total_loss, tr.lease_charge_active
  FROM public.trailers tr
), fees AS (
  SELECT vendor_lease_fees.vendor_id,
         COALESCE(sum(vendor_lease_fees.amount), 0::numeric) AS fees_total
  FROM public.vendor_lease_fees
  GROUP BY vendor_lease_fees.vendor_id
), calc AS (
  SELECT b.etype, b.id, b.unit_number, b.vin, b.ownership_stage, b.loan_equipment_id,
         b.lessor_vendor_id, b.lease_cost, b.lease_cost_period, b.lease_cost_per_mile,
         b.lease_penalty_per_mile, b.operational_status, b.owned_outright, b.lease_rate_override,
         b.is_total_loss, b.lease_charge_active,
         l.status AS loan_status, le.monthly_payment, le.loan_id,
         vlr.fixed_charge AS vendor_fixed, vlr.period AS vendor_period,
         vlr.per_mile_rate AS vendor_per_mile,
         COALESCE(f.fees_total, 0::numeric) AS vendor_fees_total,
         CASE
           WHEN b.ownership_stage = 'company_owned'::text AND l.status = 'active'::text THEN 'loan'::text
           WHEN b.ownership_stage = 'company_owned'::text AND b.owned_outright THEN 'owned_outright'::text
           WHEN b.ownership_stage = 'company_owned'::text AND l.status = 'paid_off'::text THEN 'owned_outright'::text
           WHEN b.ownership_stage = 'company_owned'::text THEN 'owned_no_loan'::text
           WHEN b.ownership_stage = 'company_leased'::text THEN 'lease'::text
           WHEN b.ownership_stage = 'driver_owned'::text THEN 'driver_owned'::text
           ELSE 'unknown'::text
         END AS cost_source,
         CASE
           WHEN b.ownership_stage = 'company_owned'::text AND l.status = 'active'::text THEN le.monthly_payment
           WHEN b.ownership_stage = 'company_owned'::text AND b.owned_outright THEN 0::numeric
           WHEN b.ownership_stage = 'company_owned'::text AND l.status = 'paid_off'::text THEN 0::numeric
           WHEN b.ownership_stage = 'company_leased'::text AND b.lease_charge_active AND b.lease_rate_override THEN b.lease_cost
           WHEN b.ownership_stage = 'company_leased'::text AND b.lease_charge_active AND vlr.vendor_id IS NOT NULL THEN COALESCE(vlr.fixed_charge, 0::numeric) + COALESCE(f.fees_total, 0::numeric)
           ELSE NULL::numeric
         END AS native_cost,
         CASE
           WHEN b.ownership_stage = 'company_leased'::text AND b.lease_rate_override THEN COALESCE(b.lease_cost_period, 'monthly'::text)
           WHEN b.ownership_stage = 'company_leased'::text AND vlr.vendor_id IS NOT NULL THEN COALESCE(vlr.period, 'monthly'::text)
           ELSE 'monthly'::text
         END AS cost_period,
         CASE
           WHEN b.ownership_stage = 'company_leased'::text AND NOT b.lease_charge_active THEN NULL::numeric
           WHEN b.ownership_stage = 'company_leased'::text AND b.lease_rate_override THEN b.lease_cost_per_mile
           WHEN b.ownership_stage = 'company_leased'::text AND vlr.vendor_id IS NOT NULL THEN vlr.per_mile_rate
           ELSE NULL::numeric
         END AS per_mile_rate,
         -- NEW: penalty/overage per-mile, same precedence + charge-gating as per_mile_rate
         CASE
           WHEN b.ownership_stage = 'company_leased'::text AND NOT b.lease_charge_active THEN NULL::numeric
           WHEN b.ownership_stage = 'company_leased'::text AND b.lease_rate_override THEN b.lease_penalty_per_mile
           WHEN b.ownership_stage = 'company_leased'::text AND vlr.vendor_id IS NOT NULL THEN vlr.penalty_per_mile_rate
           ELSE NULL::numeric
         END AS penalty_per_mile_rate,
         (EXISTS ( SELECT 1
                   FROM public.equipment_assignments a
                   WHERE a.end_date IS NULL
                     AND (b.etype = 'truck'::text AND a.truck_id = b.id
                          OR b.etype = 'trailer'::text AND a.trailer_id = b.id))) AS has_current_driver
  FROM base b
    LEFT JOIN public.loan_equipment le ON le.id = b.loan_equipment_id
    LEFT JOIN public.loans l ON l.id = le.loan_id
    LEFT JOIN public.vendor_lease_rates vlr ON vlr.vendor_id = b.lessor_vendor_id
    LEFT JOIN fees f ON f.vendor_id = b.lessor_vendor_id
)
SELECT etype, id, unit_number, vin, ownership_stage, cost_source, loan_equipment_id, loan_id,
       lessor_vendor_id, native_cost, cost_period,
       CASE WHEN native_cost IS NULL THEN NULL::numeric
            WHEN cost_period = 'weekly'::text THEN round(native_cost * 52.0 / 12::numeric, 2)
            ELSE native_cost END AS monthly_cost,
       CASE WHEN native_cost IS NULL THEN NULL::numeric
            WHEN cost_period = 'weekly'::text THEN native_cost
            ELSE round(native_cost * 12.0 / 52::numeric, 2) END AS weekly_cost,
       per_mile_rate, penalty_per_mile_rate, operational_status, has_current_driver,
       is_total_loss, lease_charge_active
FROM calc;

GRANT ALL ON public.fleet_equipment_cost TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
