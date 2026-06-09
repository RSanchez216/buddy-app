-- Per-customer "trailer required" flag (default true). Drives the Loads
-- Import "Needs review" flag: a non-Canceled load with no trailer is worth
-- a manual look — EXCEPT for customers that supply their own trailer (drop
-- trailer), e.g. Amazon Logistics Inc, where missing trailer is normal.
--
-- Default true means every existing customer keeps the "trailer required"
-- behavior. The importer also exempts "Amazon Logistics Inc" by name on
-- auto-create (so the rule works the first time an Amazon load appears,
-- before the customer row exists); this column lets other drop-trailer
-- brokers be exempted later via a toggle/MCP update.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS trailer_required boolean NOT NULL DEFAULT true;

-- Seed the Amazon exemption (no-op until/unless the customer exists).
UPDATE public.customers
   SET trailer_required = false
 WHERE lower(btrim(name)) = 'amazon logistics inc';

NOTIFY pgrst, 'reload schema';
