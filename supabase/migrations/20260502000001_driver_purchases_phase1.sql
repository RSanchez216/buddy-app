-- Phase 1 — Driver Purchases module
--
-- 7 tables, RLS, indexes, seed statuses, summary view, and the
-- driver-documents storage bucket. Idempotent — safe to re-run.
-- Read-side SELECT is open to authenticated; writes are gated by
-- public.is_admin_or_manager() (admins + managers only).

-- ── 1. drivers ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  internal_id text,
  id_type text CHECK (id_type IN ('driver_license','cdl','passport','state_id','other')),
  id_number text,
  id_issuing_authority text,
  id_expiration date,
  date_of_birth date,
  phone text,
  email text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_drivers_full_name ON drivers (full_name);
CREATE INDEX IF NOT EXISTS idx_drivers_internal_id ON drivers (internal_id) WHERE internal_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_drivers_updated_at ON drivers;
CREATE TRIGGER trg_drivers_updated_at BEFORE UPDATE ON drivers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. driver_documents ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('id_front','id_back','cdl','photo','other')),
  file_path text NOT NULL,
  file_name text,
  notes text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_driver_documents_driver ON driver_documents (driver_id);

-- ── 3. driver_purchase_statuses ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_purchase_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  color_hex text NOT NULL DEFAULT '#5F5E5A',
  is_active_state boolean NOT NULL DEFAULT false,
  is_terminal boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_driver_purchase_statuses_updated_at ON driver_purchase_statuses;
CREATE TRIGGER trg_driver_purchase_statuses_updated_at BEFORE UPDATE ON driver_purchase_statuses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed default statuses (idempotent — ON CONFLICT on the unique name)
INSERT INTO driver_purchase_statuses (name, color_hex, is_active_state, is_terminal, sort_order, description) VALUES
  ('Pending Start',         '#888780', false, false, 10, 'Contract created, awaiting start date'),
  ('Waiting Sign Contract', '#888780', false, false, 20, 'Awaiting signed agreement'),
  ('Weekly Payments',       '#1D9E75', true,  false, 30, 'Active, deducted weekly from payroll'),
  ('Monthly Payment',       '#7F77DD', true,  false, 40, 'Active, deducted monthly from payroll'),
  ('Fully Paid',            '#5F5E5A', false, true,  50, 'Contract complete, awaiting title transfer'),
  ('Contract Broken',       '#A32D2D', false, true,  60, 'Contract terminated by Monas'),
  ('Driver Left',           '#A32D2D', false, true,  70, 'Driver left company'),
  ('Owner Left',            '#A32D2D', false, true,  80, 'Owner-operator separated')
ON CONFLICT (name) DO NOTHING;

-- ── 4. driver_purchases ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  entity_id uuid REFERENCES loan_entities(id),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  co_driver_ids uuid[] DEFAULT '{}',

  truck_number text,
  vin text,
  equipment_type text,
  equipment_id uuid REFERENCES loan_equipment(id),
  underlying_loan_id uuid REFERENCES loans(id),

  purchase_type text NOT NULL CHECK (purchase_type IN ('cash','baikozu','driver_bank_loan')),

  status_id uuid NOT NULL REFERENCES driver_purchase_statuses(id),

  total_value numeric(12,2),
  downpayment numeric(12,2) DEFAULT 0,
  sale_price numeric(12,2),
  current_balance numeric(12,2) NOT NULL DEFAULT 0,
  payment_amount numeric(12,2),
  payment_frequency text CHECK (payment_frequency IN ('weekly','biweekly','monthly')),

  purchase_date date,
  contract_signed_date date,
  fully_paid_date date,

  title_transferred boolean DEFAULT false,
  qb_completed boolean DEFAULT false,

  notes text,
  original_clickup_id text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_driver_purchases_driver ON driver_purchases (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_purchases_status ON driver_purchases (status_id);
CREATE INDEX IF NOT EXISTS idx_driver_purchases_equipment ON driver_purchases (equipment_id);
CREATE INDEX IF NOT EXISTS idx_driver_purchases_loan ON driver_purchases (underlying_loan_id);
CREATE INDEX IF NOT EXISTS idx_driver_purchases_vin ON driver_purchases (vin) WHERE vin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_driver_purchases_clickup ON driver_purchases (original_clickup_id) WHERE original_clickup_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_driver_purchases_updated_at ON driver_purchases;
CREATE TRIGGER trg_driver_purchases_updated_at BEFORE UPDATE ON driver_purchases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 5. driver_purchase_payments ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_purchase_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_purchase_id uuid NOT NULL REFERENCES driver_purchases(id) ON DELETE CASCADE,

  period_start date NOT NULL,
  period_end date NOT NULL,
  period_type text NOT NULL CHECK (period_type IN ('weekly','biweekly','monthly')),

  expected_amount numeric(12,2) NOT NULL,
  actual_amount numeric(12,2) NOT NULL DEFAULT 0,
  variance numeric(12,2) GENERATED ALWAYS AS (actual_amount - expected_amount) STORED,

  payment_method text,
  reason text,
  reference_number text,

  reconciled boolean NOT NULL DEFAULT false,
  reconciled_at timestamptz,
  reconciled_by uuid REFERENCES auth.users(id),

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (driver_purchase_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_dp_payments_purchase ON driver_purchase_payments (driver_purchase_id);
CREATE INDEX IF NOT EXISTS idx_dp_payments_period ON driver_purchase_payments (period_start, period_end);

DROP TRIGGER IF EXISTS trg_dp_payments_updated_at ON driver_purchase_payments;
CREATE TRIGGER trg_dp_payments_updated_at BEFORE UPDATE ON driver_purchase_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 6. driver_purchase_events ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_purchase_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_purchase_id uuid NOT NULL REFERENCES driver_purchases(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  description text,
  metadata jsonb DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dp_events_purchase ON driver_purchase_events (driver_purchase_id);

-- ── 7. driver_purchase_documents ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_purchase_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_purchase_id uuid NOT NULL REFERENCES driver_purchases(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('signed_contract','bill_of_sale','title','payoff_letter','other')),
  file_path text NOT NULL,
  file_name text,
  notes text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_dp_documents_purchase ON driver_purchase_documents (driver_purchase_id);

-- ── RLS ─────────────────────────────────────────────────────────────────
-- Enable RLS on every table; SELECT for authenticated, writes gated by
-- is_admin_or_manager().
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'drivers',
    'driver_documents',
    'driver_purchase_statuses',
    'driver_purchases',
    'driver_purchase_payments',
    'driver_purchase_events',
    'driver_purchase_documents'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth_select_'||t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'mgr_insert_'||t,  t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'mgr_update_'||t,  t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'mgr_delete_'||t,  t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      'auth_select_'||t, t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_admin_or_manager())',
      'mgr_insert_'||t, t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_admin_or_manager()) WITH CHECK (public.is_admin_or_manager())',
      'mgr_update_'||t, t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_admin_or_manager())',
      'mgr_delete_'||t, t
    );
  END LOOP;
