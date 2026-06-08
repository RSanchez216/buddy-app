-- equipment_assignments is the source of truth for who-drives-what-when.
-- Both the resolver and the new set_unit_current_driver() entry point
-- live in this migration so every code path that sets a driver writes
-- to history + cascades carrier in the same way.

-- Replace the existing resolver so it ALSO syncs carrier from the open
-- assignment's driver. Carrier invariant: a unit's carrier must always
-- equal its current driver's carrier. A unit with no current driver
-- keeps its last-known carrier (we never blank it).
CREATE OR REPLACE FUNCTION public.resolve_current_equipment_drivers()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.trucks t
     SET driver_id  = a.driver_id,
         carrier    = COALESCE(NULLIF(btrim(d.carrier), ''), t.carrier),
         updated_at = now()
    FROM public.equipment_assignments a
    JOIN public.drivers d ON d.id = a.driver_id
   WHERE a.equipment_type = 'truck'
     AND a.truck_id = t.id
     AND a.end_date IS NULL
     AND a.driver_id IS NOT NULL
     AND ( t.driver_id IS DISTINCT FROM a.driver_id
        OR (d.carrier IS NOT NULL
            AND lower(btrim(coalesce(t.carrier, ''))) <> lower(btrim(d.carrier))) );

  UPDATE public.trailers t
     SET driver_id  = a.driver_id,
         carrier    = COALESCE(NULLIF(btrim(d.carrier), ''), t.carrier),
         updated_at = now()
    FROM public.equipment_assignments a
    JOIN public.drivers d ON d.id = a.driver_id
   WHERE a.equipment_type = 'trailer'
     AND a.trailer_id = t.id
     AND a.end_date IS NULL
     AND a.driver_id IS NOT NULL
     AND ( t.driver_id IS DISTINCT FROM a.driver_id
        OR (d.carrier IS NOT NULL
            AND lower(btrim(coalesce(t.carrier, ''))) <> lower(btrim(d.carrier))) );
END; $$;

-- Single entry point for setting a unit's current driver. Closes the
-- prior open assignment(s), opens a new one if a driver is provided,
-- then re-derives driver_id + carrier off the open row. Used by the
-- edit form (manual), the trucks/trailers import (gap-fill), and the
-- one-time backfill below.
CREATE OR REPLACE FUNCTION public.set_unit_current_driver(
  p_equipment_type text,
  p_unit_id        uuid,
  p_new_driver_id  uuid,                 -- NULL = unassign
  p_effective      date DEFAULT (now() AT TIME ZONE 'America/Chicago')::date,
  p_source         text DEFAULT 'manual'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_open_driver uuid;
  v_unit text;
  v_internal text;
  v_name text;
BEGIN
  IF p_equipment_type NOT IN ('truck','trailer') THEN
    RAISE EXCEPTION 'p_equipment_type must be truck or trailer';
  END IF;

  -- What's the current open driver for this unit?
  SELECT a.driver_id INTO v_open_driver
    FROM public.equipment_assignments a
   WHERE a.end_date IS NULL
     AND ((p_equipment_type='truck'   AND a.truck_id   = p_unit_id)
       OR (p_equipment_type='trailer' AND a.trailer_id = p_unit_id))
   ORDER BY a.start_date DESC
   LIMIT 1;

  -- Same driver already open: no-op (avoids spurious history churn when
  -- callers can't tell whether a change happened).
  IF v_open_driver IS NOT DISTINCT FROM p_new_driver_id THEN
    RETURN;
  END IF;

  -- Close any open assignment on this unit (defensive: there should be
  -- at most one after close_superseded_open_assignments() ran).
  UPDATE public.equipment_assignments
     SET end_date = p_effective, updated_at = now()
   WHERE end_date IS NULL
     AND ((p_equipment_type='truck'   AND truck_id   = p_unit_id)
       OR (p_equipment_type='trailer' AND trailer_id = p_unit_id));

  -- Open a new assignment when a driver is provided.
  IF p_new_driver_id IS NOT NULL THEN
    SELECT internal_id, full_name INTO v_internal, v_name
      FROM public.drivers WHERE id = p_new_driver_id;
    IF p_equipment_type = 'truck' THEN
      SELECT unit_number INTO v_unit FROM public.trucks   WHERE id = p_unit_id;
    ELSE
      SELECT unit_number INTO v_unit FROM public.trailers WHERE id = p_unit_id;
    END IF;

    INSERT INTO public.equipment_assignments
      (equipment_type, truck_id, trailer_id, equipment_name_raw, driver_id,
       tms_driver_id, driver_name_raw, start_date, end_date, source)
    VALUES (p_equipment_type,
            CASE WHEN p_equipment_type='truck'   THEN p_unit_id END,
            CASE WHEN p_equipment_type='trailer' THEN p_unit_id END,
            v_unit, p_new_driver_id, v_internal, v_name, p_effective, NULL, p_source);
  END IF;

  -- Re-derive trucks/trailers.driver_id + carrier from the open row.
  -- The resolver no-ops when the unit is already in the desired state,
  -- so we always call it.
  PERFORM public.resolve_current_equipment_drivers();
END; $$;

GRANT EXECUTE ON FUNCTION public.set_unit_current_driver(text,uuid,uuid,date,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
