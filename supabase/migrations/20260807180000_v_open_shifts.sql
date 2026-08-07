-- v_open_shifts — everyone currently on shift, not just the viewer.
--
-- Concurrent shifts are already happening in production: two are open right now
-- (Altyn Berdimatov from 10:03 AM CT, Rebeca Sanchez from 11:24 AM CT). Every
-- surface that asks "am I on shift" has been answering with the viewer's own
-- row, which is a different question.
--
-- elapsed is computed here rather than stored — the same rule the duration
-- formatter follows. There is no duration column and there should not be one.
--
-- security_invoker so the view is subject to the caller's RLS, not the owner's.

create or replace view public.v_open_shifts
with (security_invoker = true) as
select s.id            as shift_id,
       s.user_id,
       coalesce(u.full_name, u.email) as display_name,
       s.shift_type,
       s.shift_date,
       s.started_at,
       (now() - s.started_at) as elapsed
from public.after_hours_shifts s
left join public.users u on u.id = s.user_id
where s.status = 'open';

revoke all on public.v_open_shifts from anon, public;
grant select on public.v_open_shifts to authenticated;
