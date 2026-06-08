-- BEFORE INSERT/UPDATE trigger on trucks + trailers that auto-fills
-- lessor_vendor_id whenever the unit is leased, has owner text, and
-- has no manual lessor pick. Match is case- and trim-insensitive,
-- against Equipment Rental vendor names first, then aliases.
--
-- Manual picks/unlinks are preserved: we only act when
-- lessor_vendor_id IS NULL. The trigger does not fire when
-- lessor_vendor_id itself changes (UPDATE OF is restricted to
-- equipment_owner_raw + ownership_stage), so a Save that only edits
-- those columns can't loop or override an existing pick.
CREATE OR REPLACE FUNCTION public.tg_link_lessor_from_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE vid uuid;
BEGIN
  IF NEW.ownership_stage = 'company_leased'
     AND NEW.lessor_vendor_id IS NULL
     AND NEW.equipment_owner_raw IS NOT NULL THEN
    SELECT v.id INTO vid
      FROM public.vendors v
      WHERE v.category = 'Equipment Rental'
        AND lower(btrim(v.name)) = lower(btrim(NEW.equipment_owner_raw))
      LIMIT 1;
    IF vid IS NULL THEN
      SELECT a.vendor_id INTO vid
        FROM public.vendor_aliases a
        JOIN public.vendors v ON v.id = a.vendor_id
        WHERE v.category = 'Equipment Rental'
          AND lower(btrim(a.alias)) = lower(btrim(NEW.equipment_owner_raw))
        LIMIT 1;
    END IF;
    IF vid IS NOT NULL THEN NEW.lessor_vendor_id := vid; END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_link_lessor_trucks ON public.trucks;
CREATE TRIGGER trg_link_lessor_trucks
  BEFORE INSERT OR UPDATE OF equipment_owner_raw, ownership_stage
  ON public.trucks FOR EACH ROW EXECUTE FUNCTION public.tg_link_lessor_from_owner();

DROP TRIGGER IF EXISTS trg_link_lessor_trailers ON public.trailers;
CREATE TRIGGER trg_link_lessor_trailers
  BEFORE INSERT OR UPDATE OF equipment_owner_raw, ownership_stage
  ON public.trailers FOR EACH ROW EXECUTE FUNCTION public.tg_link_lessor_from_owner();

-- One-time backlog clear — links the currently-matchable units
-- (e.g. trailer #F26018 with owner "Cadence Truck & Trailer Leasing
-- LLC"). Result on prod: 28 leased / 26 linked (was 23); the two
-- holdouts have a non-matching owner spelling or no owner text.
SELECT public.resolve_lessor_vendors();

NOTIFY pgrst, 'reload schema';
