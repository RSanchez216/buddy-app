-- Reference table for expense categories shared by custom_outflows and
-- recurring_expense_templates. Loose-text linkage mirrors equipment_types:
-- categories.name is what's stored on the consuming rows; lookup against
-- this table at render time gives display_label and active/archived state.
--
-- Auth-only RLS mirrors funding_accounts and equipment_types. Role gating
-- runs at the UI layer via useAuth().canEdit. No DELETE policy — archive
-- (is_active=FALSE) is the surfaced retire path; hard delete only via MCP
-- after a usage_count=0 confirmation.

CREATE TABLE public.expense_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,
  display_label text NOT NULL,
  sort_order    integer NOT NULL DEFAULT 100,
  is_active     boolean NOT NULL DEFAULT TRUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_expense_categories_active_sort
  ON public.expense_categories(is_active, sort_order);

CREATE TRIGGER expense_categories_set_updated_at
  BEFORE UPDATE ON public.expense_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_select_expense_categories
  ON public.expense_categories FOR SELECT USING (true);
CREATE POLICY auth_insert_expense_categories
  ON public.expense_categories FOR INSERT WITH CHECK (true);
CREATE POLICY auth_update_expense_categories
  ON public.expense_categories FOR UPDATE USING (true);

INSERT INTO public.expense_categories (name, display_label, sort_order) VALUES
  ('payroll',       'Payroll',         10),
  ('fuel',          'Fuel',            20),
  ('maintenance',   'Maintenance',     30),
  ('repair',        'Repair',          40),
  ('telematics',    'Telematics',      50),
  ('lease',         'Lease',           60),
  ('insurance',     'Insurance',       70),
  ('factoring_fee', 'Factoring Fee',   80),
  ('bank_fee',      'Bank Fee',        90),
  ('tolls',         'Tolls',          100),
  ('permits',       'Permits',        110),
  ('ifta',          'IFTA',           120),
  ('legal',         'Legal',          130),
  ('accounting',    'Accounting',     140),
  ('owner_draw',    'Owner Draw',     150),
  ('other',         'Other',         1000)
ON CONFLICT (name) DO NOTHING;

-- Pick up any in-use values not in the canonical list (defensive — should be
-- a no-op in current prod where only payroll/maintenance/insurance/other
-- exist and all four map to canonical entries above).
INSERT INTO public.expense_categories (name, display_label, sort_order)
SELECT DISTINCT
  c.category AS name,
  initcap(replace(c.category, '_', ' ')) AS display_label,
  500 AS sort_order
FROM (
  SELECT category FROM public.custom_outflows WHERE category IS NOT NULL
  UNION
  SELECT category FROM public.recurring_expense_templates WHERE category IS NOT NULL
) c
WHERE c.category NOT IN (SELECT name FROM public.expense_categories)
ON CONFLICT (name) DO NOTHING;

NOTIFY pgrst, 'reload schema';
