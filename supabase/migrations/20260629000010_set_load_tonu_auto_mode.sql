-- set_load_tonu: add an opt-out "auto-confirm" mode.
--
-- The Loads Import TONU panel is now opt-out: same-city <$500 candidates are
-- pre-selected as TONU and any left untouched are confirmed as TONU on Apply.
-- An auto-confirm must set is_tonu = true WITHOUT stamping a reviewer, so the
-- audit signal "a human actually judged this load" (tonu_reviewed_by IS NOT
-- NULL) stays truthful and the heuristic's real precision can still be measured.
--
-- p_auto = false (default) preserves the prior behaviour exactly, so existing
-- 2-arg callers are unaffected:
--   * explicit true/false  -> stamp tonu_reviewed_by = auth.uid(), reviewed_at = now()
--   * NULL                 -> clear is_tonu + reviewer (unclassify)
-- p_auto = true is the auto path:
--   * set is_tonu WITHOUT a reviewer, and ONLY for still-unclassified loads
--     (is_tonu IS NULL) so a prior human decision is never overwritten. A
--     no-op (already classified / missing load) returns no rows rather than
--     raising.
--
-- Drop the prior 2-arg overload first: adding a defaulted 3rd param otherwise
-- leaves two functions, and a 2-arg call would be ambiguous to PostgREST.
DROP FUNCTION IF EXISTS public.set_load_tonu(text, boolean);

CREATE OR REPLACE FUNCTION public.set_load_tonu(
  p_load_number text,
  p_is_tonu boolean,
  p_auto boolean DEFAULT false
)
RETURNS TABLE(load_number text, is_tonu boolean, tonu_reviewed_by uuid, tonu_reviewed_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_manager() THEN
    RAISE EXCEPTION 'not authorized: admin or manager required';
  END IF;

  IF p_auto THEN
    -- Auto-confirm the pre-selected default: no reviewer stamp, and only touch
    -- loads that are still unclassified so we can never flip a prior decision.
    RETURN QUERY
    UPDATE public.loads l
       SET is_tonu          = p_is_tonu,
           tonu_reviewed_by = NULL,
           tonu_reviewed_at = NULL
     WHERE l.load_number = p_load_number
       AND l.is_tonu IS NULL
    RETURNING l.load_number, l.is_tonu, l.tonu_reviewed_by, l.tonu_reviewed_at;
    RETURN; -- silent no-op if already classified or missing
  END IF;

  -- Explicit human decision (unchanged from the original definition).
  RETURN QUERY
  UPDATE public.loads l
     SET is_tonu          = p_is_tonu,
         tonu_reviewed_by = CASE WHEN p_is_tonu IS NULL THEN NULL ELSE auth.uid() END,
         tonu_reviewed_at = CASE WHEN p_is_tonu IS NULL THEN NULL ELSE now() END
   WHERE l.load_number = p_load_number
  RETURNING l.load_number, l.is_tonu, l.tonu_reviewed_by, l.tonu_reviewed_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'load % not found', p_load_number;
  END IF;
END;
$function$;
