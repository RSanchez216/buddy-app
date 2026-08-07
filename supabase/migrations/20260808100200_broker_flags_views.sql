-- Point the board at broker_flags instead of broker_risk_list.
--
-- v_load_broker_risk's flag columns are unchanged in NAME and POSITION —
-- after_hours_board_broker_risk returns SETOF this rowtype — but they are now
-- derived from broker_flags rather than from letters in a string. risk_billing
-- is appended last, the only structural change.
--
-- Two existing columns change meaning rather than shape, and nothing reads
-- either one from the frontend (checked):
--   on_risk_list    — now "this broker has any active flag", which is what it
--                     always meant in practice.
--   risk_list_flags — was 'I'/'IN'/'N'/…; now a comma-separated category list.
--                     Kept only because the column cannot be removed without
--                     changing the RPC's return type.
--
-- verify_phone prefers the identity flag's number: it is the flag that asks
-- someone to make a call, and it is where the migration attached it.

create or replace view public.v_broker_flags_current
with (security_invoker = true) as
select mc_number, category, headline, body, checklist, verify_phone, verify_email,
       source, note, active_from, id as flag_id
from public.broker_flags
where resolved_on is null;

revoke all on public.v_broker_flags_current from anon, public;
grant select on public.v_broker_flags_current to authenticated;

create or replace view public.v_load_broker_risk
with (security_invoker = true) as
select
  l.id                                   as load_id,
  c.factor                               as carrier_factor,
  c.name                                 as carrier_name,
  cu.mc_number,

  (c.factor = 'RTS')                     as rts_applies,
  case when c.factor = 'RTS' then r.rating          end as rts_rating,
  case when c.factor = 'RTS' then r.action          end as rts_action,
  case when c.factor = 'RTS' then r.previous_rating end as rts_previous_rating,
  case when c.factor = 'RTS' then r.changed_on      end as rts_changed_on,
  case when c.factor = 'RTS' then r.captured_on     end as rts_captured_on,

  fl.any_flag                            as on_risk_list,
  fl.categories                          as risk_list_flags,

  (ce.mc_number is not null)             as has_credit_event,
  ce.new_limit_usd                       as credit_new_limit,
  ce.prior_limit_usd                     as credit_prior_limit,
  ce.active_from                         as credit_active_from,
  (c.factor = 'Apex')                    as credit_is_binding,

  (af.mc_number is not null)             as has_advance_fee,
  af.fee_rule, af.fee_flat, af.fee_pct, af.fee_raw,
  af.as_of                               as fee_as_of,

  case
    when c.factor is distinct from 'RTS'                    then 'hidden'
    when r.action = 'do_not_book'                           then 'red'
    when r.action = 'call_factor'                           then 'amber'
    when r.mc_number is null                                then 'unrated'
    when fl.any_flag or ce.mc_number is not null            then 'neutral'
    else                                                         'good'
  end                                    as rts_tone,

  fl.identity                            as risk_identity,
  fl.payment                             as risk_nonpayment,
  fl.other                               as risk_unclassified,
  fl.verify_phone                        as risk_verify_phone,

  -- ── appended below this line ──
  fl.billing                             as risk_billing

from public.loads l
join public.carriers c   on c.id  = l.carrier_id
left join public.customers cu on cu.id = l.customer_id
left join public.v_broker_factor_rating_current r
       on r.mc_number = cu.mc_number and r.factor = 'RTS'
left join lateral (
  select bool_or(category = 'identity') as identity,
         bool_or(category = 'payment')  as payment,
         bool_or(category = 'billing')  as billing,
         bool_or(category = 'other')    as other,
         count(*) > 0                   as any_flag,
         string_agg(distinct category, ',' order by category) as categories,
         (array_agg(verify_phone order by (category = 'identity') desc, verify_phone)
            filter (where verify_phone is not null))[1] as verify_phone
  from public.v_broker_flags_current
  where mc_number = cu.mc_number
) fl on true
left join lateral (
  select mc_number, new_limit_usd, prior_limit_usd, active_from
  from public.broker_credit_events
  where mc_number = cu.mc_number
    and event_type = 'no_credit'
    and resolved_on is null
    and active_from <= (now() at time zone 'America/Chicago')::date
  order by active_from desc
  limit 1
) ce on true
left join lateral (
  select mc_number, fee_rule, fee_flat, fee_pct, fee_raw, as_of
  from public.broker_advance_fees
  where mc_number = cu.mc_number
    and match_status = 'exact'
    and is_active
  order by as_of desc
  limit 1
) af on true;

revoke all on public.v_load_broker_risk from anon, public;
grant select on public.v_load_broker_risk to authenticated;
