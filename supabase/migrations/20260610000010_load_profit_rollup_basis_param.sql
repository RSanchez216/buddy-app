-- Profitability: add p_basis parameter to load_profit_rollup so the analysis can
-- pivot from delivery-date to pickup-date. Managers use this to see the week by
-- when freight STARTED (pickup) vs when it SETTLED (delivery).
--
-- The parameter is optional (DEFAULT 'delivery') so existing 3-arg callers still
-- work via Postgres default parameter resolution. The DATE column used in the
-- WHERE clause and active_days count becomes configurable.

DROP FUNCTION IF EXISTS public.load_profit_rollup(text, date, date);

CREATE FUNCTION public.load_profit_rollup(
  p_dimension text, p_from date, p_to date, p_basis text DEFAULT 'delivery'
)
RETURNS TABLE(
  key_id uuid, key_name text,
  load_count bigint, leg_count bigint,
  realized_loads bigint, booked_loads bigint, active_days bigint,
  total_miles numeric, realized_revenue numeric, projected_revenue numeric,
  realized_rpm numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE id_col text; name_col text; date_col text;
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

  CASE lower(coalesce(p_basis,'delivery'))
    WHEN 'pickup'   THEN date_col := 'pickup_date';
    WHEN 'delivery' THEN date_col := 'delivery_date';
    ELSE RAISE EXCEPTION 'invalid basis: %', p_basis;
  END CASE;

  RETURN QUERY EXECUTE format($q$
    SELECT %1$I AS key_id, %2$I AS key_name,
           count(DISTINCT load_id) AS load_count,
           count(*) AS leg_count,
           count(DISTINCT load_id) FILTER (WHERE NOT is_projected) AS realized_loads,
           count(DISTINCT load_id) FILTER (WHERE is_projected)     AS booked_loads,
           count(DISTINCT %5$I) FILTER (WHERE NOT is_projected)     AS active_days,
           COALESCE(sum(leg_total_miles) FILTER (WHERE NOT is_projected), 0) AS total_miles,
           COALESCE(sum(leg_revenue)     FILTER (WHERE NOT is_projected), 0) AS realized_revenue,
           COALESCE(sum(leg_revenue)     FILTER (WHERE is_projected),     0) AS projected_revenue,
           CASE WHEN COALESCE(sum(leg_total_miles) FILTER (WHERE NOT is_projected),0) > 0
                THEN round( sum(leg_revenue)     FILTER (WHERE NOT is_projected)
                          / sum(leg_total_miles) FILTER (WHERE NOT is_projected), 2)
                ELSE NULL END AS realized_rpm
    FROM public.v_load_leg_profit
    WHERE %5$I BETWEEN %3$L AND %4$L
    GROUP BY %1$I, %2$I
  $q$, id_col, name_col, p_from, p_to, date_col);
END $function$;

GRANT EXECUTE ON FUNCTION public.load_profit_rollup(text, date, date, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
