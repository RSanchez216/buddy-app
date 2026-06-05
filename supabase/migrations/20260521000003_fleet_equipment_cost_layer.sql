-- Lease cost columns on trucks + trailers. Native cadence is monthly by
-- default; user can flip to weekly per unit and the view derives the
-- other cadence.

ALTER TABLE public.trucks
  ADD COLUMN IF NOT EXISTS lessor_vendor_id  uuid REFERENCES public.vendors(id),
  ADD COLUMN IF NOT EXISTS lease_cost        numeric(12,2),
  ADD COLUMN IF NOT EXISTS lease_cost_period text DEFAULT 'monthly'
       CHECK (lease_cost_period IN ('monthly','weekly'));

ALTER TABLE public.trailers
  ADD COLUMN IF NOT EXISTS lessor_vendor_id  uuid REFERENCES public.vendors(id),
  ADD COLUMN IF NOT EXISTS lease_cost        numeric(12,2),
  ADD COLUMN IF NOT EXISTS lease_cost_period text DEFAULT 'monthly'
       CHECK (lease_cost_period IN ('monthly','weekly'));

-- Unified per-unit cost view. Single source of truth — read by the
-- Fleet Cost screen, vendor pages, and any future cost analytics.
-- Conversion constant: weekly = monthly × 12 / 52 (and vice versa).
-- Cost source rules (per Rebeca):
--   company_owned + ACTIVE loan       -> loan_equipment.monthly_payment
--   company_owned + PAID_OFF loan     -> $0 (owned outright)
--   company_owned + no loan_equipment -> NULL (manual: classify or link)
--   company_leased                    -> lease_cost (native cadence)
--   driver_owned                      -> NULL
--   unclassified / other              -> NULL ('unknown')
CREATE OR REPLACE VIEW public.fleet_equipment_cost AS
WITH base AS (
  SELECT 'truck'::text etype, t.id, t.unit_number, t.vin, t.ownership_stage,
         t.loan_equipment_id, t.lessor_vendor_id, t.lease_cost, t.lease_cost_period
  FROM public.trucks t
  UNION ALL
  SELECT 'trailer', tr.id, tr.unit_number, tr.vin, tr.ownership_stage,
         tr.loan_equipment_id, tr.lessor_vendor_id, tr.lease_cost, tr.lease_cost_period
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
         THEN COALESCE(b.lease_cost_period,'monthly') ELSE 'monthly' END AS cost_period
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
            ELSE round(native_cost*12.0/52, 2) END AS weekly_cost
FROM calc;

NOTIFY pgrst, 'reload schema';
