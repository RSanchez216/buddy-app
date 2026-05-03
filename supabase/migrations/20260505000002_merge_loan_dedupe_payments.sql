-- Merge Loans tool — handle unique-constraint collisions on loan_payments.
--
-- Background: when both loans were imported from the same upstream
-- record, both have identical payment schedules generated against
-- (loan_id, due_month). Re-parenting absorbed → survivor blew up on
-- the unique constraint loan_payments_loan_id_due_month_key.
--
-- Audit (via pg_constraint + pg_index, run before writing this file):
-- only loan_payments has a unique constraint involving loan_id —
-- (loan_id, due_month). loan_equipment / loan_documents / loan_events /
-- driver_purchases have no such constraint, so they can re-parent
-- naively as before.
--
-- Strategy: for loan_payments, DELETE absorbed-side rows that would
-- collide with an existing survivor row (the survivor's row is the
-- canonical one — we keep it and its payment status). Then re-parent
-- whatever remains. The skipped count goes into the audit metadata.

CREATE OR REPLACE FUNCTION merge_loan(
  p_survivor_id uuid,
  p_absorbed_id uuid,
  p_field_overrides jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id           uuid;
  v_absorbed          jsonb;
  v_eq_count          int;
  v_pay_count         int;
  v_doc_count         int;
  v_event_count       int;
  v_dp_count          int;
  v_skipped_payments  int;
BEGIN
  v_user_id := auth.uid();
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Only admins or managers can merge loans';
  END IF;

  IF p_survivor_id = p_absorbed_id THEN
    RAISE EXCEPTION 'Cannot merge a loan with itself';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM loans WHERE id = p_survivor_id) THEN
    RAISE EXCEPTION 'Survivor loan not found: %', p_survivor_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM loans WHERE id = p_absorbed_id) THEN
    RAISE EXCEPTION 'Absorbed loan not found: %', p_absorbed_id;
  END IF;

  SELECT to_jsonb(l) INTO v_absorbed FROM loans l WHERE id = p_absorbed_id;

  SELECT count(*) INTO v_eq_count    FROM loan_equipment   WHERE loan_id            = p_absorbed_id;
  SELECT count(*) INTO v_pay_count   FROM loan_payments    WHERE loan_id            = p_absorbed_id;
  SELECT count(*) INTO v_doc_count   FROM loan_documents   WHERE loan_id            = p_absorbed_id;
  SELECT count(*) INTO v_event_count FROM loan_events      WHERE loan_id            = p_absorbed_id;
  SELECT count(*) INTO v_dp_count    FROM driver_purchases WHERE underlying_loan_id = p_absorbed_id;

  -- Field overrides on the survivor
  UPDATE loans SET
    loan_id_external     = CASE WHEN p_field_overrides ? 'loan_id_external'     THEN p_field_overrides->>'loan_id_external'              ELSE loan_id_external     END,
    task_name            = CASE WHEN p_field_overrides ? 'task_name'            THEN p_field_overrides->>'task_name'                     ELSE task_name            END,
    contract_number      = CASE WHEN p_field_overrides ? 'contract_number'      THEN p_field_overrides->>'contract_number'               ELSE contract_number      END,
    entity_id            = CASE WHEN p_field_overrides ? 'entity_id'            THEN (p_field_overrides->>'entity_id')::uuid             ELSE entity_id            END,
    lender_id            = CASE WHEN p_field_overrides ? 'lender_id'            THEN (p_field_overrides->>'lender_id')::uuid             ELSE lender_id            END,
    funding_account_id   = CASE WHEN p_field_overrides ? 'funding_account_id'   THEN (p_field_overrides->>'funding_account_id')::uuid    ELSE funding_account_id   END,
    loan_amount          = CASE WHEN p_field_overrides ? 'loan_amount'          THEN (p_field_overrides->>'loan_amount')::numeric        ELSE loan_amount          END,
    current_balance      = CASE WHEN p_field_overrides ? 'current_balance'      THEN (p_field_overrides->>'current_balance')::numeric    ELSE current_balance      END,
    interest_rate        = CASE WHEN p_field_overrides ? 'interest_rate'        THEN (p_field_overrides->>'interest_rate')::numeric      ELSE interest_rate        END,
    monthly_payment      = CASE WHEN p_field_overrides ? 'monthly_payment'      THEN (p_field_overrides->>'monthly_payment')::numeric    ELSE monthly_payment      END,
    due_day              = CASE WHEN p_field_overrides ? 'due_day'              THEN (p_field_overrides->>'due_day')::int                ELSE due_day              END,
    autopay              = CASE WHEN p_field_overrides ? 'autopay'              THEN (p_field_overrides->>'autopay')::boolean            ELSE autopay              END,
    start_date           = CASE WHEN p_field_overrides ? 'start_date'           THEN (p_field_overrides->>'start_date')::date            ELSE start_date           END,
    first_payment_date   = CASE WHEN p_field_overrides ? 'first_payment_date'   THEN (p_field_overrides->>'first_payment_date')::date    ELSE first_payment_date   END,
    maturity_date        = CASE WHEN p_field_overrides ? 'maturity_date'        THEN (p_field_overrides->>'maturity_date')::date         ELSE maturity_date        END,
    status               = CASE WHEN p_field_overrides ? 'status'               THEN p_field_overrides->>'status'                        ELSE status               END,
    description          = CASE WHEN p_field_overrides ? 'description'          THEN p_field_overrides->>'description'                   ELSE description          END,
    payment_status_notes = CASE WHEN p_field_overrides ? 'payment_status_notes' THEN p_field_overrides->>'payment_status_notes'          ELSE payment_status_notes END,
    cfo_flag             = CASE WHEN p_field_overrides ? 'cfo_flag'             THEN (p_field_overrides->>'cfo_flag')::boolean           ELSE cfo_flag             END,
    updated_at           = now()
  WHERE id = p_survivor_id;

  -- Re-parent: tables without unique constraints involving loan_id
  UPDATE loan_equipment   SET loan_id            = p_survivor_id WHERE loan_id            = p_absorbed_id;
  UPDATE loan_documents   SET loan_id            = p_survivor_id WHERE loan_id            = p_absorbed_id;
  UPDATE loan_events      SET loan_id            = p_survivor_id WHERE loan_id            = p_absorbed_id;
  UPDATE driver_purchases SET underlying_loan_id = p_survivor_id WHERE underlying_loan_id = p_absorbed_id;

  -- loan_payments has UNIQUE (loan_id, due_month). Drop absorbed rows
  -- whose due_month already exists on the survivor (survivor's row is
  -- canonical), then re-parent the rest. Doing this as a single
  -- DELETE-RETURNING captures the skipped count for the audit trail.
  WITH conflicts AS (
    DELETE FROM loan_payments
    WHERE loan_id = p_absorbed_id
      AND due_month IN (
        SELECT due_month FROM loan_payments WHERE loan_id = p_survivor_id
      )
    RETURNING id
  )
  SELECT count(*) INTO v_skipped_payments FROM conflicts;

  UPDATE loan_payments SET loan_id = p_survivor_id WHERE loan_id = p_absorbed_id;

  -- Audit event on the survivor (BEFORE deleting absorbed)
  INSERT INTO loan_events (loan_id, event_date, event_type, description, metadata, created_by, created_at)
  VALUES (
    p_survivor_id,
    CURRENT_DATE,
    'loan_merged',
    'Merged loan ' || COALESCE(v_absorbed->>'loan_id_external', v_absorbed->>'contract_number', p_absorbed_id::text)
                   || ' into this record',
    jsonb_build_object(
      'absorbed_loan_id',             p_absorbed_id,
      'absorbed_snapshot',            v_absorbed,
      'merged_equipment_count',       v_eq_count,
      'merged_payment_count',         v_pay_count - v_skipped_payments,
      'skipped_duplicate_payments',   v_skipped_payments,
      'merged_document_count',        v_doc_count,
      'merged_event_count',           v_event_count,
      'merged_driver_purchase_count', v_dp_count,
      'field_overrides',              p_field_overrides
    ),
    v_user_id,
    now()
  );

  DELETE FROM loans WHERE id = p_absorbed_id;
  PERFORM refresh_loan_health();
END;
$$;

GRANT EXECUTE ON FUNCTION merge_loan(uuid, uuid, jsonb) TO authenticated;
