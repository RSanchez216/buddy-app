-- A broker's STANDING accessorial terms — the fallback used only when this
-- load's rate confirmation is silent.
--
-- Of 11 C.H. Robinson rate confirmations read, none stated a detention rate,
-- free time or cap, and CHR is 39.3% of PJ Twins volume. On those loads the
-- request form has had nothing to calculate from.
--
-- KEYED ON customer_id, NOT mc_number. Risk data is MC-keyed because that is
-- what the factors publish, but 18 brokers with live loads have no MC at all and
-- would silently never get terms. Terms are commercial and belong to the
-- customer record we actually book against.
--
-- ENDING TERMS SETS effective_to. Never delete, never edit in place: a claim
-- filed in July has to reconcile against the terms that were true in July, and
-- an in-place edit destroys the only record of what was agreed then.

create table if not exists public.broker_accessorial_terms (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references public.customers(id) on delete cascade,
  accessorial_type text not null check (accessorial_type in ('detention','layover','tonu','other')),
  location         text not null default 'any' check (location in ('any','shipper','receiver')),

  -- Stored in MINUTES, entered and displayed in HOURS. The industry says "two
  -- hours free"; someone typing 2 into a box labelled (MIN) is how load 2608-108
  -- was over-claimed by $140.
  free_minutes     integer check (free_minutes >= 0),
  rate_per_hour    numeric check (rate_per_hour >= 0),
  block_minutes    integer not null default 60 check (block_minutes > 0),
  max_amount       numeric check (max_amount >= 0),
  flat_amount      numeric check (flat_amount >= 0),
  notice_hours     integer check (notice_hours >= 0),

  source           text not null,
  note             text,
  effective_from   date not null default (now() at time zone 'America/Chicago')::date,
  effective_to     date,
  created_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Detention bills by the hour; layover and TONU are flat. Mixing the two on
  -- one row makes the resolver's output ambiguous for the form.
  constraint terms_shape check (
    case accessorial_type
      when 'detention' then rate_per_hour is not null and flat_amount is null
      when 'layover'   then flat_amount is not null and rate_per_hour is null
      when 'tonu'      then flat_amount is not null and rate_per_hour is null
      else true
    end
  ),
  constraint terms_dates check (effective_to is null or effective_to >= effective_from)
);

-- One ACTIVE row per customer/type/location. The partial predicate is what lets
-- history accumulate underneath: ended rows keep an effective_to and drop out of
-- the constraint, so the same terms can be re-recorded later.
create unique index if not exists uq_broker_terms_active
  on public.broker_accessorial_terms (customer_id, accessorial_type, location)
  where effective_to is null;

create index if not exists idx_broker_terms_customer
  on public.broker_accessorial_terms (customer_id) where effective_to is null;

alter table public.broker_accessorial_terms enable row level security;

-- Reads: any signed-in user — the request form needs them. Writes: managers and
-- admins. `to authenticated` throughout, never public: the anon key ships in the
-- JS bundle.
drop policy if exists bat_read on public.broker_accessorial_terms;
create policy bat_read on public.broker_accessorial_terms
  for select to authenticated using (true);

drop policy if exists bat_write on public.broker_accessorial_terms;
create policy bat_write on public.broker_accessorial_terms
  for all to authenticated
  using (public.is_admin_or_manager())
  with check (public.is_admin_or_manager());

revoke all on public.broker_accessorial_terms from anon, public;
grant select, insert, update on public.broker_accessorial_terms to authenticated;

notify pgrst, 'reload schema';
