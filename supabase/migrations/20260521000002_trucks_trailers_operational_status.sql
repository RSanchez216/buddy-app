-- User-managed operational status (active / inactive / archived) that
-- survives weekly TMS uploads. Distinct from the imported `status` field
-- (uniformly "Active" and overwritten every Monday) and from
-- `ownership_stage` (financial: who owns it / cost lifecycle).

ALTER TABLE public.trucks
  ADD COLUMN IF NOT EXISTS operational_status text NOT NULL DEFAULT 'active'
    CHECK (operational_status IN ('active','inactive','archived'));

ALTER TABLE public.trailers
  ADD COLUMN IF NOT EXISTS operational_status text NOT NULL DEFAULT 'active'
    CHECK (operational_status IN ('active','inactive','archived'));

NOTIFY pgrst, 'reload schema';
