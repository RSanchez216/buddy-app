-- Register the two Customers pages in public.pages so they surface in the
-- sidebar (the nav is DB-driven via my_pages()) and can be granted per role /
-- gated by has_page_access — until now they resolved by direct URL only because
-- an admin was viewing them. The profile route is /fleet/customers/:id, but
-- has_page_access resolves on page_key OR the base route, so the base path is
-- enough. Placed in the Fleet group right after Loads Import.
--
-- Idempotent: ON CONFLICT (page_key) DO NOTHING, so re-running is a no-op. Only
-- the columns the app reads (Pages admin + my_pages) are set; the rest default.
-- New pages are not shareable and carry no access grants, so non-admins can't
-- reach them until explicitly granted — the intended gate.

INSERT INTO public.pages (page_key, label, route, nav_group, sort_order, is_shareable)
VALUES
  ('customers_import', 'Customers Import', '/fleet/customers/import', 'Fleet',
     COALESCE((SELECT sort_order FROM public.pages WHERE page_key = 'loads_import'), 100) + 1, false),
  ('customer_profile', 'Customers', '/fleet/customers', 'Fleet',
     COALESCE((SELECT sort_order FROM public.pages WHERE page_key = 'loads_import'), 100) + 2, false)
ON CONFLICT (page_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
