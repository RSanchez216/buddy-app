-- Fleet Inventory foundation (PR 1)
--
-- Adds two new master tables (trucks, trailers) plus an audit table for
-- ownership-stage transitions. Extends loan_equipment with a per-unit
-- monthly_payment + override flag; loans.monthly_payment (existing) serves
-- as the contract total source of truth.
--
-- driver_purchase_id is added as a plain uuid column (NO FK) on trucks /
-- trailers / equipment_ownership_history — wiring deferred to PR 4.
--
-- RLS follows the schema convention: open-to-authenticated. The app layer
-- (canEdit / isAdmin) enforces role gating.

CREATE TABLE public.trucks (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_number                     text NOT NULL,
  vin                             text NOT NULL UNIQUE,
  status                          text,
  equipment_owner_raw             text,
  ownership_stage                 text NOT NULL DEFAULT 'unclassified'
                                  CHECK (ownership_stage IN (
                                    'unclassified','company_owned','company_leased',
                                    'driver_purchase_in_progress','driver_owned','archived'
                                  )),
  ownership_stage_started_at      timestamptz NOT NULL DEFAULT now(),
  driver_id                       uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  driver_assignment_raw           text,
  carrier                         text,
  year                            integer,
  make                            text,
  model                           text,
  license_plate                   text,
  license_state                   text,
  transponder                     text,
  lessee                          text,
  loan_equipment_id               uuid REFERENCES public.loan_equipment(id) ON DELETE SET NULL,
  driver_purchase_id              uuid,
  notes                           text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  created_by                      uuid REFERENCES public.users(id),
  updated_by                      uuid REFERENCES public.users(id)
);

CREATE INDEX idx_trucks_vin                   ON public.trucks(vin);
CREATE INDEX idx_trucks_unit_number           ON public.trucks(unit_number);
CREATE INDEX idx_trucks_ownership_stage       ON public.trucks(ownership_stage);
CREATE INDEX idx_trucks_driver_id             ON public.trucks(driver_id);
CREATE INDEX idx_trucks_loan_equipment_id     ON public.trucks(loan_equipment_id);

CREATE TABLE public.trailers (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_number                     text NOT NULL,
  vin                             text NOT NULL UNIQUE,
  status                          text,
  equipment_owner_raw             text,
  ownership_stage                 text NOT NULL DEFAULT 'unclassified'
                                  CHECK (ownership_stage IN (
                                    'unclassified','company_owned','company_leased',
                                    'driver_purchase_in_progress','driver_owned','archived'
                                  )),
  ownership_stage_started_at      timestamptz NOT NULL DEFAULT now(),
  driver_id                       uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  driver_assignment_raw           text,
  carrier                         text,
  year                            integer,
  make                            text,
  model                           text,
  license_plate                   text,
  license_state                   text,
  transponder                     text,
  lessee                          text,
  loan_equipment_id               uuid REFERENCES public.loan_equipment(id) ON DELETE SET NULL,
  driver_purchase_id              uuid,
  trailer_type                    text
                                  CHECK (trailer_type IS NULL OR trailer_type IN (
                                    'Dry Van','Reefer','Flatbed','Step Deck','Conestoga','Other'
                                  )),
  annual_inspection_expiration_date date,
  notes                           text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  created_by                      uuid REFERENCES public.users(id),
  updated_by                      uuid REFERENCES public.users(id)
);

CREATE INDEX idx_trailers_vin                 ON public.trailers(vin);
CREATE INDEX idx_trailers_unit_number         ON public.trailers(unit_number);
CREATE INDEX idx_trailers_ownership_stage     ON public.trailers(ownership_stage);
CREATE INDEX idx_trailers_driver_id           ON public.trailers(driver_id);
CREATE INDEX idx_trailers_loan_equipment_id   ON public.trailers(loan_equipment_id);

CREATE TABLE public.equipment_ownership_history (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_type                  text NOT NULL CHECK (equipment_type IN ('truck','trailer')),
  truck_id                        uuid REFERENCES public.trucks(id)   ON DELETE CASCADE,
  trailer_id                      uuid REFERENCES public.trailers(id) ON DELETE CASCADE,
  from_stage                      text,
  to_stage                        text NOT NULL,
  driver_id                       uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  driver_purchase_id              uuid,
  reason                          text,
  occurred_at                     timestamptz NOT NULL DEFAULT now(),
  created_at                      timestamptz NOT NULL DEFAULT now(),
  created_by                      uuid REFERENCES public.users(id),
  CHECK (
    (equipment_type = 'truck'   AND truck_id   IS NOT NULL AND trailer_id IS NULL) OR
    (equipment_type = 'trailer' AND trailer_id IS NOT NULL AND truck_id   IS NULL)
  )
);

