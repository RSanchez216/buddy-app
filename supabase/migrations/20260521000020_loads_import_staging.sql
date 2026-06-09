-- Loads ingest — Phase 2 staging tables. Hold a parsed/diffed import
-- batch for review BEFORE anything is written to loads/load_legs. The
-- importer (client-side, SheetJS) parses the TMS "All Loads" export,
-- resolves entities, dedups against existing loads, diffs watched fields,
-- and stages the result here; the review screen approves/skips per load;
-- apply writes through to the Phase 1 tables and marks the batch applied.
--
-- A batch is the unit of one upload. Rows are one-per-file-row (leg),
-- carrying the original row (raw), the normalized values used on apply
-- (parsed), resolved entity ids + match status (resolved), the watched-
-- field diff (diff), the load-level classification, and a per-load
-- approve/skip decision. ON DELETE CASCADE so discarding a batch clears
-- its rows.

CREATE TABLE public.load_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text,
  status text NOT NULL DEFAULT 'pending_review',   -- pending_review | applied | discarded
  total_rows integer NOT NULL DEFAULT 0,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,        -- {new,updated,unchanged,new_legs,new_customers,new_dispatchers,unmatched}
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.load_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.load_import_batches(id) ON DELETE CASCADE,
  row_index integer NOT NULL,
  load_number text NOT NULL,
  classification text NOT NULL,                     -- new | updated | unchanged | new_leg
  is_status_flag boolean NOT NULL DEFAULT false,    -- status flipped to Canceled/TONU
  decision text NOT NULL DEFAULT 'approved',        -- approved | skipped
  raw jsonb NOT NULL,                               -- original row
  parsed jsonb NOT NULL,                            -- normalized/parsed values used on apply
  resolved jsonb NOT NULL DEFAULT '{}'::jsonb,      -- entity ids + per-entity match_status
  diff jsonb NOT NULL DEFAULT '[]'::jsonb,          -- [{scope:'header'|'leg', field, old, new}]
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX load_import_rows_batch_idx ON public.load_import_rows (batch_id);
CREATE INDEX load_import_rows_class_idx ON public.load_import_rows (batch_id, classification);

CREATE TRIGGER set_updated_at_load_import_batches BEFORE UPDATE ON public.load_import_batches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: match the existing trucks/trailers form EXACTLY (four PERMISSIVE
-- per-command auth_<cmd>_<table> policies TO public), not a single FOR ALL.
ALTER TABLE public.load_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.load_import_rows    ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_select_load_import_batches ON public.load_import_batches FOR SELECT TO public USING (true);
CREATE POLICY auth_insert_load_import_batches ON public.load_import_batches FOR INSERT TO public WITH CHECK (true);
CREATE POLICY auth_update_load_import_batches ON public.load_import_batches FOR UPDATE TO public USING (true);
CREATE POLICY auth_delete_load_import_batches ON public.load_import_batches FOR DELETE TO public USING (true);

CREATE POLICY auth_select_load_import_rows ON public.load_import_rows FOR SELECT TO public USING (true);
CREATE POLICY auth_insert_load_import_rows ON public.load_import_rows FOR INSERT TO public WITH CHECK (true);
CREATE POLICY auth_update_load_import_rows ON public.load_import_rows FOR UPDATE TO public USING (true);
CREATE POLICY auth_delete_load_import_rows ON public.load_import_rows FOR DELETE TO public USING (true);

GRANT ALL ON public.load_import_batches TO anon, authenticated, service_role;
GRANT ALL ON public.load_import_rows    TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
