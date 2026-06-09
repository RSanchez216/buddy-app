-- Total-loss cost tracking. Two INDEPENDENT boolean flags on each
-- equipment table:
--   is_total_loss        — unit written off in an accident / total loss.
--   lease_charge_active   — are we still being charged a lease /
--                            lease-purchase amount (default TRUE).
--
-- These are separate dimensions: a totaled unit may still incur a lease
-- charge while the insurance/settlement process plays out, OR it may be
-- paid off / the lessor stopped billing. Tracking them apart keeps KPI
-- totals correct in every combination. Rebeca sets both fields by hand;
-- there are NO auto-guards/triggers tying these to operational_status.

ALTER TABLE public.trucks
  ADD COLUMN IF NOT EXISTS is_total_loss boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lease_charge_active boolean NOT NULL DEFAULT true;

ALTER TABLE public.trailers
  ADD COLUMN IF NOT EXISTS is_total_loss boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lease_charge_active boolean NOT NULL DEFAULT true;

-- Re-create fleet_equipment_cost (DROP+CREATE: output column list grows
-- by is_total_loss + lease_charge_active). The only logic change is the
-- leased-cost path: native_cost now returns NULL when
-- lease_charge_active = false, even if a vendor rate card or a
-- lease_rate_override exists. NULL = "no cost obligation," consistent
-- with the existing NULL-means-uncosted handling downstream. per_mile is
-- likewise suppressed when not being charged, for clean display.
DROP VIEW IF EXISTS public.fleet_equipment_cost;

CREATE VIEW public.fleet_equipment_cost AS
WITH base AS (
  SELECT 'truck'::text AS etype, t.id, t.unit_number, t.vin, t.ownership_stage,
         t.loan_equipment_id, t.lessor_vendor_id, t.lease_cost, t.lease_cost_period,
         t.lease_cost_per_mile, t.operational_status, t.owned_outright, t.lease_rate_override,
         t.is_total_loss, t.lease_charge_active
  FROM public.trucks t
  UNION ALL
  SELECT 'trailer'::text, tr.id, tr.unit_number, tr.vin, tr.ownership_stage,
         tr.loan_equipment_id, tr.lessor_vendor_id, tr.lease_cost, tr.lease_cost_period,
         tr.lease_cost_per_mile, tr.operational_status, tr.owned_outright, tr.lease_rate_override,
         tr.is_total_loss, tr.lease_charge_active
  FROM public.trailers tr
), fees AS (
  SELECT vendor_lease_fees.vendor_id,
         COALESCE(sum(vendor_lease_fees.amount), 0::numeric) AS fees_total
  FROM public.vendor_lease_fees
  GROUP BY vendor_lease_fees.vendor_id
), calc AS (
  SELECT b.etype, b.id, b.unit_number, b.vin, b.ownership_stage, b.loan_equipment_id,
         b.lessor_vendor_id, b.lease_cost, b.lease_cost_period, b.lease_cost_per_mile,
         b.operational_status, b.owned_outright, b.lease_rate_override,
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
         -- native_cost: leased path now gated on lease_charge_active
         CASE
           WHEN b.ownership_stage = 'company_owned'::text AND l.status = 'active'::text THEN le.monthly_payment
           WHEN b.ownership_stage = 'company_owned'::text AND b.owned_outright THEN 0::numeric
           WHEN b.ownership_stage = 'company_owned'::text AND l.status = 'paid_off'::text THEN 0::numeric
           WHEN b.ownership_stage = 'company_leased'::text AND b.lease_charge_active AND b.lease_rate_override
             THEN b.lease_cost
           WHEN b.ownership_stage = 'company_leased'::text AND b.lease_charge_active AND vlr.vendor_id IS NOT NULL
             THEN COALESCE(vlr.fixed_charge, 0::numeric) + COALESCE(f.fees_total, 0::numeric)
           ELSE NULL::numeric
         END AS native_cost,
         CASE
           WHEN b.ownership_stage = 'company_leased'::text AND b.lease_rate_override
             THEN COALESCE(b.lease_cost_period, 'monthly'::text)
           WHEN b.ownership_stage = 'company_leased'::text AND vlr.vendor_id IS NOT NULL
             THEN COALESCE(vlr.period, 'monthly'::text)
           ELSE 'monthly'::text
         END AS cost_period,
         -- per_mile suppressed when not being charged, for clean display
         CASE
           WHEN b.ownership_stage = 'company_leased'::text AND NOT b.lease_charge_active THEN NULL::numeric
           WHEN b.ownership_stage = 'company_leased'::text AND b.lease_rate_override THEN b.lease_cost_per_mile
           WHEN b.ownership_stage = 'company_leased'::text AND vlr.vendor_id IS NOT NULL THEN vlr.per_mile_rate
           ELSE NULL::numeric
         END AS per_mile_rate,
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
       per_mile_rate, operational_status, has_current_driver,
       is_total_loss, lease_charge_active
FROM calc;

-- Re-grant (DROP dropped the grants). Matches prior state: GRANT ALL to the 3 roles.
GRANT ALL ON public.fleet_equipment_cost TO anon, authenticated, service_role;

-- PostgREST schema reload
NOTIFY pgrst, 'reload schema';
