-- Enable Supabase Realtime publication for tables that
-- ActivityFeed and NotificationBell subscribe to via postgres_changes.
-- Idempotent: ALTER PUBLICATION ADD TABLE errors if already present,
-- so each statement is wrapped to swallow duplicate_object.
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  EXCEPTION WHEN duplicate_object THEN NULL; END;

  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE driver_purchase_comments;
  EXCEPTION WHEN duplicate_object THEN NULL; END;

  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE driver_purchase_events;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
