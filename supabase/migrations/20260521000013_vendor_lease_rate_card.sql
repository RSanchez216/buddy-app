-- Per-vendor lease rate card. One row per vendor; fixed_charge and
-- per_mile_rate plus a period (weekly|monthly) that the fixed charge
-- and fees are quoted in. Units inherit by default; the per-unit
-- lease_rate_override flag flips them to their own lease_cost /
-- lease_cost_period / lease_cost_per_mile.
CREATE TABLE IF NOT EXISTS public.vendor_lease_rates (
  vendor_id     uuid PRIMARY KEY REFERENCES public.vendors(id) ON DELETE CASCADE,
  fixed_charge  numeric(12,2),
  period        text NOT NULL DEFAULT 'weekly' CHECK (period IN ('weekly','monthly')),
  per_mile_rate numeric(10,4),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Named fees per vendor (Environmental compliance, ELD, …). Each fee
-- is quoted in the same period as the rate card (vendor_lease_rates.period).
CREATE TABLE IF NOT EXISTS public.vendor_lease_fees (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id  uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  label      text NOT NULL,
  amount     numeric(12,2) NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_lease_fees_vendor ON public.vendor_lease_fees(vendor_id);

-- Per-unit override flag: when true, the unit uses its own
-- lease_cost / period / per_mile (today's per-unit columns) instead
-- of inheriting the vendor card. Default false so existing units
-- inherit automatically.
ALTER TABLE public.trucks   ADD COLUMN IF NOT EXISTS lease_rate_override boolean NOT NULL DEFAULT false;
ALTER TABLE public.trailers ADD COLUMN IF NOT EXISTS lease_rate_override boolean NOT NULL DEFAULT false;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_lease_rates, public.vendor_lease_fees TO authenticated;
ALTER TABLE public.vendor_lease_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_lease_fees  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vlr_all ON public.vendor_lease_rates;
DROP POLICY IF EXISTS vlf_all ON public.vendor_lease_fees;
CREATE POLICY vlr_all ON public.vendor_lease_rates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY vlf_all ON public.vendor_lease_fees  FOR ALL USING (true) WITH CHECK (true);

-- Re-create fleet_equipment_cost so leased units compute effective
-- cost via vendor rate card inheritance, with per-unit override.
-- CREATE OR REPLACE keeps the same column set (order preserved) so
-- callers don't break. Lease branch changes:
--   override=true  -> native = lease_cost, period = lease_cost_period,
--                      per_mile = lease_cost_per_mile
--   override=false -> native = fixed_charge + COALESCE(sum(fees),0),
--                      period = vendor.period, per_mile = vendor.per_mile_rate
-- A leased unit is "needs cost" only when neither an override value
-- nor a vendor rate card exists. Owned/loan branches unchanged.
CREATE OR REPLACE VIEW public.fleet_equipment_cost AS
WITH base AS (
  SELECT 'truck'::text AS etype, t.id, t.unit_number, t.vin, t.ownership_stage,
         t.loan_equipment_id, t.lessor_vendor_id, t.lease_cost, t.lease_cost_period,
         t.lease_cost_per_mile, t.operational_status, t.owned_outright, t.lease_rate_override
  FROM public.trucks t
  UNION ALL
  SELECT 'trailer', tr.id, tr.unit_number, tr.vin, tr.ownership_stage,
         tr.loan_equipment_id, tr.lessor_vendor_id, tr.lease_cost, tr.lease_cost_period,
         tr.lease_cost_per_mile, tr.operational_status, tr.owned_outright, tr.lease_rate_override
  FROM public.trailers tr
),
fees AS (
  SELECT vendor_id, COALESCE(sum(amount), 0) AS fees_total
    FROM public.vendor_lease_fees
   GROUP BY vendor_id
),
calc AS (
  SELECT b.*, l.status AS loan_status, le.monthly_payment, le.loan_id,
    vlr.fixed_charge   AS vendor_fixed,
    vlr.period         AS vendor_period,
    vlr.per_mile_rate  AS vendor_per_mile,
    COALESCE(f.fees_total, 0) AS vendor_fees_total,
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
      WHEN b.ownership_stage='company_leased' AND b.lease_rate_override THEN b.lease_cost
      WHEN b.ownership_stage='company_leased' AND vlr.vendor_id IS NOT NULL THEN
        COALESCE(vlr.fixed_charge, 0) + COALESCE(f.fees_total, 0)
      ELSE NULL
    END AS native_cost,
    CASE
      WHEN b.ownership_stage='company_leased' AND b.lease_rate_override
        THEN COALESCE(b.lease_cost_period, 'monthly')
      WHEN b.ownership_stage='company_leased' AND vlr.vendor_id IS NOT NULL
        THEN COALESCE(vlr.period, 'monthly')
      ELSE 'monthly'
    END AS cost_period,
    CASE
      WHEN b.ownership_stage='company_leased' AND b.lease_rate_override THEN b.lease_cost_per_mile
      WHEN b.ownership_stage='company_leased' AND vlr.vendor_id IS NOT NULL THEN vlr.per_mile_rate
      ELSE NULL
    END AS per_mile_rate,
    EXISTS (
      SELECT 1 FROM public.equipment_assignments a
      WHERE a.end_date IS NULL
        AND ((b.etype = 'truck'   AND a.truck_id   = b.id)
          OR (b.etype = 'trailer' AND a.trailer_id = b.id))
    ) AS has_current_driver
  FROM base b
  LEFT JOIN public.loan_equipment le ON le.id = b.loan_equipment_id
  LEFT JOIN public.loans l ON l.id = le.loan_id
  LEFT JOIN public.vendor_lease_rates vlr ON vlr.vendor_id = b.lessor_vendor_id
  LEFT JOIN fees f ON f.vendor_id = b.lessor_vendor_id
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
