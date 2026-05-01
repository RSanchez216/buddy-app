-- Factoring companies
--
-- Adds the factoring_companies table to back the new "Factoring Companies"
-- section on Settings → Funding & Sources. Mirrors the funding_accounts
-- pattern for RLS and lifecycle (is_active toggle, soft retention).

CREATE TABLE IF NOT EXISTS factoring_companies (
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

COMMENT ON COLUMN factoring_companies.fee_rate IS '% kept by factor per advance, stored as a decimal fraction (1% → 0.0100).';
COMMENT ON COLUMN factoring_companies.default_deposit_account_id IS 'Default funding account where this factor deposits advances.';

ALTER TABLE factoring_companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_factoring_companies" ON factoring_companies;
DROP POLICY IF EXISTS "auth_insert_factoring_companies" ON factoring_companies;
DROP POLICY IF EXISTS "auth_update_factoring_companies" ON factoring_companies;
DROP POLICY IF EXISTS "auth_delete_factoring_companies" ON factoring_companies;

CREATE POLICY "auth_select_factoring_companies" ON factoring_companies FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_factoring_companies" ON factoring_companies FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_factoring_companies" ON factoring_companies FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_delete_factoring_companies" ON factoring_companies FOR DELETE TO authenticated USING (true);

-- Touch updated_at on every UPDATE
CREATE OR REPLACE FUNCTION public.factoring_companies_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS factoring_companies_touch_updated_at ON factoring_companies;
CREATE TRIGGER factoring_companies_touch_updated_at
  BEFORE UPDATE ON factoring_companies
  FOR EACH ROW
  EXECUTE FUNCTION public.factoring_companies_touch_updated_at();
