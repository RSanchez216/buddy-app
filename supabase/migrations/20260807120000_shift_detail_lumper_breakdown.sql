-- after_hours_shift_detail: expose the individual lumper events, not just a count
-- and a sum.
--
-- THE BUG THIS FIXES IS A REPORTING ONE, NOT A STORAGE ONE. The shift's lumper
-- window is `created_at between started_at and coalesce(ended_at, now())` — it
-- matches on TIME, not on actor. Verified on prod: every lumper credited to the
-- Aug 5 Shift 1 and Aug 4 Shift 2 rows was entered by somebody who was not the
-- associate on shift, during normal business hours the following morning
-- (Meerim Rakhmanova and Altyn Berdimatov respectively).
--
-- The window is deliberately UNCHANGED — those events are still real context for
-- what happened on that shift's loads. What changes is that the report can now
-- say plainly who entered each one, by splitting on `by_associate`.
--
-- Two amounts, because the old one was wrong. `lumpers_amount` summed `amount`
-- and silently dropped `efs_fee`; several brokers deduct a fee when they issue
-- the electronic check, so that is real money advanced. For the six events in
-- the Aug 3–9 week it is a $12 gap — $1,014 shown against $1,020 actually paid.
-- `lumpers_amount` is kept as-is so nothing reading it breaks; `lumpers_total`
-- is the honest figure and is what the report subtotals on.
--
-- total_amount is a stored column, currently non-null and equal to
-- amount + efs_fee on all 316 rows; the coalesce is belt-and-braces for rows
-- written before it existed.
--
-- Patched by rewriting pg_get_functiondef output rather than reissuing the whole
-- 90-line body: only this fragment changes, and retyping the rest risks silently
-- dropping a clause that would still apply cleanly and only surface at runtime.
-- The raise below fails the migration loudly if the fragment stops matching.
--
-- NOT IN SCOPE, and deliberately not fixed here: an OPEN shift's window runs to
-- now() and so grows without bound. Aug 5 Shift 1 has been open ~41 hours and has
-- absorbed entries from Aug 6 and Aug 7. This change makes that visible, which is
-- the immediate need; whether an open shift should be capped at its expected end
-- time is a separate decision.

do $do$
declare
  d text;
  old_frag constant text :=
$f$      'lumpers_amount', (select coalesce(sum(amount),0) from lumper_events
                          where created_at between s.started_at and coalesce(s.ended_at, now()))
    ),$f$;
  new_frag constant text :=
$f$      'lumpers_amount', (select coalesce(sum(amount),0) from lumper_events
                          where created_at between s.started_at and coalesce(s.ended_at, now())),
      'lumpers_total', (select coalesce(sum(coalesce(total_amount, amount + efs_fee)),0) from lumper_events
                          where created_at between s.started_at and coalesce(s.ended_at, now())),
      'lumpers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', le.id,
          'load_number', le.load_number,
          'amount', le.amount,
          'efs_fee', le.efs_fee,
          'total_amount', coalesce(le.total_amount, le.amount + le.efs_fee),
          'recorded_by', le.recorded_by,
          'recorded_by_name', coalesce(nullif(btrim(le.recorded_by_name),''),
                                       (select email from users ru where ru.id = le.recorded_by)),
          'source', le.source,
          'created_at', le.created_at,
          'by_associate', (le.recorded_by is not distinct from s.user_id)
        ) order by le.created_at)
        from lumper_events le
        where le.created_at between s.started_at and coalesce(s.ended_at, now())), '[]'::jsonb)
    ),$f$;
begin
  select pg_get_functiondef(oid) into d from pg_proc
  where pronamespace = 'public'::regnamespace and proname = 'after_hours_shift_detail';

  if d is null then
    raise exception 'after_hours_shift_detail not found';
  end if;

  if position('''lumpers_total''' in d) > 0 then
    raise notice 'after_hours_shift_detail already exposes the lumper breakdown; nothing to do';
    return;
  end if;

  if position(old_frag in d) = 0 then
    raise exception 'the lumpers fragment of after_hours_shift_detail does not match what this migration expects; refusing to patch blindly';
  end if;

  execute replace(d, old_frag, new_frag);
  raise notice 'after_hours_shift_detail: lumper breakdown added';
end
$do$;

-- Fail loudly rather than leave the function half-updated.
do $check$
begin
  if (select position('''lumpers_total''' in pg_get_functiondef(oid)) = 0
      from pg_proc where pronamespace='public'::regnamespace and proname='after_hours_shift_detail') then
    raise exception 'after_hours_shift_detail still has no lumpers_total';
  end if;
end
$check$;
