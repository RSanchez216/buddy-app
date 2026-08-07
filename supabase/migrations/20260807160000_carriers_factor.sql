-- carriers.factor — which factoring company funds each carrier.
--
-- The RTS gating rule depends on it. Without this column the rule lands in the
-- frontend as three hardcoded UUIDs, which is exactly the kind of thing that
-- silently rots when a carrier is added.
--
-- Nullable on purpose: a carrier with no factor set shows no RTS blocks. That is
-- the safe direction — an unknown factor should say nothing, not guess.
--
-- Do NOT infer factor (or hold status) from carriers.is_active. All three rows
-- are is_active = true, TMS included, so it carries no signal here.

alter table public.carriers add column if not exists factor text;

update public.carriers set factor = 'RTS'
  where id = 'eea5654d-06d5-409f-a6ae-6ddd698db5bc';   -- PJ Twins Inc
update public.carriers set factor = 'Apex'
  where id in ('d7d88ef0-e5ae-4921-924a-039104c12be0', -- USKG Trans Inc
               '1fb3c6c8-7016-4312-8d49-9a011564a9cf'); -- TMS Transport Solutions Inc

alter table public.carriers drop constraint if exists carriers_factor_chk;
alter table public.carriers add constraint carriers_factor_chk
  check (factor is null or factor in ('RTS','Apex'));
