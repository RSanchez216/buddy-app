-- Profitability: surface ACTIVE DAYS in the rollup so the weekly view can show
-- utilization — how many distinct days each driver/truck actually ran a load.
-- active_days = distinct REALIZED delivery dates (NOT is_projected) in range, so
-- a purely-booked driver shows 0 (consistent with the realized framing; out of
-- 7 on a week). Most meaningful on the Drivers/Trucks dimensions.
--
-- RETURNS TABLE signature changes (adds active_days) so this is a DROP + CREATE,
-- not CREATE OR REPLACE. Additive column only — no data change; the
-- realized/booked counts and revenue/miles logic are unchanged from
-- 20260521000022.

DROP FUNCTION IF EXISTS public.load_profit_rollup(text, date, date);

CREATE FUNCTION public.load_profit_rollup(p_dimension text, p_from date, p_to date)
RETURNS TABLE(
  key_id uuid, key_name text,
  load_count bigint, leg_count bigint,
  realized_loads bigint, booked_loads bigint,
  active_days bigint,
  total_miles numeric, realized_revenue numeric, projected_revenue numeric,
  realized_rpm numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
           count(DISTINCT load_id) FILTER (WHERE NOT is_projected) AS realized_loads,
           count(DISTINCT load_id) FILTER (WHERE is_projected)     AS booked_loads,
           count(DISTINCT delivery_date) FILTER (WHERE NOT is_projected) AS active_days,
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
END $function$;

GRANT EXECUTE ON FUNCTION public.load_profit_rollup(text, date, date) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
