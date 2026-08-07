-- Supporting indexes for v_load_broker_risk.
--
-- The view joins customers by mc_number and then hits three broker tables on the
-- same key, once per load. The board already takes ~4s; these keep the added
-- work off sequential scans.
--
-- The advance-fee index is partial on match_status = 'exact' because that is the
-- only status the view ever joins on — candidate rows are unconfirmed proposals
-- and must never match.

create index if not exists idx_customers_mc_number on public.customers (mc_number);
create index if not exists idx_broker_risk_list_mc on public.broker_risk_list (mc_number);
create index if not exists idx_broker_credit_events_mc on public.broker_credit_events (mc_number);
create index if not exists idx_broker_advance_fees_mc on public.broker_advance_fees (mc_number)
  where match_status = 'exact';
