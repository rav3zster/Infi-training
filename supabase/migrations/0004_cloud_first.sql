-- ============================================================================
-- 0004_cloud_first.sql — Pure Supabase Cloud-First Migration
-- ----------------------------------------------------------------------------
-- Removes local sync overhead and provides atomic RPC primitives for instant
-- cross-device realtime synchronization.
-- ============================================================================

BEGIN;

-- 1. Enable REPLICA IDENTITY FULL for table changes so Realtime DELETE/UPDATE
-- events carry full row payloads to all connected devices.
ALTER TABLE public.topic_progress      REPLICA IDENTITY FULL;
ALTER TABLE public.assessment_progress REPLICA IDENTITY FULL;
ALTER TABLE public.daily_logs          REPLICA IDENTITY FULL;
ALTER TABLE public.study_sessions      REPLICA IDENTITY FULL;
ALTER TABLE public.settings            REPLICA IDENTITY FULL;

-- 2. One-shot startup snapshot function: returns the complete user dataset in
-- a single SQL query round-trip.
CREATE OR REPLACE FUNCTION public.get_user_snapshot()
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT jsonb_build_object(
    'profile',  (SELECT to_jsonb(p) FROM public.profiles p WHERE p.user_id = auth.uid()),
    'settings', (SELECT to_jsonb(s) FROM public.settings s WHERE s.user_id = auth.uid()),
    'topic_progress', COALESCE((
        SELECT jsonb_agg(to_jsonb(t))
        FROM public.topic_progress t
        WHERE t.user_id = auth.uid()
      ), '[]'::jsonb),
    'assessment_progress', COALESCE((
        SELECT jsonb_agg(to_jsonb(a))
        FROM public.assessment_progress a
        WHERE a.user_id = auth.uid()
      ), '[]'::jsonb),
    'daily_logs', COALESCE((
        SELECT jsonb_agg(to_jsonb(d) ORDER BY d.study_date)
        FROM public.daily_logs d
        WHERE d.user_id = auth.uid()
      ), '[]'::jsonb),
    'study_sessions', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.study_date)
        FROM public.study_sessions x
        WHERE x.user_id = auth.uid()
      ), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION public.get_user_snapshot() IS
  'Returns all user progress, logs, sessions, profiles, and settings as a single JSON object.';

-- 3. Atomic Log Work RPC: inserts log + updates subtopic hours in a single transaction.
CREATE OR REPLACE FUNCTION public.log_work(
  p_client_id     text,
  p_subtopic_id   text,
  p_subtopic_name text,
  p_hours         numeric,
  p_study_date    date DEFAULT CURRENT_DATE,
  p_source        text DEFAULT 'timer'
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  INSERT INTO public.daily_logs (user_id, client_id, study_date, subtopic_id, subtopic_name, hours, source)
  VALUES (auth.uid(), p_client_id, p_study_date, p_subtopic_id, p_subtopic_name, p_hours, p_source)
  ON CONFLICT (user_id, client_id) DO UPDATE
    SET hours = EXCLUDED.hours,
        subtopic_id = EXCLUDED.subtopic_id,
        subtopic_name = EXCLUDED.subtopic_name,
        study_date = EXCLUDED.study_date;

  INSERT INTO public.topic_progress (user_id, subtopic_id, hours_spent, last_studied_at)
  VALUES (auth.uid(), p_subtopic_id, p_hours, p_study_date)
  ON CONFLICT (user_id, subtopic_id) DO UPDATE
    SET hours_spent     = public.topic_progress.hours_spent + EXCLUDED.hours_spent,
        last_studied_at = GREATEST(public.topic_progress.last_studied_at, EXCLUDED.last_studied_at);
END;
$$;

COMMENT ON FUNCTION public.log_work(text, text, text, numeric, date, text) IS
  'Atomically logs study hours and updates topic progress rollup.';

-- 4. Atomic Reset User Data RPC.
CREATE OR REPLACE FUNCTION public.reset_user_data(p_scope text DEFAULT 'all')
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  IF p_scope IN ('all', 'syllabus', 'progress') THEN
    DELETE FROM public.topic_progress      WHERE user_id = auth.uid();
    DELETE FROM public.assessment_progress WHERE user_id = auth.uid();
  END IF;
  IF p_scope IN ('all', 'logs') THEN
    DELETE FROM public.daily_logs     WHERE user_id = auth.uid();
    DELETE FROM public.study_sessions WHERE user_id = auth.uid();
  END IF;
  IF p_scope = 'all' THEN
    DELETE FROM public.study_events   WHERE user_id = auth.uid();
    DELETE FROM public.settings       WHERE user_id = auth.uid();
  END IF;
END;
$$;

COMMENT ON FUNCTION public.reset_user_data(text) IS
  'Atomically wipes user data in Supabase (scope: all, syllabus, logs).';

COMMIT;
