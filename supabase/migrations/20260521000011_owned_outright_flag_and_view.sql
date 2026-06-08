-- Per-unit "Owned outright ($0)" flag. Lets a company-owned unit
-- declare paid-off / cash-owned status WITHOUT requiring a paid-off
-- loan row in the Debt Schedule.

ALTER TABLE public.trucks
  ADD COLUMN IF NOT EXISTS owned_outright boolean NOT NULL DEFAULT false;
ALTER TABLE public.trailers
  ADD COLUMN IF NOT EXISTS owned_outright boolean NOT NULL DEFAULT false;

-- Re-create fleet_equipment_cost with the new cost_source precedence:
--   company_owned + ACTIVE linked loan -> 'loan'           (real cost)
--   company_owned + owned_outright=t   -> 'owned_outright' ($0)
--   company_owned + PAID_OFF loan      -> 'owned_outright' ($0)  (existing)
--   company_owned (no loan, no flag)   -> 'owned_no_loan'  (needs cost)
--   ... lease / driver_owned / unknown unchanged ...
--
-- So an actual active loan always wins over the flag — if a unit is
-- marked outright and someone later links its active loan in Debt
-- Schedule, the live monthly payment takes precedence.
--
-- CREATE OR REPLACE forbids reordering existing view columns, so the
-- pre-existing column order is preserved.

CREATE OR REPLACE VIEW public.fleet_equipment_cost AS
WITH base AS (
  SELECT 'truck'::text AS etype, t.id, t.unit_number, t.vin, t.ownership_stage,
         t.loan_equipment_id, t.lessor_vendor_id, t.lease_cost, t.lease_cost_period,
         t.lease_cost_per_mile, t.operational_status, t.owned_outright
  FROM public.trucks t
  UNION ALL
  SELECT 'trailer', tr.id, tr.unit_number, tr.vin, tr.ownership_stage,
         tr.loan_equipment_id, tr.lessor_vendor_id, tr.lease_cost, tr.lease_cost_period,
         tr.lease_cost_per_mile, tr.operational_status, tr.owned_outright
  FROM public.trailers tr
),
calc AS (
  SELECT b.*, l.status AS loan_status, le.monthly_payment, le.loan_id,
    CASE
      WHEN b.ownership_stage='company_owned'  AND l.status='active'   THEN 'loan'
      WHEN b.ownership_stage='company_owned'  AND b.owned_outright    THEN 'owned_outright'
      WHEN b.ownership_stage='company_owned'  AND l.status='paid_off' THEN 'owned_outright'
      WHEN b.ownership_stage='company_owned'                          THEN 'owned_no_loan'
      WHEN b.ownership_stage='company_leased'                         THEN 'lease'
      WHEN b.ownership_stage='driver_owned'                           THEN 'driver_owned'
      ELSE 'unknown'
    END AS cost_source,
    CASE
      WHEN b.ownership_stage='company_owned'  AND l.status='active'   THEN le.monthly_payment
      WHEN b.ownership_stage='company_owned'  AND b.owned_outright    THEN 0
      WHEN b.ownership_stage='company_owned'  AND l.status='paid_off' THEN 0
      WHEN b.ownership_stage='company_leased'                         THEN b.lease_cost
      ELSE NULL
    END AS native_cost,
    CASE WHEN b.ownership_stage='company_leased'
         THEN COALESCE(b.lease_cost_period,'monthly') ELSE 'monthly' END AS cost_period,
    CASE WHEN b.ownership_stage='company_leased'
         THEN b.lease_cost_per_mile ELSE NULL END AS per_mile_rate,
    EXISTS (
      SELECT 1 FROM public.equipment_assignments a
      WHERE a.end_date IS NULL
        AND ((b.etype = 'truck'   AND a.truck_id   = b.id)
          OR (b.etype = 'trailer' AND a.trailer_id = b.id))
    ) AS has_current_driver
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
       per_mile_rate,
       operational_status,
       has_current_driver
FROM calc;

NOTIFY pgrst, 'reload schema';
