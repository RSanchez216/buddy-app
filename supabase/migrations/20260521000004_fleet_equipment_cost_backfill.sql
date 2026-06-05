-- One-shot data backfill that ran alongside the cost-layer migration.
-- Idempotent — the WHERE … IS NULL guards mean re-running is a no-op.
--
-- 1. VIN backfill: link trucks/trailers to loan_equipment by normalized
--    VIN (strip non-alphanumeric, upper). Prefer ACTIVE loans when a VIN
--    appears on multiple loan_equipment rows.
-- 2. Flip newly-linked unclassified units to company_owned + audit row
--    in equipment_ownership_history.
-- 3. Create 5 canonical lessor vendors (NATO Leasing, Cadence Truck &
--    Trailer Leasing LLC, AIM Rentals, UA Team Inc, AAA Lease LLC) and
--    map equipment_owner_raw -> lessor_vendor_id. NATO Rentals folds into
--    the NATO Leasing vendor via the inline alias map.

-- ── Step 1 — VIN backfill ─────────────────────────────────────────────
WITH ranked AS (
  SELECT le.id AS le_id,
         upper(regexp_replace(le.vin,'[^A-Za-z0-9]','','g')) AS vinn,
         row_number() OVER (
           PARTITION BY upper(regexp_replace(le.vin,'[^A-Za-z0-9]','','g'))
           ORDER BY (l.status='active') DESC, le.created_at DESC
         ) AS rk
  FROM public.loan_equipment le
  JOIN public.loans l ON l.id = le.loan_id
)
UPDATE public.trucks t SET loan_equipment_id = r.le_id, updated_at = now()
FROM ranked r
WHERE r.rk = 1
  AND upper(regexp_replace(t.vin,'[^A-Za-z0-9]','','g')) = r.vinn
  AND t.loan_equipment_id IS NULL;

WITH ranked AS (
  SELECT le.id AS le_id,
         upper(regexp_replace(le.vin,'[^A-Za-z0-9]','','g')) AS vinn,
         row_number() OVER (
           PARTITION BY upper(regexp_replace(le.vin,'[^A-Za-z0-9]','','g'))
           ORDER BY (l.status='active') DESC, le.created_at DESC
         ) AS rk
  FROM public.loan_equipment le
  JOIN public.loans l ON l.id = le.loan_id
)
UPDATE public.trailers t SET loan_equipment_id = r.le_id, updated_at = now()
FROM ranked r
WHERE r.rk = 1
  AND upper(regexp_replace(t.vin,'[^A-Za-z0-9]','','g')) = r.vinn
  AND t.loan_equipment_id IS NULL;

-- ── Step 2 — Newly-linked unclassified -> company_owned ───────────────
WITH flipped_trucks AS (
  SELECT id FROM public.trucks
  WHERE ownership_stage='unclassified' AND loan_equipment_id IS NOT NULL
)
INSERT INTO public.equipment_ownership_history (equipment_type, truck_id, from_stage, to_stage, reason, occurred_at, created_by)
SELECT 'truck', id, 'unclassified', 'company_owned',
       'Linked to debt-schedule loan via VIN (cost-layer backfill)', now(),
       'ec24022d-2954-4742-b632-f73f2d94a7a8'
FROM flipped_trucks;

UPDATE public.trucks
SET ownership_stage='company_owned',
    ownership_stage_started_at=now(),
    updated_at=now()
WHERE ownership_stage='unclassified' AND loan_equipment_id IS NOT NULL;

WITH flipped_trailers AS (
  SELECT id FROM public.trailers
  WHERE ownership_stage='unclassified' AND loan_equipment_id IS NOT NULL
)
INSERT INTO public.equipment_ownership_history (equipment_type, trailer_id, from_stage, to_stage, reason, occurred_at, created_by)
SELECT 'trailer', id, 'unclassified', 'company_owned',
       'Linked to debt-schedule loan via VIN (cost-layer backfill)', now(),
       'ec24022d-2954-4742-b632-f73f2d94a7a8'
FROM flipped_trailers;

UPDATE public.trailers
SET ownership_stage='company_owned',
    ownership_stage_started_at=now(),
    updated_at=now()
WHERE ownership_stage='unclassified' AND loan_equipment_id IS NOT NULL;

-- ── Step 3 — Lessor vendors + alias mapping ───────────────────────────
INSERT INTO public.vendors (name, category)
SELECT v.name, 'Equipment Rental'
FROM (VALUES
  ('NATO Leasing'),
  ('Cadence Truck & Trailer Leasing LLC'),
  ('AIM Rentals'),
  ('UA Team Inc'),
  ('AAA Lease LLC')
) v(name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.vendors x
  WHERE lower(regexp_replace(x.name,'[^a-z0-9]','','g'))
      = lower(regexp_replace(v.name, '[^a-z0-9]','','g'))
);

WITH alias_map AS (
  SELECT 'NATO Leasing'::text raw_name, 'NATO Leasing'::text vendor_name UNION ALL
  SELECT 'NATO Rentals',                'NATO Leasing'                  UNION ALL
  SELECT 'Cadence Truck & Trailer Leasing LLC', 'Cadence Truck & Trailer Leasing LLC' UNION ALL
  SELECT 'AIM Rentals',                 'AIM Rentals'                   UNION ALL
  SELECT 'UA Team Inc',                 'UA Team Inc'                   UNION ALL
  SELECT 'AAA Lease LLC',               'AAA Lease LLC'
),
resolved AS (
  SELECT a.raw_name, v.id AS vendor_id
  FROM alias_map a
  JOIN public.vendors v ON v.name = a.vendor_name
)
UPDATE public.trucks t
SET lessor_vendor_id = r.vendor_id, updated_at = now()
FROM resolved r
WHERE t.ownership_stage = 'company_leased'
  AND t.lessor_vendor_id IS NULL
  AND t.equipment_owner_raw = r.raw_name;

WITH alias_map AS (
  SELECT 'NATO Leasing'::text raw_name, 'NATO Leasing'::text vendor_name UNION ALL
  SELECT 'NATO Rentals',                'NATO Leasing'                  UNION ALL
  SELECT 'Cadence Truck & Trailer Leasing LLC', 'Cadence Truck & Trailer Leasing LLC' UNION ALL
  SELECT 'AIM Rentals',                 'AIM Rentals'                   UNION ALL
  SELECT 'UA Team Inc',                 'UA Team Inc'                   UNION ALL
  SELECT 'AAA Lease LLC',               'AAA Lease LLC'
),
resolved AS (
  SELECT a.raw_name, v.id AS vendor_id
  FROM alias_map a
  JOIN public.vendors v ON v.name = a.vendor_name
)
UPDATE public.trailers t
SET lessor_vendor_id = r.vendor_id, updated_at = now()
FROM resolved r
WHERE t.ownership_stage = 'company_leased'
  AND t.lessor_vendor_id IS NULL
  AND t.equipment_owner_raw = r.raw_name;
