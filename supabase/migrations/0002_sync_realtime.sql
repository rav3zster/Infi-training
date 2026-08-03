-- ============================================================================
-- 0002_sync_realtime.sql
-- ----------------------------------------------------------------------------
-- Sync upgrade (Phase 3 refinements): device identity, sync versioning,
-- revision-queue upsert key, and Supabase Realtime publication membership.
--
-- What this migration does:
--   1. Adds `device_id` (text) + `sync_version` (integer, default 1) to every
--      synced user-data table so the client can stamp which device wrote a row
--      and which sync protocol produced it (LWW metadata).
--   2. Adds a UNIQUE (user_id, subtopic_id) key on `revision_queue` so the
--      Sync Engine can idempotently upsert revision rows.
--   3. Registers the user-data tables on the `supabase_realtime` publication
--      so Realtime delivers INSERT/UPDATE/DELETE events to online devices.
--   4. Deduplicates existing `backups` rows (pre-0002 plain-insert fallback
--      could create duplicate (user_id, name) rows) BEFORE creating the
--      backup unique key, so the index can always be built.
--
-- Idempotent: every statement uses IF NOT EXISTS / existence checks, safe to
-- run again. Transactional: BEGIN/COMMIT.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. DEVICE IDENTITY + SYNC VERSION COLUMNS
-- ────────────────────────────────────────────────────────────────────────────
-- `device_id`    — which device last wrote this row (LWW provenance).
-- `sync_version` — the sync protocol version that produced it (wire-format guard).
-- Both are stamped by the client at upload time; the server never overrides them.

ALTER TABLE public.topic_progress
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS sync_version integer NOT NULL DEFAULT 1;

ALTER TABLE public.assessment_progress
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS sync_version integer NOT NULL DEFAULT 1;

ALTER TABLE public.daily_logs
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS sync_version integer NOT NULL DEFAULT 1;

ALTER TABLE public.study_sessions
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS sync_version integer NOT NULL DEFAULT 1;

ALTER TABLE public.study_events
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS sync_version integer NOT NULL DEFAULT 1;

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS sync_version integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.topic_progress.device_id IS
  'Device that last wrote this row (LWW provenance). Stamped by the client.';
COMMENT ON COLUMN public.topic_progress.sync_version IS
  'Sync protocol version that produced this row.';
COMMENT ON COLUMN public.assessment_progress.device_id IS
  'Device that last wrote this row (LWW provenance). Stamped by the client.';
COMMENT ON COLUMN public.assessment_progress.sync_version IS
  'Sync protocol version that produced this row.';
COMMENT ON COLUMN public.daily_logs.device_id IS
  'Device that last wrote this row (LWW provenance). Stamped by the client.';
COMMENT ON COLUMN public.daily_logs.sync_version IS
  'Sync protocol version that produced this row.';
COMMENT ON COLUMN public.study_sessions.device_id IS
  'Device that last wrote this row (LWW provenance). Stamped by the client.';
COMMENT ON COLUMN public.study_sessions.sync_version IS
  'Sync protocol version that produced this row.';
COMMENT ON COLUMN public.study_events.device_id IS
  'Device that recorded this event. Stamped by the client.';
COMMENT ON COLUMN public.study_events.sync_version IS
  'Sync protocol version that produced this row.';
COMMENT ON COLUMN public.settings.device_id IS
  'Device that last wrote these settings (LWW provenance).';
COMMENT ON COLUMN public.settings.sync_version IS
  'Sync protocol version that produced this row.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. REVISION QUEUE + BACKUP UPSERT KEYS
-- ────────────────────────────────────────────────────────────────────────────
-- revision_queue currently has only a PK (id). The Sync Engine needs a stable
-- natural key to upsert idempotently (one revision row per (user, subtopic)).

CREATE UNIQUE INDEX IF NOT EXISTS uq_revision_queue_user_subtopic
  ON public.revision_queue (user_id, subtopic_id);

COMMENT ON INDEX public.uq_revision_queue_user_subtopic IS
  'One revision row per (user, subtopic) — natural key for idempotent sync upserts.';

-- One automatic cloud backup per (user, day) — the Sync Engine upserts on
-- this key so a crash between insert and stats.save can never duplicate a
-- same-day snapshot.
--
-- DEDUPE FIRST: the pre-0002 client fallback used a plain INSERT, so a crash
-- between the insert and the stats.save — or two devices — could leave
-- duplicate (user_id, name) rows (e.g. two rows named 'auto-2026-08-02'). The
-- unique index below cannot be created while duplicates exist, so remove the
-- older copies first, keeping exactly the newest row per (user_id, name).
-- Idempotent: no-op when no duplicates are present.
DELETE FROM public.backups a
USING public.backups b
WHERE a.user_id = b.user_id
  AND a.name = b.name
  AND (
    a.created_at < b.created_at
    OR (a.created_at = b.created_at AND a.id::text < b.id::text)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_backups_user_name
  ON public.backups (user_id, name);

COMMENT ON INDEX public.uq_backups_user_name IS
  'One cloud backup per (user, name) — idempotent daily snapshot upserts.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. REALTIME PUBLICATION MEMBERSHIP
-- ────────────────────────────────────────────────────────────────────────────
-- Add the user-data tables to the default `supabase_realtime` publication so
-- online devices receive INSERT/UPDATE/DELETE events. Idempotent: only tables
-- that are not already members are added.

DO $$
DECLARE
  t text;
BEGIN
  -- Ensure the publication exists (Supabase ships it by default; be safe).
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  FOREACH t IN ARRAY ARRAY[
    'topic_progress','assessment_progress','daily_logs',
    'study_sessions','study_events','settings','revision_queue'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. VALIDATION (read-only — safe to run after migration)
-- ────────────────────────────────────────────────────────────────────────────

-- 4.1 New columns exist on every synced table
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('device_id','sync_version')
ORDER BY table_name, column_name;

-- 4.2 Revision queue + backup natural keys exist
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public' AND indexname IN ('uq_revision_queue_user_subtopic', 'uq_backups_user_name');

-- 4.3 Realtime publication membership
SELECT schemaname, tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
ORDER BY tablename;

-- 4.4 No duplicate (user_id, name) pairs remain in backups (must be zero rows)
SELECT user_id, name, count(*) AS n
FROM public.backups
GROUP BY user_id, name
HAVING count(*) > 1;

COMMIT;
