-- Self-healing close-out for the weekly TMS assignment delta. TMS sends
-- the NEW assignment for a unit on a driver change but doesn't close
-- the previous driver's open row, leaving a unit with multiple
-- "Open / Current" assignments. The rule: for each unit, only the
-- latest-start assignment may stay open; every earlier open row is
-- closed with end_date = the immediately-following assignment's
-- start_date (a date-level handoff — the previous ends and the next
-- starts on the same day).
--
-- Only OPEN rows are touched. Already-closed rows keep their real
-- end_date so genuine idle gaps between drivers stay preserved.

CREATE OR REPLACE FUNCTION public.close_superseded_open_assignments()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  WITH ordered AS (
    SELECT a.id,
           a.end_date,
           lead(a.start_date) OVER (
             PARTITION BY a.equipment_type, coalesce(a.truck_id, a.trailer_id)
             ORDER BY a.start_date, a.created_at
           ) AS next_start
    FROM public.equipment_assignments a
    WHERE (a.truck_id IS NOT NULL OR a.trailer_id IS NOT NULL)
  ),
  upd AS (
    UPDATE public.equipment_assignments a
       SET end_date = o.next_start, updated_at = now()
      FROM ordered o
     WHERE a.id = o.id
       AND a.end_date IS NULL
       AND o.next_start IS NOT NULL
    RETURNING a.id
  )
  SELECT count(*) INTO n FROM upd;
  RETURN n;
END; $$;

GRANT EXECUTE ON FUNCTION public.close_superseded_open_assignments() TO authenticated;

-- One-time cleanup of pre-existing overlaps, then refresh
-- trucks/trailers.driver_id off the now-single open row per unit.
SELECT public.close_superseded_open_assignments();
SELECT public.resolve_current_equipment_drivers();

NOTIFY pgrst, 'reload schema';
