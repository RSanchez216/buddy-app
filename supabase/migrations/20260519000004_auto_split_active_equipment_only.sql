-- auto_split_contract_monthly_payment: restrict allocation to active
-- equipment only. Previously the function divided the contract total
-- across every equipment row, so a Totaled or Sold unit kept absorbing
-- its share. Now:
--   * monthly_payment is zeroed on every non-active unit (one row in
--     prod was misallocated — trailer 532353 on contract 083-0012530-000).
--   * The overrides subtraction (v_overridden) only counts overrides on
--     ACTIVE units; an override on a non-active unit can't shrink the
--     pool the active units share.
--   * Only ACTIVE, non-overridden units receive an allocation.
--   * The 1¢ crumb goes on the newest ACTIVE non-overridden row, never
--     a totaled/sold row.
--
-- Edge cases:
--   * All equipment non-active → everything zeroed, function returns;
--     "Allocated $0 of $X ✗" indicator surfaces the issue truthfully.
--   * Exactly one active unit → it gets the full remaining (crumb = 0).
--
-- Status taxonomy (verified via MCP): active / sold / totaled. Only
-- 'active' receives an allocation; anything else is treated as
-- non-paying.

CREATE OR REPLACE FUNCTION public.auto_split_contract_monthly_payment(p_loan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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

  -- Zero out monthly_payment on every non-active unit. Runs regardless of
  -- whether any active units exist so the "Allocated of Total" indicator
  -- stays honest.
  UPDATE public.loan_equipment
  SET monthly_payment = 0
  WHERE loan_id = p_loan_id
    AND current_status <> 'active'
    AND COALESCE(monthly_payment, 0) <> 0;

  -- Sum of overrides on ACTIVE units only — overrides on non-active units
  -- don't belong in the contract total math.
  SELECT COALESCE(SUM(monthly_payment), 0)
    INTO v_overridden
  FROM public.loan_equipment
  WHERE loan_id = p_loan_id
    AND current_status = 'active'
    AND monthly_payment_override = TRUE;

  v_remaining := v_total - v_overridden;

  -- Count of ACTIVE, non-overridden units that will share v_remaining.
  SELECT count(*) INTO v_count
  FROM public.loan_equipment
  WHERE loan_id = p_loan_id
    AND current_status = 'active'
    AND monthly_payment_override = FALSE;

  IF v_count = 0 THEN RETURN; END IF;

  v_per_unit := round(v_remaining / v_count, 2);
  v_crumb    := v_remaining - (v_per_unit * v_count);

  UPDATE public.loan_equipment
  SET monthly_payment = v_per_unit
  WHERE loan_id = p_loan_id
    AND current_status = 'active'
    AND monthly_payment_override = FALSE;

  -- Crumb goes on the newest ACTIVE non-overridden row. Picking globally
  -- newest could land it on a totaled/sold row.
  IF v_crumb <> 0 THEN
    SELECT id INTO v_last_id
    FROM public.loan_equipment
    WHERE loan_id = p_loan_id
      AND current_status = 'active'
      AND monthly_payment_override = FALSE
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    UPDATE public.loan_equipment
    SET monthly_payment = v_per_unit + v_crumb
    WHERE id = v_last_id;
  END IF;
END;
$function$;

NOTIFY pgrst, 'reload schema';
