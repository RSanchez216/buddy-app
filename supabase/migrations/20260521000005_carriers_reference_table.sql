-- Managed carrier list. Mirrors the loan_entities pattern but adds an
-- updated_at column for parity with the newer reference tables and a
-- case-insensitive unique index on the trimmed name so "TMS  Transport"
-- and "tms transport" can't both be inserted.

CREATE TABLE IF NOT EXISTS public.carriers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_carriers_name
  ON public.carriers (lower(btrim(name)));

ALTER TABLE public.carriers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS carriers_all ON public.carriers;
CREATE POLICY carriers_all ON public.carriers FOR ALL USING (true) WITH CHECK (true);

-- Seed from the carrier values currently in the data so the dropdown is
-- usable on day one without an additional reload step.
INSERT INTO public.carriers (name) VALUES
  ('TMS Transport Solutions Inc'),
  ('PJ Twins Inc'),
  ('USKG Trans Inc')
ON CONFLICT (lower(btrim(name))) DO NOTHING;

NOTIFY pgrst, 'reload schema';
