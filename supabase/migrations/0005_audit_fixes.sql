-- ============================================================================
-- 0005_audit_fixes.sql — Production Readiness Audit Fixes
-- ----------------------------------------------------------------------------
-- 1. Relaxes start_time/end_time NOT NULL on study_sessions for wall-clock free entries.
-- 2. Expands source CHECK constraints to allow 'manual' entries across daily_logs and study_sessions.
-- 3. Upgrades log_work RPC to write study_sessions atomically alongside daily_logs,
--    and derives topic_progress rollup from actual SUM(daily_logs.hours) to prevent double-counting.
-- 4. Drops legacy unused tables (sync_queue, device_info, app_meta).
-- ============================================================================

BEGIN;

-- 1. Relax NOT NULL constraints on study_sessions clock times
ALTER TABLE public.study_sessions ALTER COLUMN start_time DROP NOT NULL;
ALTER TABLE public.study_sessions ALTER COLUMN end_time DROP NOT NULL;

-- 2. Allow 'manual' in source CHECK constraints
ALTER TABLE public.daily_logs DROP CONSTRAINT IF EXISTS daily_logs_source_check;
ALTER TABLE public.daily_logs ADD CONSTRAINT daily_logs_source_check CHECK (source IN ('timer', 'completion', 'manual'));

ALTER TABLE public.study_sessions DROP CONSTRAINT IF EXISTS study_sessions_source_check;
ALTER TABLE public.study_sessions ADD CONSTRAINT study_sessions_source_check CHECK (source IN ('timer', 'completion', 'manual'));

-- 3. Upgrade log_work RPC to handle atomic multi-table study session & log writes without double-counting rollup
CREATE OR REPLACE FUNCTION public.log_work(
  p_client_id     text,
  p_subtopic_id   text,
  p_subtopic_name text,
  p_hours         numeric,
  p_study_date    date DEFAULT CURRENT_DATE,
  p_source        text DEFAULT 'timer',
  p_module_name   text DEFAULT NULL,
  p_session_type  text DEFAULT 'learning'
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  -- 3.1 Insert / Update daily_logs
  INSERT INTO public.daily_logs (user_id, client_id, study_date, subtopic_id, subtopic_name, hours, source)
  VALUES (auth.uid(), p_client_id, p_study_date, p_subtopic_id, p_subtopic_name, p_hours, p_source)
  ON CONFLICT (user_id, client_id) DO UPDATE
    SET hours         = EXCLUDED.hours,
        subtopic_id   = EXCLUDED.subtopic_id,
        subtopic_name = EXCLUDED.subtopic_name,
        study_date    = EXCLUDED.study_date,
        source        = EXCLUDED.source,
        updated_at    = now();

  -- 3.2 Insert / Update study_sessions
  INSERT INTO public.study_sessions (user_id, client_id, study_date, subtopic_id, subtopic_name, module_name, duration_hours, type, source)
  VALUES (auth.uid(), p_client_id, p_study_date, p_subtopic_id, p_subtopic_name, p_module_name, p_hours, p_session_type, p_source)
  ON CONFLICT (user_id, client_id) DO UPDATE
    SET duration_hours = EXCLUDED.duration_hours,
        subtopic_id    = EXCLUDED.subtopic_id,
        subtopic_name  = EXCLUDED.subtopic_name,
        module_name    = EXCLUDED.module_name,
        study_date     = EXCLUDED.study_date,
        type           = EXCLUDED.type,
        source         = EXCLUDED.source,
        updated_at     = now();

  -- 3.3 Topic progress rollup — derive from SUM(daily_logs.hours) to prevent double-counting race condition
  IF p_subtopic_id IS NOT NULL THEN
    INSERT INTO public.topic_progress (user_id, subtopic_id, hours_spent, last_studied_at)
    VALUES (
      auth.uid(),
      p_subtopic_id,
      (SELECT COALESCE(SUM(hours), 0) FROM public.daily_logs WHERE user_id = auth.uid() AND subtopic_id = p_subtopic_id),
      p_study_date
    )
    ON CONFLICT (user_id, subtopic_id) DO UPDATE
      SET hours_spent     = (SELECT COALESCE(SUM(hours), 0) FROM public.daily_logs WHERE user_id = auth.uid() AND subtopic_id = p_subtopic_id),
          last_studied_at = GREATEST(public.topic_progress.last_studied_at, EXCLUDED.last_studied_at),
          updated_at      = now();
  END IF;
END;
$$;

COMMENT ON FUNCTION public.log_work(text, text, text, numeric, date, text, text, text) IS
  'Atomically logs study hours across daily_logs and study_sessions, and derives accurate topic progress rollup.';

-- 4. Clean up legacy tables from pre-cloud architecture
DROP TABLE IF EXISTS public.sync_queue CASCADE;
DROP TABLE IF EXISTS public.device_info CASCADE;
DROP TABLE IF EXISTS public.app_meta CASCADE;

COMMIT;
