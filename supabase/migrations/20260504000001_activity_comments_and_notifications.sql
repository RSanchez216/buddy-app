-- Phase 2C — Activity feed comments + notifications
-- Idempotent. Adds:
--   • driver_purchase_comments
--   • comment_attachments
--   • notifications
--   • mentions_user_ids on driver_purchase_events
--   • v_driver_purchase_activity (events ∪ comments)
--   • notify_on_comment_mention trigger
--   • comment-attachments storage bucket
--   • RLS on all new tables (public.users.id == auth.users.id, so we resolve
--     mentioner names from public.users since raw_user_meta_data is unreliable)

-- ── 1. Comments ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_purchase_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_purchase_id uuid NOT NULL REFERENCES driver_purchases(id) ON DELETE CASCADE,

  body_json jsonb NOT NULL,
  body_text text NOT NULL,

  mentioned_user_ids uuid[] NOT NULL DEFAULT '{}',

  edited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id),

  deleted_at timestamptz,
  deleted_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_dpc_purchase ON driver_purchase_comments (driver_purchase_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dpc_mentions ON driver_purchase_comments USING gin (mentioned_user_ids);

-- ── 2. Comment attachments ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comment_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES driver_purchase_comments(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_name text NOT NULL,
  file_size_bytes bigint,
  content_type text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_ca_comment ON comment_attachments (comment_id);

-- ── 3. Notifications ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  notification_type text NOT NULL,
  title text NOT NULL,
  body text,

  link_url text,

  source_type text,
  source_id uuid,

  read_at timestamptz,
  email_pending boolean NOT NULL DEFAULT false,
  email_sent_at timestamptz,
  telegram_pending boolean NOT NULL DEFAULT false,
  telegram_sent_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_notif_recipient_unread
  ON notifications (recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notif_recipient_all
  ON notifications (recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_email_pending
  ON notifications (created_at)
  WHERE email_pending = true AND email_sent_at IS NULL;

-- ── 4. mentions_user_ids on events ──────────────────────────────────────
ALTER TABLE driver_purchase_events
  ADD COLUMN IF NOT EXISTS mentions_user_ids uuid[] NOT NULL DEFAULT '{}';

-- ── 5. Unified activity view ────────────────────────────────────────────
CREATE OR REPLACE VIEW v_driver_purchase_activity AS
  SELECT
    e.id,
    e.driver_purchase_id,
    'event'::text AS activity_type,
    e.event_type,
    e.description AS body_text,
    NULL::jsonb AS body_json,
    e.metadata,
    e.mentions_user_ids,
    e.created_by,
    u.email AS created_by_email,
    u.full_name AS created_by_name,
    e.occurred_at AS at,
    NULL::timestamptz AS edited_at,
    NULL::timestamptz AS deleted_at,
    NULL::uuid AS deleted_by,
    false AS is_deleted,
    '[]'::jsonb AS attachments
  FROM driver_purchase_events e
  LEFT JOIN public.users u ON u.id = e.created_by

  UNION ALL

  SELECT
    c.id,
    c.driver_purchase_id,
    'comment'::text AS activity_type,
    NULL::text AS event_type,
    c.body_text,
    c.body_json,
    NULL::jsonb AS metadata,
    c.mentioned_user_ids AS mentions_user_ids,
    c.created_by,
    u.email AS created_by_email,
    u.full_name AS created_by_name,
    c.created_at AS at,
    c.edited_at,
    c.deleted_at,
    c.deleted_by,
    (c.deleted_at IS NOT NULL) AS is_deleted,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                 'id', a.id,
                 'file_path', a.file_path,
                 'file_name', a.file_name,
                 'file_size_bytes', a.file_size_bytes,
                 'content_type', a.content_type
               ) ORDER BY a.uploaded_at)
       FROM comment_attachments a WHERE a.comment_id = c.id),
      '[]'::jsonb
    ) AS attachments
  FROM driver_purchase_comments c
  LEFT JOIN public.users u ON u.id = c.created_by;

GRANT SELECT ON v_driver_purchase_activity TO authenticated;

-- ── 6. Storage bucket: comment-attachments ──────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('comment-attachments', 'comment-attachments', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS comment_attach_select ON storage.objects;
DROP POLICY IF EXISTS comment_attach_insert ON storage.objects;
DROP POLICY IF EXISTS comment_attach_update ON storage.objects;
DROP POLICY IF EXISTS comment_attach_delete ON storage.objects;

CREATE POLICY comment_attach_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'comment-attachments');

