-- set_load_tonu: let the auto-confirm path re-flag a load that already has
-- is_tonu set but was never HUMAN-reviewed.
--
-- Before, the p_auto path only touched loads with is_tonu IS NULL. That broke
-- TONU detection on the UPDATE path: a load first imported live (is_tonu NULL)
-- and later rewritten by TMS as a same-city fee could get auto-classified once,
-- but any subsequent re-import — or a load reset to is_tonu = false — could
-- never be (re-)flagged, because it was no longer NULL. The load then kept
-- dragging down rate metrics and stayed a Combined Loads candidate.
--
-- The true "a human decided, leave it alone" signal is tonu_reviewed_by IS NOT
-- NULL, not is_tonu IS NOT NULL. Guard the auto path on that instead:
--   * auto-confirm updates any load NOT human-reviewed — is_tonu NULL, a prior
--     auto-set value, or a non-reviewed false — and sets it WITHOUT a reviewer
--     stamp (audit signal stays truthful), and
--   * a load a human explicitly judged (Real or TONU, tonu_reviewed_by set) is
--     still never overwritten by the heuristic.
-- The explicit (non-auto) path is unchanged: it always writes and stamps the
-- reviewer, so marking a row Real on a re-import sets is_tonu = false and makes
-- the decision sticky thereafter.
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
    -- loads a human hasn't judged so we can never flip an explicit decision.
    RETURN QUERY
    UPDATE public.loads l
       SET is_tonu          = p_is_tonu,
           tonu_reviewed_by = NULL,
           tonu_reviewed_at = NULL
     WHERE l.load_number = p_load_number
       AND l.tonu_reviewed_by IS NULL
    RETURNING l.load_number, l.is_tonu, l.tonu_reviewed_by, l.tonu_reviewed_at;
    RETURN; -- silent no-op if human-reviewed or missing
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
