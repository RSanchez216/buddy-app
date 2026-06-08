-- One-shot reconciliation backfill that ran alongside the assignments-
-- source-of-truth migration. Idempotent — re-running is a no-op.
--
-- 1. Link trucks/trailers.driver_id from the import's "Driver" raw
--    string where it's null and the named driver exists. Match on
--    internal id first ("#1937 - Bob"), then exact full name.
-- 2. Synthesize an OPEN equipment_assignments row for every unit with
--    a driver but no open assignment. source='reconciled'.
-- 3. Resolver run propagates the open assignment's driver carrier to
--    each unit so the carrier invariant holds.
--
-- Pre-fix snapshot at run time (Jun 2026): 27 trucks + 4 trailers
-- missing an open assignment; 50 trucks + 88 trailers with carrier !=
-- driver's carrier. Post-fix: all four counts at 0.

-- 1a. Trucks raw-driver link.
WITH cand AS (
  SELECT t.id AS unit_id,
         (SELECT d.id FROM public.drivers d
           WHERE d.internal_id = (regexp_match(t.driver_assignment_raw,'#?(\d+)'))[1]
           LIMIT 1) AS by_id,
         (SELECT d.id FROM public.drivers d
           WHERE lower(btrim(d.full_name)) = lower(btrim(regexp_replace(t.driver_assignment_raw,'^#?\d+\s*-\s*','')))
           LIMIT 1) AS by_name
    FROM public.trucks t
   WHERE t.driver_id IS NULL
     AND t.driver_assignment_raw IS NOT NULL
     AND btrim(t.driver_assignment_raw) NOT IN ('','-')
)
UPDATE public.trucks t
   SET driver_id = COALESCE(c.by_id, c.by_name), updated_at = now()
  FROM cand c
 WHERE c.unit_id = t.id AND COALESCE(c.by_id, c.by_name) IS NOT NULL;

-- 1b. Trailers raw-driver link (parallel logic, future-proof if trailers
-- ever carry a driver_assignment_raw from the import).
WITH cand AS (
  SELECT t.id AS unit_id,
         (SELECT d.id FROM public.drivers d
           WHERE d.internal_id = (regexp_match(t.driver_assignment_raw,'#?(\d+)'))[1]
           LIMIT 1) AS by_id,
         (SELECT d.id FROM public.drivers d
           WHERE lower(btrim(d.full_name)) = lower(btrim(regexp_replace(t.driver_assignment_raw,'^#?\d+\s*-\s*','')))
           LIMIT 1) AS by_name
    FROM public.trailers t
   WHERE t.driver_id IS NULL
     AND t.driver_assignment_raw IS NOT NULL
     AND btrim(t.driver_assignment_raw) NOT IN ('','-')
)
UPDATE public.trailers t
   SET driver_id = COALESCE(c.by_id, c.by_name), updated_at = now()
  FROM cand c
 WHERE c.unit_id = t.id AND COALESCE(c.by_id, c.by_name) IS NOT NULL;

-- 2a. Synthesize a Current assignment for every truck with a driver
-- but no open assignment.
INSERT INTO public.equipment_assignments
  (equipment_type, truck_id, trailer_id, equipment_name_raw, driver_id, tms_driver_id, driver_name_raw, start_date, end_date, source)
SELECT 'truck', t.id, NULL, t.unit_number, t.driver_id, d.internal_id, d.full_name,
       COALESCE(t.ownership_stage_started_at::date, (now() AT TIME ZONE 'America/Chicago')::date),
       NULL, 'reconciled'
  FROM public.trucks t JOIN public.drivers d ON d.id = t.driver_id
 WHERE t.driver_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.equipment_assignments a WHERE a.truck_id=t.id AND a.end_date IS NULL);

-- 2b. Same for trailers.
INSERT INTO public.equipment_assignments
  (equipment_type, truck_id, trailer_id, equipment_name_raw, driver_id, tms_driver_id, driver_name_raw, start_date, end_date, source)
SELECT 'trailer', NULL, tr.id, tr.unit_number, tr.driver_id, d.internal_id, d.full_name,
       COALESCE(tr.ownership_stage_started_at::date, (now() AT TIME ZONE 'America/Chicago')::date),
       NULL, 'reconciled'
  FROM public.trailers tr JOIN public.drivers d ON d.id = tr.driver_id
 WHERE tr.driver_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.equipment_assignments a WHERE a.trailer_id=tr.id AND a.end_date IS NULL);

-- 3. Sync carrier from each unit's current driver. Resolver short-
-- circuits where nothing changed.
SELECT public.resolve_current_equipment_drivers();
