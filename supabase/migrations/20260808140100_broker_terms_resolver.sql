-- broker_accessorial_terms_for_load — the ONE place precedence lives.
--
--   1 · terms stated on this load's rate confirmation   → source 'rate_con'
--   2 · the broker's recorded default terms             → source 'broker_default'
--   3 · nothing                                          → source 'none'
--
-- THE RATE CON ALWAYS WINS. Recorded terms are a fallback for a silent
-- document, never an override. If the con says 2 hours free and the recorded
-- default says 3, the claim is built on 2.
--
-- STEP 1 READS THE SAME JSONB THE PANEL READS, the same way: load_broker_rules
-- .rules -> 'accessorial_terms' -> <type>, taking free_minutes and falling back
-- to round(free_hours * 60), which is exactly what termsForType does in
-- accessorialData.js. There is deliberately no second extraction — if the panel
-- and the resolver ever disagreed about whether the con is silent, the banner
-- would be telling the associate something untrue about a document the broker
-- also holds.
--
-- Resolution between recorded rows: MOST SPECIFIC WINS. A 'shipper' row beats an
-- 'any' row for a shipper claim; the partial unique index permits one of each on
-- purpose.

create or replace function public.broker_accessorial_terms_for_load(
  p_load_id uuid,
  p_type text,
  p_location text default 'any'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_type text := lower(coalesce(p_type, ''));
  v_key  text;
  v_con  jsonb;
  v_cust uuid;
  t      public.broker_accessorial_terms%rowtype;
begin
  -- The panel matches on a substring because accessorial_types carries custom
  -- codes like 'detention_shipper'; mirror that rather than an equality test.
  v_key := case
    when v_type like '%detention%' then 'detention'
    when v_type like '%layover%'   then 'layover'
    when v_type like '%tonu%'      then 'tonu'
    else null end;

  select l.customer_id into v_cust from public.loads l where l.id = p_load_id;

  if v_key is not null then
    select r.rules -> 'accessorial_terms' -> v_key
      into v_con
    from public.load_broker_rules r
    where r.load_id = p_load_id;
  end if;

  -- Step 1 — the rate con, when it says anything at all about this type.
  if v_con is not null and (
       v_con ? 'free_minutes' or v_con ? 'free_hours' or
       v_con ? 'rate_per_hour' or v_con ? 'flat_usd' or v_con ? 'cap_usd')
  then
    return jsonb_build_object(
      'source', 'rate_con',
      'free_minutes', coalesce(
         (v_con ->> 'free_minutes')::int,
         round(((v_con ->> 'free_hours')::numeric) * 60)::int),
      'rate_per_hour', (v_con ->> 'rate_per_hour')::numeric,
      'block_minutes', 60,
      'max_amount', (v_con ->> 'cap_usd')::numeric,
      'flat_amount', (v_con ->> 'flat_usd')::numeric,
      'notice_hours', null,
      'customer_id', v_cust,
      'terms_id', null,
      'terms_source_text', v_con ->> 'clause',
      'effective_from', null
    );
  end if;

  -- Step 2 — the broker's recorded default. Most specific location first.

  if v_cust is not null and v_key is not null then
    select * into t
    from public.broker_accessorial_terms b
    where b.customer_id = v_cust
      and b.accessorial_type = v_key
      and b.effective_to is null
      and b.location in ('any', coalesce(nullif(lower(p_location), ''), 'any'))
    order by (b.location <> 'any') desc, b.effective_from desc
    limit 1;

    if found then
      return jsonb_build_object(
        'source', 'broker_default',
        'free_minutes', t.free_minutes,
        'rate_per_hour', t.rate_per_hour,
        'block_minutes', t.block_minutes,
        'max_amount', t.max_amount,
        'flat_amount', t.flat_amount,
        'notice_hours', t.notice_hours,
        'customer_id', v_cust,
        'terms_id', t.id,
        'terms_source_text', t.source,
        'effective_from', t.effective_from
      );
    end if;
  end if;

  -- Step 3 — nothing on record. The associate reads it off the document.
  return jsonb_build_object(
    'source', 'none',
    'free_minutes', null, 'rate_per_hour', null, 'block_minutes', 60,
    'max_amount', null, 'flat_amount', null, 'notice_hours', null,
    'customer_id', v_cust,
    'terms_id', null, 'terms_source_text', null, 'effective_from', null
  );
end
$function$;

revoke all on function public.broker_accessorial_terms_for_load(uuid, text, text) from anon, public;
grant execute on function public.broker_accessorial_terms_for_load(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
