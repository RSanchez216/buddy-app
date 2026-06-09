-- Lessor link guard — leased-only. Driver-owned / company-owned units
-- were carrying stale lessor_vendor_id values left over from a prior
-- lease (e.g. truck #74, driver-owned, still pointed at AAA Lease LLC),
-- so they surfaced under that vendor's "Leased Equipment" list.
--
-- Root cause: nothing cleared lessor_vendor_id when a unit transitioned
-- away from company_leased. The auto-link resolver only acts on leased
-- units with a NULL link, so it neither caused nor fixes this.
--
-- This extends tg_link_lessor_from_owner() with a guard: any
-- non-company_leased unit has its lessor_vendor_id forced to NULL on
-- insert/update, BEFORE the existing auto-link logic. Leased units keep
-- the current behavior (fill a NULL link from owner name/alias; never
-- clobber a manual link). After this, ownership_stage is the single
-- source of truth for whether a unit can hold a lessor.
--
-- CREATE OR REPLACE keeps the existing grants and the two triggers bound
-- to this function (trg_link_lessor_trucks / trg_link_lessor_trailers,
-- both BEFORE INSERT OR UPDATE) — no re-grant, no NOTIFY pgrst (no
-- schema/API surface change).

CREATE OR REPLACE FUNCTION public.tg_link_lessor_from_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE vid uuid;
BEGIN
  -- Guard: only leased units may carry a lessor link. Clear it for anything else.
  IF NEW.ownership_stage IS DISTINCT FROM 'company_leased' THEN
    NEW.lessor_vendor_id := NULL;
    RETURN NEW;
  END IF;

  -- Leased + no link yet: auto-fill from owner text (exact name, then alias).
  IF NEW.lessor_vendor_id IS NULL
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
END $function$;
