-- Migrate broker_risk_list's 959 rows into broker_flags: 997 flags.
--
-- Each letter in `flags` becomes its own row, because each letter was a
-- different statement about the broker crammed into one column:
--   I  → identity, impersonated                     515
--   D  (without I) → identity, double-brokering       9
--   N  → payment, slow or non-payment               472
--   U  (no I/D/N) → other, reason not recorded        1
-- Verified: no row carries both I and D, so the split is unambiguous.
--
-- verify_phone and note attach to ONE flag per broker — the identity flag when
-- there is one, else payment, else other. Copying a phone number onto all three
-- would make it look like three separate confirmations of the same thing.
--
-- headline/body/checklist are copied from the reason rather than referenced, so
-- editing a reason later cannot rewrite history on 997 existing flags.

insert into public.broker_flags (mc_number, category, reason_id, headline, body, checklist,
                                 verify_phone, note, source, active_from)
with r as (
  select rl.*,
         (rl.flags ~ 'I')                        as has_i,
         (rl.flags ~ 'D' and rl.flags !~ 'I')    as has_d_only,
         (rl.flags ~ 'N')                        as has_n,
         (rl.flags !~ '[IDN]')                   as has_other
  from public.broker_risk_list rl
), attach as (
  select r.*,
         case when r.has_i or r.has_d_only then 'identity'
              when r.has_n then 'payment'
              else 'other' end as attach_to
  from r
)
select a.mc_number, f.category, br.id, f.headline, br.body, br.checklist,
       case when a.attach_to = f.category then a.verify_phone end,
       case when a.attach_to = f.category then a.note end,
       -- Apex-sourced rows keep their provenance; everything else reads
       -- "Accounting", never an individual.
       case when a.source = 'Apex credit check' then 'Apex credit check' else 'Accounting' end,
       coalesce(a.list_date, current_date)
from attach a
cross join lateral (values
  ('identity', 'Someone has impersonated this broker',   a.has_i),
  ('identity', 'Double-brokering reported',              a.has_d_only),
  ('payment',  'Reported for slow or non-payment',       a.has_n),
  ('other',    'On the risk list — reason not recorded', a.has_other)
) as f(category, headline, applies)
join public.broker_flag_reasons br
  on br.category = f.category and br.headline = f.headline
where f.applies;

-- Fail the migration rather than leave a half-populated table behind.
do $check$
declare n int;
begin
  select count(*) into n from public.broker_flags;
  if n <> 997 then
    raise exception 'expected 997 migrated flags, got %', n;
  end if;
end
$check$;
