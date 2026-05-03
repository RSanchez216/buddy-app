-- Merge Loans tool — DB layer.
--
-- Adds:
--   • loan_events.metadata (jsonb) — for arbitrary audit context, used
--     by merge_loan to snapshot the absorbed loan
--   • widens loan_events.event_type CHECK to allow 'loan_merged'
--   • merge_loan(survivor_id, absorbed_id, field_overrides) function —
--     SECURITY DEFINER, gated by is_admin_or_manager(), atomic
--
-- Idempotent: re-running drops/recreates the function and check
-- constraint cleanly; metadata column uses IF NOT EXISTS.

-- ── 1. loan_events: metadata column + widen event_type CHECK ────────────
ALTER TABLE loan_events
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE loan_events
  DROP CONSTRAINT IF EXISTS loan_events_event_type_check;

ALTER TABLE loan_events
  ADD CONSTRAINT loan_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'paydown',
    'restructure',
    'rate_change',
    'balance_correction',
    'transfer',
    'note',
    'loan_merged'
  ]));

-- ── 2. merge_loan() ─────────────────────────────────────────────────────
-- Three things this function MUST get right:
--   (a) atomicity — every reparent + delete + audit insert succeeds
--       together, or none of them do (single transaction)
--   (b) auth — only admins/managers; the SECURITY DEFINER wrapper
--       lets us bypass RLS only after that gate has passed
--   (c) audit — the absorbed loan is jsonb-snapshotted on the survivor
--       BEFORE the DELETE runs, so a future reader can always reconstruct
--       what was merged
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
  v_user_id      uuid;
  v_absorbed     jsonb;
  v_eq_count     int;
  v_pay_count    int;
  v_doc_count    int;
  v_event_count  int;
  v_dp_count     int;
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

  -- Snapshot absorbed loan for the audit trail before we touch anything.
  SELECT to_jsonb(l) INTO v_absorbed FROM loans l WHERE id = p_absorbed_id;

  SELECT count(*) INTO v_eq_count    FROM loan_equipment   WHERE loan_id            = p_absorbed_id;
  SELECT count(*) INTO v_pay_count   FROM loan_payments    WHERE loan_id            = p_absorbed_id;
  SELECT count(*) INTO v_doc_count   FROM loan_documents   WHERE loan_id            = p_absorbed_id;
  SELECT count(*) INTO v_event_count FROM loan_events      WHERE loan_id            = p_absorbed_id;
  SELECT count(*) INTO v_dp_count    FROM driver_purchases WHERE underlying_loan_id = p_absorbed_id;

  -- Apply field-level overrides where the user picked the absorbed value.
  -- Each branch tests jsonb '?' before reading, so an override of '' /
  -- null / missing key all leave the survivor's value alone. Unknown
  -- keys in p_field_overrides are silently ignored.
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

  -- Re-parent every related row from absorbed → survivor.
  UPDATE loan_equipment   SET loan_id            = p_survivor_id WHERE loan_id            = p_absorbed_id;
  UPDATE loan_payments    SET loan_id            = p_survivor_id WHERE loan_id            = p_absorbed_id;
  UPDATE loan_documents   SET loan_id            = p_survivor_id WHERE loan_id            = p_absorbed_id;
  UPDATE loan_events      SET loan_id            = p_survivor_id WHERE loan_id            = p_absorbed_id;
  UPDATE driver_purchases SET underlying_loan_id = p_survivor_id WHERE underlying_loan_id = p_absorbed_id;

  -- Audit event on the survivor (BEFORE deleting the absorbed row, so
  -- if anything below fails we don't ship a half-merged state).
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
      'merged_payment_count',         v_pay_count,
      'merged_document_count',        v_doc_count,
      'merged_event_count',           v_event_count,
      'merged_driver_purchase_count', v_dp_count,
      'field_overrides',              p_field_overrides
    ),
    v_user_id,
    now()
  );

  -- Final step: delete the absorbed row. By now nothing references it.
  DELETE FROM loans WHERE id = p_absorbed_id;

  -- Refresh derived health state. refresh_loan_health() is the existing
  -- public function (used by daily_loan_health_check) and it's
  -- idempotent + cheap.
  PERFORM refresh_loan_health();
END;
$$;

GRANT EXECUTE ON FUNCTION merge_loan(uuid, uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION merge_loan(uuid, uuid, jsonb) IS
  'Merge two loan rows: re-parent equipment/payments/documents/events/driver_purchases from absorbed to survivor, apply optional field overrides on survivor, write a loan_merged audit event with the absorbed snapshot, then delete absorbed. Atomic, admins/managers only.';
