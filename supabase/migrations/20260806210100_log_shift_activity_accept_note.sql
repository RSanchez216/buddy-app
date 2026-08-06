-- log_shift_activity: accept 'note'.
--
-- shift_activities.activity_type's CHECK constraint has always allowed 'note',
-- and ShiftBoardPage already carries a `note: 'Note added'` label — but all
-- three log_shift_activity overloads whitelist seven types and 'note' is not
-- among them, so every attempt returns { ok:false, reason:'unknown activity
-- type' } and the client wrapper throws. The type was reachable in the table
-- and unreachable through the only supported write path.
--
-- The alternative was inserting into shift_activities directly from the client,
-- which the data layer explicitly forbids ("NEVER insert shift_activities
-- directly") — and for good reason: the RPC resolves the caller's open shift,
-- stamps user_id from auth.uid(), and looks up load_number. Bypassing it would
-- have to reimplement all three client-side.
--
-- WHY THIS IS A DO BLOCK AND NOT THREE CREATE OR REPLACE STATEMENTS.
-- The three overloads differ only in arity; their bodies are long (the 6-arg one
-- fans notifications out over @mentions) and only ONE LINE needs to change in
-- each. Retyping the bodies to reissue them risks silently dropping a statement
-- — the change would still apply cleanly and the damage would only show up at
-- runtime. Patching pg_get_functiondef output guarantees every byte except the
-- guard survives, and the raise below fails the migration loudly if the guard
-- ever stops matching rather than leaving a half-updated set behind.
--
-- All three are updated together: they share the identical guard, and leaving
-- two rejecting a type the third accepts is a trap for the next caller. Purely
-- additive — no existing type's behaviour moves.

do $do$
declare
  r record;
  newdef text;
  patched int := 0;
  old_guard constant text := '''escalated'',''rescan_requested'') then';
  new_guard constant text := '''escalated'',''rescan_requested'',''note'') then';
begin
  for r in
    select oid, pg_get_functiondef(oid) as def
    from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'log_shift_activity'
  loop
    if position(new_guard in r.def) > 0 then
      continue; -- already accepts 'note'; re-running this migration is a no-op
    end if;
    if position(old_guard in r.def) = 0 then
      raise exception 'log_shift_activity(oid %) has an unrecognised activity-type guard; refusing to patch blindly', r.oid;
    end if;
    newdef := replace(r.def, old_guard, new_guard);
    execute newdef;
    patched := patched + 1;
  end loop;

  raise notice 'log_shift_activity: % overload(s) patched to accept ''note''', patched;
end
$do$;

-- Fail the migration if any overload still rejects 'note'.
do $check$
declare bad int;
begin
  select count(*) into bad
  from pg_proc
  where pronamespace = 'public'::regnamespace and proname = 'log_shift_activity'
    and position('''rescan_requested'',''note'')' in pg_get_functiondef(oid)) = 0;
  if bad > 0 then
    raise exception '% log_shift_activity overload(s) still reject ''note''', bad;
  end if;
end
$check$;
