-- Driver statuses: rename "On Leave" -> "Vacation" and add Lead, Pre-hire,
-- Suspended. on_leave was unused (0 rows), so the migration is a clean swap.
UPDATE public.drivers SET current_status = 'vacation' WHERE current_status = 'on_leave';

ALTER TABLE public.drivers DROP CONSTRAINT drivers_current_status_check;
ALTER TABLE public.drivers ADD CONSTRAINT drivers_current_status_check
  CHECK (current_status = ANY (ARRAY[
    'lead'::text, 'pre_hire'::text, 'active'::text, 'vacation'::text,
    'suspended'::text, 'inactive'::text, 'terminated'::text, 'archived'::text
  ]));