CREATE POLICY comment_attach_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'comment-attachments');

CREATE POLICY comment_attach_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'comment-attachments');

CREATE POLICY comment_attach_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'comment-attachments');

-- ── 7. RLS ─────────────────────────────────────────────────────────────
ALTER TABLE driver_purchase_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Comments
DROP POLICY IF EXISTS dpc_select_auth ON driver_purchase_comments;
DROP POLICY IF EXISTS dpc_insert_self ON driver_purchase_comments;
DROP POLICY IF EXISTS dpc_update_own_5min ON driver_purchase_comments;
DROP POLICY IF EXISTS dpc_softdelete_own_or_admin ON driver_purchase_comments;

CREATE POLICY dpc_select_auth ON driver_purchase_comments
  FOR SELECT TO authenticated USING (true);

-- Insert: only as yourself (created_by must equal auth.uid())
CREATE POLICY dpc_insert_self ON driver_purchase_comments
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Update: own comments, within 5-minute edit window, not yet deleted.
-- (Soft-delete uses this policy too, so we permit it as well.)
CREATE POLICY dpc_update_own_5min ON driver_purchase_comments
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    AND deleted_at IS NULL
    AND created_at > now() - interval '5 minutes'
  )
  WITH CHECK (created_by = auth.uid());

-- A separate update policy permits soft-delete by author (any time) or
-- admin (any time). This stacks via OR with the 5-min edit policy.
CREATE POLICY dpc_softdelete_own_or_admin ON driver_purchase_comments
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );

-- Comment attachments
DROP POLICY IF EXISTS ca_select_auth ON comment_attachments;
DROP POLICY IF EXISTS ca_insert_self ON comment_attachments;
DROP POLICY IF EXISTS ca_delete_own ON comment_attachments;

CREATE POLICY ca_select_auth ON comment_attachments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY ca_insert_self ON comment_attachments
  FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY ca_delete_own ON comment_attachments
  FOR DELETE TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM driver_purchase_comments c
      WHERE c.id = comment_attachments.comment_id
        AND (c.created_by = auth.uid()
             OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
    )
  );

-- Notifications: only see/update your own. Inserts come exclusively from
-- SECURITY DEFINER trigger functions; deny direct client INSERTs.
DROP POLICY IF EXISTS notif_select_own ON notifications;
DROP POLICY IF EXISTS notif_update_own ON notifications;

CREATE POLICY notif_select_own ON notifications
  FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid());

CREATE POLICY notif_update_own ON notifications
  FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid())
  WITH CHECK (recipient_user_id = auth.uid());
-- (no insert policy → clients cannot insert; trigger uses SECURITY DEFINER)

-- ── 8. Mention-notification trigger ─────────────────────────────────────
CREATE OR REPLACE FUNCTION notify_on_comment_mention()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  mentioned_id uuid;
  mentioner_name text;
  purchase_label text;
BEGIN
  IF NEW.mentioned_user_ids IS NULL OR array_length(NEW.mentioned_user_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(full_name, email) INTO mentioner_name
  FROM public.users WHERE id = NEW.created_by;

  SELECT
    COALESCE(d.full_name, '?') || COALESCE(' — Truck ' || dp.truck_number, '')
  INTO purchase_label
  FROM driver_purchases dp
  LEFT JOIN drivers d ON d.id = dp.driver_id
  WHERE dp.id = NEW.driver_purchase_id;

  FOREACH mentioned_id IN ARRAY NEW.mentioned_user_ids
  LOOP
    IF mentioned_id <> NEW.created_by THEN
      INSERT INTO notifications (
        recipient_user_id, notification_type, title, body,
        link_url, source_type, source_id,
        email_pending, metadata
      ) VALUES (
        mentioned_id,
        'mention',
        COALESCE(mentioner_name, 'Someone') || ' mentioned you on ' || COALESCE(purchase_label, 'a driver purchase'),
        LEFT(NEW.body_text, 200),
        '/financial-controls/driver-purchases/' || NEW.driver_purchase_id::text || '?comment=' || NEW.id::text,
        'comment',
        NEW.id,
        true,
        jsonb_build_object(
          'mentioner_user_id', NEW.created_by,
          'mentioner_name', mentioner_name,
          'purchase_id', NEW.driver_purchase_id
        )
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_comment_mention ON driver_purchase_comments;
CREATE TRIGGER trg_notify_comment_mention
  AFTER INSERT ON driver_purchase_comments
  FOR EACH ROW EXECUTE FUNCTION notify_on_comment_mention();