END $$;

-- ── Storage bucket ─────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('driver-documents', 'driver-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS driver_docs_select ON storage.objects;
DROP POLICY IF EXISTS driver_docs_insert ON storage.objects;
DROP POLICY IF EXISTS driver_docs_update ON storage.objects;
DROP POLICY IF EXISTS driver_docs_delete ON storage.objects;

CREATE POLICY driver_docs_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'driver-documents');

CREATE POLICY driver_docs_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'driver-documents');

CREATE POLICY driver_docs_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'driver-documents');

CREATE POLICY driver_docs_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'driver-documents');

-- ── View ───────────────────────────────────────────────────────────────
-- Powers the list page. Joins purchase + driver + status + entity +
-- underlying loan + lender. Exposes the underwater calculation.
--
-- NOTE: loans table uses `loan_id_external` (not `account_number`) and
-- `monthly_payment` (not `payment_amount`) — the view maps those into
-- friendlier names.
CREATE OR REPLACE VIEW v_driver_purchase_summary AS
SELECT
  dp.id,
  dp.entity_id,
  e.name AS entity_name,

  d.id AS driver_id,
  d.full_name AS driver_name,
  d.internal_id AS driver_internal_id,
  d.phone AS driver_phone,
  d.id_number AS driver_id_number,
  d.id_type AS driver_id_type,

  dp.truck_number,
  dp.vin,
  dp.equipment_type,
  dp.equipment_id,

  dp.underlying_loan_id,
  l.lender_id AS underlying_lender_id,
  ldr.name AS underlying_lender_name,
  l.loan_id_external AS underlying_loan_number,
  l.current_balance AS underlying_loan_balance,
  l.monthly_payment AS underlying_loan_payment,

  CASE
    WHEN dp.underlying_loan_id IS NULL THEN NULL
    ELSE COALESCE(l.current_balance, 0) - COALESCE(dp.current_balance, 0)
  END AS coverage_gap,

  CASE
    WHEN dp.underlying_loan_id IS NOT NULL
         AND COALESCE(l.current_balance, 0) > COALESCE(dp.current_balance, 0) THEN true
    ELSE false
  END AS is_underwater,

  dp.purchase_type,
  dp.status_id,
  s.name AS status_name,
  s.color_hex AS status_color,
  s.is_active_state,
  s.is_terminal,

  dp.total_value,
  dp.downpayment,
  dp.sale_price,
  dp.current_balance,
  dp.payment_amount,
  dp.payment_frequency,

  dp.purchase_date,
  dp.contract_signed_date,
  dp.fully_paid_date,

  dp.title_transferred,
  dp.qb_completed,

  dp.notes,
  dp.original_clickup_id,
  dp.created_at,
  dp.updated_at
FROM driver_purchases dp
JOIN drivers d                  ON d.id  = dp.driver_id
JOIN driver_purchase_statuses s ON s.id  = dp.status_id
LEFT JOIN loan_entities e       ON e.id  = dp.entity_id
LEFT JOIN loans l               ON l.id  = dp.underlying_loan_id
LEFT JOIN loan_lenders ldr      ON ldr.id = l.lender_id;

GRANT SELECT ON v_driver_purchase_summary TO authenticated;