CREATE INDEX idx_eqoh_truck_id      ON public.equipment_ownership_history(truck_id);
CREATE INDEX idx_eqoh_trailer_id    ON public.equipment_ownership_history(trailer_id);
CREATE INDEX idx_eqoh_occurred_at   ON public.equipment_ownership_history(occurred_at DESC);

-- Per-unit monthly payment on loan_equipment. The contract total lives in
-- loans.monthly_payment (already exists). Auto-split reads loans.monthly_payment
-- and writes to loan_equipment.monthly_payment for rows where override=false.
ALTER TABLE public.loan_equipment
  ADD COLUMN monthly_payment           numeric(10,2),
  ADD COLUMN monthly_payment_override  boolean NOT NULL DEFAULT false;

CREATE INDEX idx_loan_equipment_override_false
  ON public.loan_equipment (loan_id)
  WHERE monthly_payment_override = false;

-- Auto-split: subtract overridden rows' total from contract total, divide the
-- remainder evenly across non-overridden rows. Rounding crumb lands on the
-- most-recently-created non-overridden row so the sum matches exactly.
CREATE OR REPLACE FUNCTION public.auto_split_contract_monthly_payment(p_loan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total      numeric(10,2);
  v_overridden numeric(10,2);
  v_remaining  numeric(10,2);
  v_count      integer;
  v_per_unit   numeric(10,2);
  v_crumb      numeric(10,2);
  v_last_id    uuid;
BEGIN
  SELECT monthly_payment INTO v_total
  FROM public.loans
  WHERE id = p_loan_id;

  IF v_total IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(monthly_payment), 0)
    INTO v_overridden
  FROM public.loan_equipment
  WHERE loan_id = p_loan_id AND monthly_payment_override = TRUE;

  v_remaining := v_total - v_overridden;

  SELECT count(*) INTO v_count
  FROM public.loan_equipment
  WHERE loan_id = p_loan_id AND monthly_payment_override = FALSE;

  IF v_count = 0 THEN RETURN; END IF;

  v_per_unit := round(v_remaining / v_count, 2);
  v_crumb    := v_remaining - (v_per_unit * v_count);

  UPDATE public.loan_equipment
  SET monthly_payment = v_per_unit
  WHERE loan_id = p_loan_id AND monthly_payment_override = FALSE;

  IF v_crumb <> 0 THEN
    SELECT id INTO v_last_id
    FROM public.loan_equipment
    WHERE loan_id = p_loan_id AND monthly_payment_override = FALSE
    ORDER BY created_at DESC, id DESC
    LIMIT 1;
    UPDATE public.loan_equipment
    SET monthly_payment = v_per_unit + v_crumb
    WHERE id = v_last_id;
  END IF;
END;
$$;

ALTER FUNCTION public.auto_split_contract_monthly_payment(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.auto_split_contract_monthly_payment(uuid) TO authenticated;

CREATE TRIGGER trucks_set_updated_at
  BEFORE UPDATE ON public.trucks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trailers_set_updated_at
  BEFORE UPDATE ON public.trailers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.trucks                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trailers                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_ownership_history  ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_select_trucks ON public.trucks FOR SELECT USING (true);
CREATE POLICY auth_insert_trucks ON public.trucks FOR INSERT WITH CHECK (true);
CREATE POLICY auth_update_trucks ON public.trucks FOR UPDATE USING (true);
CREATE POLICY auth_delete_trucks ON public.trucks FOR DELETE USING (true);

CREATE POLICY auth_select_trailers ON public.trailers FOR SELECT USING (true);
CREATE POLICY auth_insert_trailers ON public.trailers FOR INSERT WITH CHECK (true);
CREATE POLICY auth_update_trailers ON public.trailers FOR UPDATE USING (true);
CREATE POLICY auth_delete_trailers ON public.trailers FOR DELETE USING (true);

-- History is append-only (SELECT + INSERT only; no UPDATE/DELETE policies).
CREATE POLICY auth_select_eqoh ON public.equipment_ownership_history FOR SELECT USING (true);
CREATE POLICY auth_insert_eqoh ON public.equipment_ownership_history FOR INSERT WITH CHECK (true);
