-- Manual broker flags: a picked list of reasons, and one row per flag.
--
-- Replaces broker_risk_list's single `flags` string ('I','N','IN','D','DN','U'),
-- which could hold four meanings in one column and no wording at all — the
-- copy lived in the frontend, so "what is wrong with this broker" was a letter
-- and a hardcoded sentence.
--
-- CREDIT STOPS ARE NOT HERE. broker_credit_events already has the right shape
-- (active_from / resolved_on, factor, limits) and already feeds the panel. A
-- fifth category would be a second source of truth for one thing. The profile
-- merges both into one list; the user never sees the split.

create table if not exists public.broker_flag_reasons (
  id          uuid primary key default gen_random_uuid(),
  category    text not null check (category in ('identity','payment','billing','other')),
  headline    text not null,
  body        text,
  checklist   text[],
  is_custom   boolean not null default false,
  is_active   boolean not null default true,
  created_by  uuid references public.users(id),
  created_at  timestamptz not null default now(),
  unique (category, headline)
);

-- One flag on one broker. headline/body/checklist are COPIED from the reason at
-- creation, never read through reason_id at render time: editing a reason later
-- must not silently rewrite the wording already recorded against real brokers.
-- reason_id is kept only to show which picked reason it came from.
create table if not exists public.broker_flags (
  id            uuid primary key default gen_random_uuid(),
  mc_number     text not null,
  category      text not null check (category in ('identity','payment','billing','other')),
  reason_id     uuid references public.broker_flag_reasons(id),
  headline      text not null,
  body          text,
  checklist     text[],
  verify_phone  text,
  verify_email  text,
  source        text not null default 'Accounting',
  note          text,
  active_from   date not null default (now() at time zone 'America/Chicago')::date,
  resolved_on   date,
  resolved_note text,
  created_by    uuid references public.users(id),
  resolved_by   uuid references public.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The partial index carries the board's query: it only ever wants unresolved
-- flags, and 997 rows of history should not be walked to answer that.
create index if not exists idx_broker_flags_mc on public.broker_flags (mc_number) where resolved_on is null;
create index if not exists idx_broker_flags_mc_all on public.broker_flags (mc_number);

alter table public.broker_flag_reasons enable row level security;
alter table public.broker_flags enable row level security;

-- Reads: any signed-in user — the board renders these to every associate.
-- Writes: managers and admins only. `to authenticated` throughout, never public:
-- the anon key ships in the JS bundle, so a policy on public is a policy on the
-- open internet.
drop policy if exists bfr_read on public.broker_flag_reasons;
create policy bfr_read on public.broker_flag_reasons
  for select to authenticated using (true);

drop policy if exists bfr_write on public.broker_flag_reasons;
create policy bfr_write on public.broker_flag_reasons
  for all to authenticated
  using (public.is_admin_or_manager())
  with check (public.is_admin_or_manager());

drop policy if exists bf_read on public.broker_flags;
create policy bf_read on public.broker_flags
  for select to authenticated using (true);

drop policy if exists bf_write on public.broker_flags;
create policy bf_write on public.broker_flags
  for all to authenticated
  using (public.is_admin_or_manager())
  with check (public.is_admin_or_manager());

-- The picked list. Wording is the panel's existing copy, moved into data.
--
-- "Impersonated", and the company called legitimate — never "bad broker" or
-- "blacklisted". These are companies MANAS hauls for daily and the broker is the
-- victim of the identity theft, not its author.
insert into public.broker_flag_reasons (category, headline, body, checklist) values
 ('identity','Someone has impersonated this broker',
  'The company itself is legitimate — verify you are dealing with the real one.',
  array['Confirm the rep works there','Confirm the load # is in their system','Do not accept a changed remit-to']),
 ('identity','Double-brokering reported',
  'This broker has re-brokered loads. Confirm who is actually responsible for payment before you dispatch.', null),
 ('identity','Confirmations arrive only from one domain',
  'Anything from another domain is not genuine, however convincing it looks.', null),
 ('payment','Reported for slow or non-payment',
  'Get the POD in on time — late paperwork is the first thing disputed.', null),
 ('billing','Originals required for a named shipper',
  'Copies are acceptable on all other loads.', null),
 ('billing','Current-year W9 required', null, null),
 ('billing','TONU billing needs a specific document set', null, null),
 ('billing','Other paperwork condition', null, null),
 ('other','On the risk list — reason not recorded', null, null)
on conflict do nothing;
