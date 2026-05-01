-- Factors (factoring companies)
--
-- Already applied to the database under the name `factors`. This file
-- exists so the migrations folder reflects the live schema.
--
-- Backs Settings → Funding & Sources → Factoring Companies.

CREATE TABLE IF NOT EXISTS factors (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        text        NOT NULL UNIQUE,
  -- Fee rate stored as a decimal fraction (1% → 0.0100). The UI accepts a
  -- percentage in the input and divides by 100 on save.
  fee_rate                    numeric,
  default_deposit_account_id  uuid        REFERENCES funding_accounts(id),
  notes                       text,
  is_active                   boolean     NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN factors.fee_rate IS '% kept by factor per advance, stored as a decimal fraction (1% → 0.0100).';
COMMENT ON COLUMN factors.default_deposit_account_id IS 'Default funding account where this factor deposits advances.';

ALTER TABLE factors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_factors" ON factors;
DROP POLICY IF EXISTS "auth_insert_factors" ON factors;
DROP POLICY IF EXISTS "auth_update_factors" ON factors;
DROP POLICY IF EXISTS "auth_delete_factors" ON factors;

CREATE POLICY "auth_select_factors" ON factors FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_factors" ON factors FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_factors" ON factors FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_delete_factors" ON factors FOR DELETE TO authenticated USING (true);

-- Touch updated_at on every UPDATE
CREATE OR REPLACE FUNCTION public.factors_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS factors_touch_updated_at ON factors;
CREATE TRIGGER factors_touch_updated_at
  BEFORE UPDATE ON factors
  FOR EACH ROW
  EXECUTE FUNCTION public.factors_touch_updated_at();
