-- Handoff text: add a SHIFT LOG section for running shift notes.
--
-- Running notes are shift_activities rows with activity_type='note' and a NULL
-- load_id — work that happened during the shift with no board row to hang it on
-- (a broker call about nothing in particular, a systems outage, a message from
-- Accounting). They are distinguished by load_id IS NULL, not by a new type; the
-- CHECK constraint already allows 'note' and no new value is added.
--
-- WHY A NEW HEADER. The existing NOTES section prints after_hours_shifts
-- .handoff_notes — the single end-of-shift field — and is left exactly as it is.
-- Reusing or renaming it would reassign the meaning of a header that already
-- appears in the frozen handoff archive, making old records ambiguous about
-- which kind of note they hold. SHIFT LOG is a new, separate section.
--
-- Placement: after OPEN — NEEDS PICKUP, before NOTES. Both sections are omitted
-- entirely when empty — no empty headers.
--
-- Everything else in this function is unchanged.

CREATE OR REPLACE FUNCTION public.shift_handoff_text(p_shift_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s record; t text; open_items text; shift_log text;
begin
  select sh.*, u.full_name as who into s
  from after_hours_shifts sh join users u on u.id = sh.user_id where sh.id = p_shift_id;
  if not found then return null; end if;

  t := E'\U0001F319 AFTER-HOURS HANDOFF\n'
    || initcap(replace(s.shift_type,'_',' ')) || ' · ' || s.who || ' · '
    || to_char(s.shift_date,'Dy DD Mon') || E'\n'
    || to_char(s.started_at at time zone 'America/Chicago','HH12:MI AM') || ' – '
    || coalesce(to_char(coalesce(s.ended_at, now()) at time zone 'America/Chicago','HH12:MI AM'),'now')
    || E' CT\n\nDONE\n'
    || rpad('Drivers reviewed', 18)
    || (select count(*) from shift_driver_checks where shift_id=s.id)::text || '/'
    || (select count(*) from drivers where current_status='active')::text || E'\n'
    || rpad('Loads booked', 18)
    || (select count(*) from shift_activities where shift_id=s.id and activity_type='load_booked')::text || E'\n'
    || rpad('PODs / BOLs', 18)
    || (select count(*) from shift_activities where shift_id=s.id and activity_type='pod_collected')::text || ' / '
    || (select count(*) from shift_activities where shift_id=s.id and activity_type='bol_collected')::text || E'\n'
    || rpad('Checkpoints', 18)
    || (select coalesce(sum(collected_count),0) from load_checkpoints where shift_id=s.id)::text || E'\n'
    || rpad('Requests handled', 18)
    || (select count(*) from help_requests where shift_id=s.id and handled_at is not null)::text || E'\n'
    || rpad('Lumpers', 18)
    || (select count(*) from lumper_events
         where created_at between s.started_at and coalesce(s.ended_at, now()))::text || E'\n';

  select string_agg('• ' || hr.driver_name || ' — ' ||
                    case hr.kind when 'uncovered' then 'UNCOVERED' else 'needs help' end ||
                    coalesce(E'\n  ' || nullif(hr.note,''), ''), E'\n')
    into open_items
  from help_requests hr
  where hr.handled_at is null and hr.dismissed_at is null;

  if open_items is not null then
    t := t || E'\n\U000026A0 OPEN — NEEDS PICKUP\n' || open_items || E'\n';
  else
    t := t || E'\nNothing open. Clean handoff.\n';
  end if;

  -- SHIFT LOG — running notes, oldest first so the section reads as the night
  -- unfolded. Times are Chicago wall clock, matching every other time in this
  -- body. A note containing newlines has its continuation lines indented two
  -- spaces so it stays under its own bullet, the same shape open_items uses.
  select string_agg('• ' || to_char(a.occurred_at at time zone 'America/Chicago','HH24:MI')
                    || '  ' || replace(a.note, E'\n', E'\n  '), E'\n' order by a.occurred_at)
    into shift_log
  from shift_activities a
  where a.shift_id = s.id
    and a.activity_type = 'note'
    and a.load_id is null
    and nullif(a.note,'') is not null;

  if shift_log is not null then
    t := t || E'\nSHIFT LOG\n' || shift_log || E'\n';
  end if;

  if nullif(s.handoff_notes,'') is not null then
    t := t || E'\nNOTES\n' || s.handoff_notes || E'\n';
  end if;

  return t || E'\n— end of shift —';
end $function$;
