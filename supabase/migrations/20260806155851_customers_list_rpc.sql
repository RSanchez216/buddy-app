-- One row per customer for the /fleet/customers directory.
--
-- Exists so the browser doesn't have to download ~14,700 loads to count them.
-- Risk flags are decoded exactly as broker_profile does (flags LIKE '%I%' etc.)
-- so a chip on the list and a chip on the profile can never disagree, and
-- loads_ytd uses the same date_trunc('year', current_date) boundary.
--
-- broker_risk_list.mc_number is unique (948 rows, 948 distinct), so the join
-- cannot multiply customers.
create or replace function public.customers_list()
returns table (
  id uuid,
  name text,
  tms_code text,
  mc_number text,
  city text,
  state text,
  credit_limit numeric,
  credit_hold boolean,
  loads_ytd integer,
  loads_total integer,
  last_load date,
  id_theft boolean,
  nonpayment boolean,
  double_brokering boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with l as (
    select customer_id,
           count(*) filter (where pickup_date >= date_trunc('year', current_date))::int as loads_ytd,
           count(*)::int as loads_total,
           max(pickup_date) as last_load
    from loads
    where customer_id is not null
    group by customer_id
  )
  select c.id, c.name, c.tms_code, c.mc_number, c.city, c.state,
         c.credit_limit, c.credit_hold,
         coalesce(l.loads_ytd, 0), coalesce(l.loads_total, 0), l.last_load,
         coalesce(r.flags like '%I%', false),
         coalesce(r.flags like '%N%', false),
         coalesce(r.flags like '%D%', false)
  from customers c
  left join l on l.customer_id = c.id
  left join broker_risk_list r on r.mc_number = c.mc_number
  order by coalesce(l.loads_ytd, 0) desc, c.name;
$$;

grant execute on function public.customers_list() to authenticated;
