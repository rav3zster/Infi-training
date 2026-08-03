-- ============================================================================
-- 0003_tombstones.sql
-- ----------------------------------------------------------------------------
-- Adds soft-delete (tombstone) support to daily_logs and study_sessions.
-- Allows log & session deletions to propagate seamlessly across devices.
-- ============================================================================

BEGIN;

-- Add deleted_at timestamptz columns
ALTER TABLE public.daily_logs
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.study_sessions
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Create partial indexes for fast non-deleted row queries
CREATE INDEX IF NOT EXISTS idx_daily_logs_deleted_at
  ON public.daily_logs (user_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_study_sessions_deleted_at
  ON public.study_sessions (user_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN public.daily_logs.deleted_at IS
  'Soft-delete timestamp (tombstone). Non-null means deleted.';
COMMENT ON COLUMN public.study_sessions.deleted_at IS
  'Soft-delete timestamp (tombstone). Non-null means deleted.';

COMMIT;
