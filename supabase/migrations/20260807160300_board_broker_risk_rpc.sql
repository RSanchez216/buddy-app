-- Batched read path for v_load_broker_risk.
--
-- NOT IN THE ORIGINAL MIGRATION LIST — added because the brief requires the view
-- to be read in one batch keyed by load_id ("do not fetch it per row"), and
-- PostgREST cannot express that against a view without putting ~130 UUIDs into a
-- GET query string. This takes them in a POST body instead.
--
-- WHY NOT A *_for_shift VARIANT, like the broker/risk/idle metas. Those each
-- call after_hours_board(p_shift_id) internally so they can fire in parallel with
-- the board — meaning that query, which measures ~2.7s, already runs four times
-- per page load. Measured here: the view over 200 loads is 7.8ms, entirely index
-- scans. Adding a fifth execution of a 2.7s query to save one ~8ms round trip is
-- the wrong trade, so this takes the ids the board has already returned.
--
-- Returns `setof v_load_broker_risk`: typed rows, not jsonb. That is the whole
-- point of the view — a boolean column is true or false, never absent — and
-- wrapping it in a jsonb payload would hand back exactly the shape that caused
-- the 1,204-load mislabelling.
--
-- SECURITY INVOKER (the default) on purpose: the view is declared
-- security_invoker = true, and running this as DEFINER would substitute the
-- owner's permissions and make that declaration meaningless.

-- The earlier shift-scoped form is dropped; it duplicated the board query.
drop function if exists public.after_hours_board_broker_risk_for_shift(uuid);

create or replace function public.after_hours_board_broker_risk(p_load_ids uuid[])
returns setof public.v_load_broker_risk
language sql
stable
set search_path to 'public'
as $function$
  select v.*
  from public.v_load_broker_risk v
  where v.load_id = any(p_load_ids);
$function$;

revoke all on function public.after_hours_board_broker_risk(uuid[]) from anon, public;
grant execute on function public.after_hours_board_broker_risk(uuid[]) to authenticated;
