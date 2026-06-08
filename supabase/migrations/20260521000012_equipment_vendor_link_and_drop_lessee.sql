-- Resolver: fill lessor_vendor_id for company_leased units by matching
-- equipment_owner_raw against Equipment Rental vendor names + aliases.
-- Only fills NULLs — never clobbers a manual pick. Run after the
-- weekly fleet import so new leased units auto-link going forward.
CREATE OR REPLACE FUNCTION public.resolve_lessor_vendors() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE total integer := 0; n integer;
BEGIN
  WITH keys AS (
    SELECT v.id AS vendor_id, lower(btrim(v.name)) AS k
      FROM public.vendors v WHERE v.category = 'Equipment Rental'
    UNION
    SELECT a.vendor_id, lower(btrim(a.alias))
      FROM public.vendor_aliases a
      JOIN public.vendors v ON v.id = a.vendor_id
      WHERE v.category = 'Equipment Rental'
  )
  UPDATE public.trucks t SET lessor_vendor_id = k.vendor_id
  FROM keys k
  WHERE t.lessor_vendor_id IS NULL AND t.ownership_stage = 'company_leased'
    AND t.equipment_owner_raw IS NOT NULL
    AND lower(btrim(t.equipment_owner_raw)) = k.k;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

  WITH keys AS (
    SELECT v.id AS vendor_id, lower(btrim(v.name)) AS k
      FROM public.vendors v WHERE v.category = 'Equipment Rental'
    UNION
    SELECT a.vendor_id, lower(btrim(a.alias))
      FROM public.vendor_aliases a
      JOIN public.vendors v ON v.id = a.vendor_id
      WHERE v.category = 'Equipment Rental'
  )
  UPDATE public.trailers t SET lessor_vendor_id = k.vendor_id
  FROM keys k
  WHERE t.lessor_vendor_id IS NULL AND t.ownership_stage = 'company_leased'
    AND t.equipment_owner_raw IS NOT NULL
    AND lower(btrim(t.equipment_owner_raw)) = k.k;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

  RETURN total;
END $$;

GRANT EXECUTE ON FUNCTION public.resolve_lessor_vendors() TO authenticated;

-- One-time backfill against the current data.
SELECT public.resolve_lessor_vendors();

-- Drop the redundant Lessee column (MANAS is always the lessee).
-- Verified upstream that no views/functions reference it.
ALTER TABLE public.trucks   DROP COLUMN IF EXISTS lessee;
ALTER TABLE public.trailers DROP COLUMN IF EXISTS lessee;

NOTIFY pgrst, 'reload schema';
