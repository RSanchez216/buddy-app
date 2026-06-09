-- Loads ingest — Phase 1 (schema only). Tables that hold daily TMS
-- "All Loads" exports, powering the Profitability Intelligence Layer.
-- Phase 2 (importer + review screen) and Phase 3 (profitability views)
-- depend on these tables.
--
-- Model decisions (locked with Rebeca):
--  * Key: TMS `#` (e.g. 2606-116) → loads.load_number UNIQUE.
--  * Team/relay loads: same `#` on multiple rows → one load header +
--    multiple load_legs (driver/truck/trailer/miles per leg). Revenue
--    (linehaul) lives ONCE on the header, never on legs.
--  * Notes (load_notes / load_instructions / invoice_notes): verbatim on
--    the header, set on first import only (Phase 2 rule; no DB constraint).
--  * Dispatcher & Customer: real entities, created/matched by the importer.
--    No Settings UI in any phase yet.
--  * Matching: *_raw store TMS text; *_id resolve to fleet records in
--    Phase 2. FK ids are NULLABLE so unmatched rows still import + surface
--    in review — nothing blocks import on a missing match.
--  * Dates: pickup_date/delivery_date parsed from pu_info/del_info by the
--    importer (Phase 2); raw strings AND parsed dates both stored.
--  * Status: free text from TMS (no check constraint). Phase 3 excludes
--    only status ilike 'canceled'; TONU is included (broker-paid revenue).

-- ===== Reference entities (no Settings UI yet) =====
CREATE TABLE public.dispatchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX dispatchers_name_norm_uidx ON public.dispatchers (lower(btrim(name)));

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customers_name_norm_uidx ON public.customers (lower(btrim(name)));

-- ===== Load header (one row per TMS load number `#`) =====
CREATE TABLE public.loads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_number text NOT NULL,                 -- TMS `#`, e.g. 2606-116
  customer_load_number text,                 -- broker's reference number
  customer_id   uuid REFERENCES public.customers(id),
  dispatcher_id uuid REFERENCES public.dispatchers(id),
  carrier_id    uuid REFERENCES public.carriers(id),
  status text NOT NULL,                      -- TMS free text (Billed/Booked/Canceled/Tonu/...)
  load_type text,
  num_picks integer,
  num_drops integer,
  pu_info text,                              -- raw origin string from TMS
  del_info text,                             -- raw destination string from TMS
  pickup_date date,                          -- parsed from pu_info (Phase 2)
  delivery_date date,                        -- parsed from del_info (Phase 2)
  linehaul numeric,                          -- REVENUE, counted once per load
  weight numeric,
  commodity text,
  load_notes text,                           -- verbatim, set on first import only
  load_instructions text,                    -- verbatim, set on first import only
  invoice_notes text,                        -- verbatim, set on first import only
  is_team_load boolean NOT NULL DEFAULT false,
  first_imported_at timestamptz NOT NULL DEFAULT now(),
  last_imported_at  timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loads_load_number_key UNIQUE (load_number)
);
CREATE INDEX loads_status_idx        ON public.loads (status);
CREATE INDEX loads_customer_idx      ON public.loads (customer_id);
CREATE INDEX loads_dispatcher_idx    ON public.loads (dispatcher_id);
CREATE INDEX loads_carrier_idx       ON public.loads (carrier_id);
CREATE INDEX loads_pickup_date_idx   ON public.loads (pickup_date);
CREATE INDEX loads_delivery_date_idx ON public.loads (delivery_date);

-- ===== Load legs (one row per driver segment; relay/team = >1 leg) =====
CREATE TABLE public.load_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id uuid NOT NULL REFERENCES public.loads(id) ON DELETE CASCADE,
  leg_seq integer NOT NULL DEFAULT 1,
  driver_raw  text NOT NULL,                 -- driver name as in TMS (always present)
  truck_raw   text,                          -- truck unit as in TMS (may be blank)
  trailer_raw text,                          -- trailer unit as in TMS (may be blank)
  driver_id  uuid REFERENCES public.drivers(id),
  truck_id   uuid REFERENCES public.trucks(id),
  trailer_id uuid REFERENCES public.trailers(id),
  empty_miles  numeric,
  loaded_miles numeric,
  total_miles  numeric,
  last_imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- leg natural key for upsert: a load never has the same driver twice
CREATE UNIQUE INDEX load_legs_load_driver_uidx ON public.load_legs (load_id, lower(btrim(driver_raw)));
CREATE INDEX load_legs_load_idx    ON public.load_legs (load_id);
CREATE INDEX load_legs_driver_idx  ON public.load_legs (driver_id);
CREATE INDEX load_legs_truck_idx   ON public.load_legs (truck_id);
CREATE INDEX load_legs_trailer_idx ON public.load_legs (trailer_id);

-- ===== updated_at triggers (reuse existing set_updated_at) =====
CREATE TRIGGER set_updated_at_dispatchers BEFORE UPDATE ON public.dispatchers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at_customers BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at_loads BEFORE UPDATE ON public.loads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at_load_legs BEFORE UPDATE ON public.load_legs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== RLS: match the existing trucks/trailers form EXACTLY =====
-- Verified live: trucks/trailers use four PERMISSIVE per-command policies
-- named auth_<cmd>_<table>, TO public, USING(true) on SELECT/UPDATE/DELETE
-- and WITH CHECK(true) on INSERT — NOT a single FOR ALL policy. Mirrored
-- here. App-layer gated, like the rest of the fleet tables.
ALTER TABLE public.dispatchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.load_legs   ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_select_dispatchers ON public.dispatchers FOR SELECT TO public USING (true);
CREATE POLICY auth_insert_dispatchers ON public.dispatchers FOR INSERT TO public WITH CHECK (true);
CREATE POLICY auth_update_dispatchers ON public.dispatchers FOR UPDATE TO public USING (true);
CREATE POLICY auth_delete_dispatchers ON public.dispatchers FOR DELETE TO public USING (true);

CREATE POLICY auth_select_customers ON public.customers FOR SELECT TO public USING (true);
CREATE POLICY auth_insert_customers ON public.customers FOR INSERT TO public WITH CHECK (true);
CREATE POLICY auth_update_customers ON public.customers FOR UPDATE TO public USING (true);
CREATE POLICY auth_delete_customers ON public.customers FOR DELETE TO public USING (true);

CREATE POLICY auth_select_loads ON public.loads FOR SELECT TO public USING (true);
CREATE POLICY auth_insert_loads ON public.loads FOR INSERT TO public WITH CHECK (true);
CREATE POLICY auth_update_loads ON public.loads FOR UPDATE TO public USING (true);
CREATE POLICY auth_delete_loads ON public.loads FOR DELETE TO public USING (true);

CREATE POLICY auth_select_load_legs ON public.load_legs FOR SELECT TO public USING (true);
CREATE POLICY auth_insert_load_legs ON public.load_legs FOR INSERT TO public WITH CHECK (true);
CREATE POLICY auth_update_load_legs ON public.load_legs FOR UPDATE TO public USING (true);
CREATE POLICY auth_delete_load_legs ON public.load_legs FOR DELETE TO public USING (true);

GRANT ALL ON public.dispatchers TO anon, authenticated, service_role;
GRANT ALL ON public.customers   TO anon, authenticated, service_role;
GRANT ALL ON public.loads       TO anon, authenticated, service_role;
GRANT ALL ON public.load_legs   TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
