-- equipment_assignments: weekly TMS assignment-history ingest for trucks + trailers.
-- One row = one (equipment, driver, start_date) event. End_date NULL = currently active.
-- Unified table with equipment_type discriminator + partial FKs (truck_id XOR trailer_id).

CREATE TABLE IF NOT EXISTS public.equipment_assignments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_type      text NOT NULL CHECK (equipment_type IN ('truck','trailer')),
  truck_id            uuid REFERENCES public.trucks(id),
  trailer_id          uuid REFERENCES public.trailers(id),
  tms_equipment_id    bigint,
  equipment_name_raw  text NOT NULL,
  driver_id           uuid REFERENCES public.drivers(id),
  tms_driver_id       text,
  driver_name_raw     text,
  start_date          date NOT NULL,
  end_date            date,
  created_by_raw      text,
  source              text NOT NULL DEFAULT 'tms_upload',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES public.users(id),
  updated_by          uuid REFERENCES public.users(id),
  CONSTRAINT eq_assign_type_fk CHECK (
    (equipment_type = 'truck'   AND trailer_id IS NULL) OR
    (equipment_type = 'trailer' AND truck_id   IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_equipment_assignments_natkey
  ON public.equipment_assignments (equipment_type, tms_equipment_id, tms_driver_id, start_date);

CREATE INDEX IF NOT EXISTS ix_eq_assign_truck   ON public.equipment_assignments (truck_id)   WHERE truck_id   IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_eq_assign_trailer ON public.equipment_assignments (trailer_id) WHERE trailer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_eq_assign_driver  ON public.equipment_assignments (driver_id)  WHERE driver_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_eq_assign_open    ON public.equipment_assignments (equipment_type, end_date) WHERE end_date IS NULL;

ALTER TABLE public.equipment_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS equipment_assignments_all ON public.equipment_assignments;
CREATE POLICY equipment_assignments_all ON public.equipment_assignments
  FOR ALL USING (true) WITH CHECK (true);

-- Propagates the current (open) assignment to trucks/trailers.driver_id.
-- Called once at the end of an assignments-upload commit.
CREATE OR REPLACE FUNCTION public.resolve_current_equipment_drivers()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.trucks t
     SET driver_id = a.driver_id, updated_at = now()
    FROM public.equipment_assignments a
   WHERE a.equipment_type = 'truck'
     AND a.truck_id = t.id
     AND a.end_date IS NULL
     AND a.driver_id IS NOT NULL
     AND t.driver_id IS DISTINCT FROM a.driver_id;

  UPDATE public.trailers t
     SET driver_id = a.driver_id, updated_at = now()
    FROM public.equipment_assignments a
   WHERE a.equipment_type = 'trailer'
     AND a.trailer_id = t.id
     AND a.end_date IS NULL
     AND a.driver_id IS NOT NULL
     AND t.driver_id IS DISTINCT FROM a.driver_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.resolve_current_equipment_drivers() TO authenticated;

NOTIFY pgrst, 'reload schema';
