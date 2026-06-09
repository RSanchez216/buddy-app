-- Profitability Calendar: surface origin / destination city-state labels on
-- v_load_leg_profit so the calendar grid reads one source. Extracted from
-- loads.pu_info / loads.del_info: "City, ST, US (TZ) date time ..." →
-- "City, ST". Appended columns; no data change.

DROP VIEW IF EXISTS public.v_load_leg_profit;

CREATE VIEW public.v_load_leg_profit AS
WITH legs AS (
  SELECT ll.id, ll.load_id, ll.leg_seq, ll.driver_raw, ll.truck_raw,
         ll.trailer_raw, ll.driver_id, ll.truck_id, ll.trailer_id,
         ll.empty_miles, ll.loaded_miles, ll.total_miles,
         ll.last_imported_at, ll.created_at, ll.updated_at,
         ll.revenue_amount,
         count(*) OVER (PARTITION BY ll.load_id) AS leg_count
  FROM public.load_legs ll
)
SELECT l.id AS load_id,
    l.load_number,
    ll.id AS leg_id,
    ll.leg_seq,
    l.is_team_load,
    ll.leg_count,
    l.status,
    l.status ILIKE 'booked' AS is_projected,
    l.pickup_date,
    l.delivery_date,
    l.dispatcher_id,
    d.name AS dispatcher_name,
    l.customer_id,
    c.name AS customer_name,
    l.carrier_id,
    ca.name AS carrier_name,
    ll.driver_id,
    dr.full_name AS driver_name,
    ll.driver_raw,
    COALESCE(dr.full_name, ll.driver_raw) AS driver_display,
    ll.truck_id,
    tk.unit_number AS truck_unit,
    ll.truck_raw,
    COALESCE(tk.unit_number, ll.truck_raw) AS truck_display,
    ll.trailer_id,
    tl.unit_number AS trailer_unit,
    ll.trailer_raw,
    COALESCE(tl.unit_number, ll.trailer_raw) AS trailer_display,
    l.linehaul,
    COALESCE(ll.revenue_amount,
        CASE WHEN ll.leg_count = 1 THEN l.linehaul
             ELSE l.linehaul / ll.leg_count::numeric
        END) AS leg_revenue,
    ll.total_miles AS leg_total_miles,
    ll.loaded_miles AS leg_loaded_miles,
    ll.empty_miles AS leg_empty_miles,
    nullif(btrim(split_part(l.pu_info,  ', US', 1)), '') AS origin,
    nullif(btrim(split_part(l.del_info, ', US', 1)), '') AS destination
FROM legs ll
  JOIN public.loads l ON l.id = ll.load_id
  LEFT JOIN public.dispatchers d ON d.id = l.dispatcher_id
  LEFT JOIN public.customers c ON c.id = l.customer_id
  LEFT JOIN public.carriers ca ON ca.id = l.carrier_id
  LEFT JOIN public.drivers dr ON dr.id = ll.driver_id
  LEFT JOIN public.trucks tk ON tk.id = ll.truck_id
  LEFT JOIN public.trailers tl ON tl.id = ll.trailer_id
WHERE l.status NOT ILIKE 'canceled';

GRANT SELECT ON public.v_load_leg_profit TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
