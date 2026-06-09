-- Loads ingest — Phase 3 profitability layer (revenue/productivity only;
-- cost/margin is a later phase). Rolls revenue + miles + $/mile + load
-- counts up by driver/truck/dispatcher/customer/carrier, filtered by
-- DELIVERY DATE.
--
-- Locked rules:
--  * Period basis = delivery_date.
--  * Canceled excluded; TONU and everything else included.
--  * Booked = projected ("upcoming income"): is_projected = status ILIKE 'booked',
--    kept separate from realized revenue.
--  * Team-load revenue split is manual: load_legs.revenue_amount overrides;
--    until set, the view defaults to an even split (linehaul / leg_count)
--    so totals are never blank. leg_revenue attribution is additive — split
--    legs sum back to the load's linehaul, so customer/dispatcher/carrier
--    totals stay exact while driver/truck get their share.

-- 1) Manual per-leg revenue allocation (mainly for team loads)
ALTER TABLE public.load_legs ADD COLUMN IF NOT EXISTS revenue_amount numeric;

-- 2) Per-leg profitability base view
CREATE OR REPLACE VIEW public.v_load_leg_profit AS
WITH legs AS (
  SELECT ll.*, count(*) OVER (PARTITION BY ll.load_id) AS leg_count
  FROM public.load_legs ll
)
SELECT
  l.id AS load_id, l.load_number, ll.id AS leg_id, ll.leg_seq,
  l.is_team_load, ll.leg_count,
  l.status,
  (l.status ILIKE 'booked') AS is_projected,
  l.pickup_date, l.delivery_date,
  l.dispatcher_id, d.name  AS dispatcher_name,
  l.customer_id,   c.name  AS customer_name,
  l.carrier_id,    ca.name AS carrier_name,
  ll.driver_id,  dr.full_name   AS driver_name,  ll.driver_raw,
  COALESCE(dr.full_name,   ll.driver_raw)  AS driver_display,
  ll.truck_id,   tk.unit_number AS truck_unit,  ll.truck_raw,
  COALESCE(tk.unit_number, ll.truck_raw)   AS truck_display,
  ll.trailer_id, tl.unit_number AS trailer_unit, ll.trailer_raw,
  COALESCE(tl.unit_number, ll.trailer_raw) AS trailer_display,
  l.linehaul,
  COALESCE(
    ll.revenue_amount,
    CASE WHEN ll.leg_count = 1 THEN l.linehaul
         ELSE l.linehaul / ll.leg_count END
  ) AS leg_revenue,
  ll.total_miles  AS leg_total_miles,
  ll.loaded_miles AS leg_loaded_miles,
  ll.empty_miles  AS leg_empty_miles
FROM legs ll
JOIN public.loads l       ON l.id  = ll.load_id
LEFT JOIN public.dispatchers d ON d.id  = l.dispatcher_id
LEFT JOIN public.customers   c ON c.id  = l.customer_id
LEFT JOIN public.carriers   ca ON ca.id = l.carrier_id
LEFT JOIN public.drivers    dr ON dr.id = ll.driver_id
LEFT JOIN public.trucks     tk ON tk.id = ll.truck_id
LEFT JOIN public.trailers   tl ON tl.id = ll.trailer_id
WHERE l.status NOT ILIKE 'canceled';

GRANT SELECT ON public.v_load_leg_profit TO anon, authenticated, service_role;

-- 3) Dimension rollup (delivery-date range); realized vs projected split.
-- total_miles + realized_rpm count realized (non-projected) legs only;
-- projected_revenue is the Booked upcoming income shown separately.
CREATE OR REPLACE FUNCTION public.load_profit_rollup(p_dimension text, p_from date, p_to date)
RETURNS TABLE (
  key_id uuid, key_name text,
  load_count bigint, leg_count bigint,
  total_miles numeric,
  realized_revenue numeric, projected_revenue numeric,
  realized_rpm numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE id_col text; name_col text;
BEGIN
  CASE p_dimension
    WHEN 'driver'     THEN id_col := 'driver_id';     name_col := 'driver_display';
    WHEN 'truck'      THEN id_col := 'truck_id';      name_col := 'truck_display';
    WHEN 'trailer'    THEN id_col := 'trailer_id';    name_col := 'trailer_display';
    WHEN 'dispatcher' THEN id_col := 'dispatcher_id'; name_col := 'dispatcher_name';
    WHEN 'customer'   THEN id_col := 'customer_id';   name_col := 'customer_name';
    WHEN 'carrier'    THEN id_col := 'carrier_id';    name_col := 'carrier_name';
    ELSE RAISE EXCEPTION 'invalid dimension: %', p_dimension;
  END CASE;

  RETURN QUERY EXECUTE format($q$
    SELECT %1$I AS key_id, %2$I AS key_name,
           count(DISTINCT load_id) AS load_count,
           count(*) AS leg_count,
           COALESCE(sum(leg_total_miles) FILTER (WHERE NOT is_projected), 0) AS total_miles,
           COALESCE(sum(leg_revenue)     FILTER (WHERE NOT is_projected), 0) AS realized_revenue,
           COALESCE(sum(leg_revenue)     FILTER (WHERE is_projected),     0) AS projected_revenue,
           CASE WHEN COALESCE(sum(leg_total_miles) FILTER (WHERE NOT is_projected),0) > 0
                THEN round( sum(leg_revenue)     FILTER (WHERE NOT is_projected)
                          / sum(leg_total_miles) FILTER (WHERE NOT is_projected), 2)
                ELSE NULL END AS realized_rpm
    FROM public.v_load_leg_profit
    WHERE delivery_date BETWEEN %3$L AND %4$L
    GROUP BY %1$I, %2$I
  $q$, id_col, name_col, p_from, p_to);
END $fn$;

GRANT EXECUTE ON FUNCTION public.load_profit_rollup(text, date, date) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
