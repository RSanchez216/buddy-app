-- Drivers master foundation (PR 3)
--
-- Extends the existing drivers table with operational fields needed for the
-- weekly TMS upload (driver_type, compensation, carrier, assignments,
-- lifecycle, etc.) and adds an append-only driver_status_history table
-- mirroring equipment_ownership_history.
--
-- Pre-step consolidates a duplicate "Odalien Odalus" row that blocked the
-- UNIQUE(internal_id) constraint. The duplicate had 1 driver_purchase ref
-- which is repointed to the surviving row before deletion.
--
-- driver_status_history uses open RLS (USING true) per project convention
-- for new fleet-domain tables; the existing role-restricted policies on
-- drivers itself are intentionally NOT modified.

-- ── 0. Pre-step: consolidate duplicate Odalien Odalus (internal_id=1269) ──
UPDATE public.driver_purchases
SET driver_id = 'a66df026-cdd5-4e39-a502-42fc3e2d8ee0'
WHERE driver_id = '1d845797-d140-4cc6-8f7e-7fa24db821d5';

DELETE FROM public.drivers
WHERE id = '1d845797-d140-4cc6-8f7e-7fa24db821d5';

-- ── 1. Extend drivers with new columns ───────────────────────────────────
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS driver_type              text
    CHECK (driver_type IS NULL OR driver_type IN (
      'Owner Operator', 'Leased Owner-Op', 'Contract Driver', 'Company Driver'
    )),
  ADD COLUMN IF NOT EXISTS compensation_raw         text,
  ADD COLUMN IF NOT EXISTS compensation_type        text
    CHECK (compensation_type IS NULL OR compensation_type IN (
      'service_charge_pct', 'rate_pct', 'rate_per_mile'
    )),
  ADD COLUMN IF NOT EXISTS compensation_value       numeric(10,4),
  ADD COLUMN IF NOT EXISTS carrier                  text,
  ADD COLUMN IF NOT EXISTS truck_assignment_raw     text,
  ADD COLUMN IF NOT EXISTS trailer_assignment_raw   text,
  ADD COLUMN IF NOT EXISTS referred_by              text,
  ADD COLUMN IF NOT EXISTS temporary_license        boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS missing_op               text,
  ADD COLUMN IF NOT EXISTS onboarded_at             date,
  ADD COLUMN IF NOT EXISTS current_status           text NOT NULL DEFAULT 'active'
    CHECK (current_status IN (
      'active', 'inactive', 'on_leave', 'terminated', 'archived'
    )),
  ADD COLUMN IF NOT EXISTS status_changed_at        timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS terminated_at            date,
  ADD COLUMN IF NOT EXISTS termination_reason       text,
  ADD COLUMN IF NOT EXISTS last_seen_in_upload_at   timestamptz,
  ADD COLUMN IF NOT EXISTS created_by               uuid REFERENCES public.users(id);

-- ── 2. UNIQUE constraint on internal_id ──────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_internal_id_unique
  ON public.drivers(internal_id)
  WHERE internal_id IS NOT NULL;

-- Drop redundant non-unique index — superseded by the unique partial index
-- above. Eliminates 2× write cost on every driver insert/update.
DROP INDEX IF EXISTS public.idx_drivers_internal_id;

-- ── 3. Other new indexes ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_drivers_current_status     ON public.drivers(current_status);
CREATE INDEX IF NOT EXISTS idx_drivers_driver_type        ON public.drivers(driver_type);
CREATE INDEX IF NOT EXISTS idx_drivers_carrier            ON public.drivers(carrier);
CREATE INDEX IF NOT EXISTS idx_drivers_last_seen_upload   ON public.drivers(last_seen_in_upload_at);

-- ── 4. New driver_status_history table (append-only, open RLS) ───────────
CREATE TABLE public.driver_status_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id           uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  from_status         text,
  to_status           text NOT NULL,
  reason              text,
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES public.users(id)
);

CREATE INDEX idx_driver_status_history_driver_id    ON public.driver_status_history(driver_id);
CREATE INDEX idx_driver_status_history_occurred_at  ON public.driver_status_history(occurred_at DESC);

ALTER TABLE public.driver_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_select_dsh ON public.driver_status_history FOR SELECT USING (true);
CREATE POLICY auth_insert_dsh ON public.driver_status_history FOR INSERT WITH CHECK (true);
-- Append-only: no UPDATE / DELETE policies.

-- ── 5. Backfill: one generic 'Initial' history row per surviving driver ──
INSERT INTO public.driver_status_history (driver_id, from_status, to_status, reason)
SELECT id, NULL, 'active', 'Backfilled at drivers-master migration'
FROM public.drivers;

-- ── 6. Specific consolidation audit event for a66df026 ───────────────────
INSERT INTO public.driver_status_history (driver_id, from_status, to_status, reason)
VALUES (
  'a66df026-cdd5-4e39-a502-42fc3e2d8ee0',
  NULL,
  'active',
  'Consolidated duplicate driver record (was: 1d845797-d140-4cc6-8f7e-7fa24db821d5)'
);
