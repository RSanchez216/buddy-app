-- Convert structured co_driver_ids → free-form notes annotation, then
-- drop the column. The structured field implied concurrent ownership
-- but the actual semantics were sequential payers (different drivers
-- paying into the same contract over time) — that's history, not state.
--
-- Pre-flight (verified via MCP): 19 records have non-empty
-- co_driver_ids. v_driver_purchase_summary does NOT reference the
-- column, so no view rebuild needed.

BEGIN;

UPDATE driver_purchases dp
SET
  notes = CASE
    WHEN dp.notes IS NULL OR trim(dp.notes) = ''
      THEN 'Other drivers associated with this contract (per ClickUp import): ' || expanded.co_driver_list
    ELSE dp.notes || E'\n\nOther drivers associated with this contract (per ClickUp import): ' || expanded.co_driver_list
  END,
  updated_at = now()
FROM (
  SELECT
    dp_inner.id,
    string_agg(
      d.full_name || COALESCE(' (#' || d.internal_id || ')', ''),
      ', '
      ORDER BY ord
    ) AS co_driver_list
  FROM driver_purchases dp_inner
  CROSS JOIN LATERAL unnest(dp_inner.co_driver_ids) WITH ORDINALITY AS u(driver_id, ord)
  JOIN drivers d ON d.id = u.driver_id
  WHERE array_length(dp_inner.co_driver_ids, 1) > 0
  GROUP BY dp_inner.id
) AS expanded
WHERE dp.id = expanded.id;

ALTER TABLE driver_purchases DROP COLUMN co_driver_ids;

COMMIT;
