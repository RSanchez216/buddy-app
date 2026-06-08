-- Backfill vendors.category_id and vendors.payment_method_id from the
-- text columns where the FK side is null. Match case- and trim-
-- insensitively against the reference tables. Idempotent — re-runs
-- against an already-filled row are no-ops.
UPDATE public.vendors v SET category_id = vc.id
FROM public.vendor_categories vc
WHERE v.category_id IS NULL AND v.category IS NOT NULL
  AND lower(btrim(vc.name)) = lower(btrim(v.category));

UPDATE public.vendors v SET payment_method_id = pm.id
FROM public.payment_methods pm
WHERE v.payment_method_id IS NULL AND v.payment_method IS NOT NULL
  AND lower(btrim(pm.name)) = lower(btrim(v.payment_method));

NOTIFY pgrst, 'reload schema';
