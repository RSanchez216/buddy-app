-- v_load_broker_risk: split the risk list by what the flag actually means.
--
-- THE BUG THIS FIXES IS A WRONG STATEMENT, NOT A MISSING FEATURE. Every broker
-- on broker_risk_list currently renders "this broker has been impersonated".
-- 435 of the flagged MCs carry 'N' — nonpayment — and nobody impersonated them.
-- On the last 30 days that is 53 loads telling an associate to go verify an
-- identity when the actual task is getting the POD in before the invoice is
-- disputed. It is a false claim about a real company AND it points at the wrong
-- work.
--
-- Derived here rather than in the component for the same reason
-- broker_factor_ratings.action is: the flag→meaning mapping is a domain rule and
-- belongs in one place, not re-implemented at each render site.
--
-- identity and nonpayment are INDEPENDENT, not a switch. 32 MCs carry 'IN' and
-- must show both blocks — the two facts are both true and neither cancels the
-- other.
--
-- risk_unclassified catches a flag string that matches none of I/D/N, so the one
-- 'U' broker keeps a block instead of silently vanishing from a panel whose
-- whole job is telling you what is known.
--
-- APPEND ONLY, and the column order above them is untouched:
-- after_hours_board_broker_risk returns SETOF this rowtype, so reordering or
-- removing a column changes that function's return type. CREATE OR REPLACE VIEW
-- permits adding columns at the end and nothing else, which is the guard rail
-- here rather than a convention to remember.

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

  (rl.mc_number is not null)             as on_risk_list,
  rl.flags                               as risk_list_flags,

  (ce.mc_number is not null)             as has_credit_event,
  ce.new_limit_usd                       as credit_new_limit,
  ce.prior_limit_usd                     as credit_prior_limit,
  ce.active_from                         as credit_active_from,
  (c.factor = 'Apex')                    as credit_is_binding,

  (af.mc_number is not null)             as has_advance_fee,
  af.fee_rule, af.fee_flat, af.fee_pct, af.fee_raw,
  af.as_of                               as fee_as_of,

  case
    when c.factor is distinct from 'RTS'                              then 'hidden'
    when r.action = 'do_not_book'                                     then 'red'
    when r.action = 'call_factor'                                     then 'amber'
    when r.mc_number is null                                          then 'unrated'
    when rl.mc_number is not null or ce.mc_number is not null         then 'neutral'
    else                                                                   'good'
  end                                    as rts_tone,

  -- ── appended below this line ──
  (rl.flags ~ '[ID]')                                   as risk_identity,
  (rl.flags ~ 'N')                                      as risk_nonpayment,
  (rl.mc_number is not null and rl.flags !~ '[IDN]')    as risk_unclassified

from public.loads l
join public.carriers c   on c.id  = l.carrier_id
left join public.customers cu on cu.id = l.customer_id
left join public.v_broker_factor_rating_current r
       on r.mc_number = cu.mc_number and r.factor = 'RTS'
left join lateral (
  select mc_number, flags
  from public.broker_risk_list
  where mc_number = cu.mc_number
  limit 1
) rl on true
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
