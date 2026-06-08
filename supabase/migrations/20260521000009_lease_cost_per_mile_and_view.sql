-- Add a vendor-side per-mile lease charge on leased units. Dollar
-- impact (rate × miles) is deferred to Phase 3 once Loads supply
-- mileage; this migration captures the RATE only.
ALTER TABLE public.trucks
  ADD COLUMN IF NOT EXISTS lease_cost_per_mile numeric(10,4);
ALTER TABLE public.trailers
  ADD COLUMN IF NOT EXISTS lease_cost_per_mile numeric(10,4);

-- Re-create fleet_equipment_cost with the new per_mile_rate column.
-- CREATE OR REPLACE forbids reordering view columns, so per_mile_rate
-- is APPENDED at the end (column order is irrelevant for callers).
-- monthly_cost / weekly_cost continue to represent the FIXED portion
-- (lease_cost converted by 12/52); per_mile_rate is reported
-- separately because its dollar total needs mileage we don't have yet.
CREATE OR REPLACE VIEW public.fleet_equipment_cost AS
WITH base AS (
  SELECT 'truck'::text AS etype, t.id, t.unit_number, t.vin, t.ownership_stage,
         t.loan_equipment_id, t.lessor_vendor_id, t.lease_cost, t.lease_cost_period,
         t.lease_cost_per_mile
  FROM public.trucks t
  UNION ALL
  SELECT 'trailer', tr.id, tr.unit_number, tr.vin, tr.ownership_stage,
         tr.loan_equipment_id, tr.lessor_vendor_id, tr.lease_cost, tr.lease_cost_period,
         tr.lease_cost_per_mile
  FROM public.trailers tr
),
calc AS (
  SELECT b.*, l.status AS loan_status, le.monthly_payment, le.loan_id,
    CASE
      WHEN b.ownership_stage='company_owned'  AND l.status='active'   THEN 'loan'
      WHEN b.ownership_stage='company_owned'  AND l.status='paid_off' THEN 'owned_outright'
      WHEN b.ownership_stage='company_owned'                          THEN 'owned_no_loan'
      WHEN b.ownership_stage='company_leased'                         THEN 'lease'
      WHEN b.ownership_stage='driver_owned'                           THEN 'driver_owned'
      ELSE 'unknown'
    END AS cost_source,
    CASE
      WHEN b.ownership_stage='company_owned'  AND l.status='active'   THEN le.monthly_payment
      WHEN b.ownership_stage='company_owned'  AND l.status='paid_off' THEN 0
      WHEN b.ownership_stage='company_leased'                         THEN b.lease_cost
      ELSE NULL
    END AS native_cost,
    CASE WHEN b.ownership_stage='company_leased'
         THEN COALESCE(b.lease_cost_period,'monthly') ELSE 'monthly' END AS cost_period,
    CASE WHEN b.ownership_stage='company_leased'
         THEN b.lease_cost_per_mile ELSE NULL END AS per_mile_rate
  FROM base b
  LEFT JOIN public.loan_equipment le ON le.id = b.loan_equipment_id
  LEFT JOIN public.loans l ON l.id = le.loan_id
)
SELECT etype, id, unit_number, vin, ownership_stage, cost_source,
       loan_equipment_id, loan_id, lessor_vendor_id,
       native_cost, cost_period,
       CASE WHEN native_cost IS NULL THEN NULL
            WHEN cost_period='weekly' THEN round(native_cost*52.0/12, 2)
            ELSE native_cost END AS monthly_cost,
       CASE WHEN native_cost IS NULL THEN NULL
            WHEN cost_period='weekly' THEN native_cost
            ELSE round(native_cost*12.0/52, 2) END AS weekly_cost,
       per_mile_rate
FROM calc;

NOTIFY pgrst, 'reload schema';
