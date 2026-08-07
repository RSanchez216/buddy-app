-- v_load_broker_risk — one row per load, every flag an explicit boolean.
--
-- WHY TYPED COLUMNS AND NOT A JSONB PAYLOAD. The existing risk RPC builds its
-- payload with jsonb_strip_nulls, which removes falsy-computed keys entirely.
-- When its row set was widened to include credit-only brokers, `id_theft` and
-- friends became ABSENT rather than false on those rows, and a presence test in
-- the frontend mislabelled 1,204 loads. A view with typed columns makes that
-- class of bug structurally impossible: a boolean column is true or false, never
-- missing. Do not replace this with a jsonb blob.
--
-- THE GATING RULE. Apex-sourced blocks render on every carrier; RTS-sourced
-- blocks render only where the carrier factors with RTS. Not symmetric, and
-- deliberately so — Apex identity data is useful whoever funds the load, but an
-- RTS grade on a USKG or TMS load would tell a dispatcher to call a company USKG
-- has no relationship with. rts_tone = 'hidden' encodes this; consumers trust it
-- rather than re-deriving it.
--
-- The advance-fee join is on mc_number at match_status = 'exact' ONLY. Five rows
-- carry an mc_candidate instead — unconfirmed name-match proposals, and name
-- matching on this data has already produced confident nonsense ("GTO 2000"
-- matched The Worthington Company). All five have a null mc_number, so joining
-- on mc_number excludes them structurally rather than by convention.
--
-- security_invoker so the view is subject to the caller's RLS, not the owner's.

create or replace view public.v_load_broker_risk
with (security_invoker = true) as
select
  l.id                                   as load_id,
  c.factor                               as carrier_factor,
  -- Added to the brief's column list: the advisory form of the credit block
  -- reads "Apex does not fund {carrier name}", so the name has to come from
  -- somewhere. Taking it here keeps the frontend off carrier UUIDs entirely.
  c.name                                 as carrier_name,
  cu.mc_number,

  -- RTS rating — gated to RTS-factored carriers
  (c.factor = 'RTS')                     as rts_applies,
  case when c.factor = 'RTS' then r.rating          end as rts_rating,
  case when c.factor = 'RTS' then r.action          end as rts_action,
  case when c.factor = 'RTS' then r.previous_rating end as rts_previous_rating,
  case when c.factor = 'RTS' then r.changed_on      end as rts_changed_on,
  case when c.factor = 'RTS' then r.captured_on     end as rts_captured_on,

  -- Apex identity
  (rl.mc_number is not null)             as on_risk_list,
  rl.flags                               as risk_list_flags,

  -- Apex funding
  (ce.mc_number is not null)             as has_credit_event,
  ce.new_limit_usd                       as credit_new_limit,
  ce.prior_limit_usd                     as credit_prior_limit,
  ce.active_from                         as credit_active_from,
  (c.factor = 'Apex')                    as credit_is_binding,

  -- Accounting advance fee
  (af.mc_number is not null)             as has_advance_fee,
  af.fee_rule, af.fee_flat, af.fee_pct, af.fee_raw,
  af.as_of                               as fee_as_of,

  -- presentation tone for the rating block
  case
    when c.factor is distinct from 'RTS'                              then 'hidden'
    when r.action = 'do_not_book'                                     then 'red'
    when r.action = 'call_factor'                                     then 'amber'
    when r.mc_number is null                                          then 'unrated'
    when rl.mc_number is not null or ce.mc_number is not null         then 'neutral'
    else                                                                   'good'
  end                                    as rts_tone

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
