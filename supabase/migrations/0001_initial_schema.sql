-- ============================================================================
-- 0001_initial_schema.sql
-- ----------------------------------------------------------------------------
-- Training Tracker — Supabase PostgreSQL bootstrap migration
--
-- Mirrors the application's TypeScript models (src/types.ts) 1:1.
--   • Curriculum entities (modules / topics / subtopics / assessments) are
--     STATIC, shared seed data — their PKs are the stable client ids
--     ('m1', 'm2-t1', 'm2-t1-s1', 'm2-quiz-1', …) so the app never remaps.
--   • User data (progress, sessions, logs, events, …) is UUID-keyed with a
--     `client_id` column preserving the client-generated identity for sync.
--   • The Adaptive Study Load Engine is COMPUTATION-ONLY. Dashboard, forecast,
--     analytics, heatmap, readiness etc. are NEVER stored — they are derived
--     in the app from the raw facts below.
--   • RLS is enabled on every table; single-user app, so every policy scopes
--     to auth.uid() = user_id.
--
-- Safe to run in the Supabase SQL Editor in a single pass.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. EXTENSIONS
-- ────────────────────────────────────────────────────────────────────────────
-- pgcrypto supplies gen_random_uuid() (also built-in since PG13).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. HELPER: updated_at maintenance function
-- ────────────────────────────────────────────────────────────────────────────
-- Generic trigger function: stamps NEW.updated_at = now() on every UPDATE.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at() IS
  'Trigger function that sets updated_at = now() before any UPDATE. Attached to every table that owns an updated_at column.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. TABLES (dependency order)
-- ────────────────────────────────────────────────────────────────────────────

-- 2.1 profiles ---------------------------------------------------------------
-- One row per auth user. The app is single-user; the row is auto-created by the
-- client on first boot. joining_date = roadmap start (the app's JOINING_DATE).
CREATE TABLE IF NOT EXISTS public.profiles (
  user_id       uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name  text,
  joining_date  date NOT NULL,                 -- roadmap start date (JOINING_DATE in the app)
  timezone      text NOT NULL DEFAULT 'UTC',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profiles IS
  'User profile. Single-user app: exactly one row per auth.uid(), created silently on first boot.';

-- 2.2 modules -----------------------------------------------------------------
-- Static curriculum. id = client module id ('m1', 'm2', 'm3').
CREATE TABLE IF NOT EXISTS public.modules (
  id                 text PRIMARY KEY,          -- stable client id ('m1','m2','m3')
  name               text NOT NULL,             -- e.g. 'FA1 — Java Programming & OOPs'
  weight             numeric(5,2) NOT NULL DEFAULT 0 CHECK (weight >= 0),  -- module weighting
  phase              text,                      -- learning-phase label (e.g. 'Full Java Learning Path')
  phase_order        integer,                   -- ordering of phases across the roadmap
  curriculum_version integer NOT NULL DEFAULT 1,  -- bump to signal clients to re-download this module
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.modules IS
  'Static curriculum: learning modules. Never carries per-user state (progress lives in topic_progress).';

-- 2.3 topics ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.topics (
  id                  text PRIMARY KEY,          -- stable client id ('m2-t1', …)
  module_id           text NOT NULL REFERENCES public.modules (id) ON DELETE CASCADE,
  name                text NOT NULL,
  difficulty          text NOT NULL DEFAULT 'beginner'
    CHECK (difficulty IN ('beginner','beginner-intermediate','intermediate','intermediate-advanced','advanced')),
  estimated_hours     numeric(6,2) NOT NULL CHECK (estimated_hours > 0),  -- topic-level baseline estimate
  learning_objectives text[] NOT NULL DEFAULT '{}',  -- learning objectives list
  prerequisites       text[] NOT NULL DEFAULT '{}',  -- prerequisite topic ids (text ids; no FK possible on array)
  exercises           text[] NOT NULL DEFAULT '{}',  -- practical exercises list
  sort_order          integer NOT NULL DEFAULT 0,    -- ordering within the module
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.topics IS
  'Static curriculum: topics inside a module, with TopicMeta (difficulty, estimates, objectives, prerequisites, exercises).';

-- 2.4 subtopics ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subtopics (
  id                   text PRIMARY KEY,          -- stable client id ('m2-t1-s1', …)
  topic_id             text NOT NULL REFERENCES public.topics (id) ON DELETE CASCADE,
  name                 text NOT NULL,
  base_estimate_minutes integer CHECK (base_estimate_minutes > 0),  -- per-subtopic complexity estimate (minutes); NULL = legacy fallback
  sort_order           integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.subtopics IS
  'Static curriculum: atomic subtopics with per-subtopic complexity estimates (base_estimate_minutes). Completion state is NOT stored here — it lives in topic_progress.';

-- 2.5 assessments -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessments (
  id               text PRIMARY KEY,              -- stable client id ('m2-quiz-1', 'm2-mock', …)
  module_id        text NOT NULL REFERENCES public.modules (id) ON DELETE CASCADE,
  name             text NOT NULL,
  type             text NOT NULL
    CHECK (type IN ('quiz','revision','mini-project','mock','capstone')),
  estimated_hours  numeric(6,2) NOT NULL CHECK (estimated_hours > 0),
  description      text,
  prerequisites    text[] NOT NULL DEFAULT '{}',  -- prerequisite topic ids
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.assessments IS
  'Static curriculum: module assessments / revision checkpoints / mini-projects / mock / capstone. Per-user completion lives in assessment_progress.';

-- 2.6 topic_progress ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.topic_progress (
  user_id          uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  subtopic_id      text NOT NULL REFERENCES public.subtopics (id) ON DELETE CASCADE,
  completed        boolean NOT NULL DEFAULT false,
  hours_spent      numeric(6,2) NOT NULL DEFAULT 0 CHECK (hours_spent >= 0),  -- total hours logged against this subtopic
  last_studied_at  date,                          -- last date this subtopic was studied
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, subtopic_id)
);

COMMENT ON TABLE public.topic_progress IS
  'Per-user subtopic progress: completed flag, hours spent (actual time), last studied date. One row per (user, subtopic).';

-- 2.7 assessment_progress -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessment_progress (
  user_id           uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  assessment_id     text NOT NULL REFERENCES public.assessments (id) ON DELETE CASCADE,
  completed         boolean NOT NULL DEFAULT false,
  score             numeric(5,2) CHECK (score >= 0 AND score <= 100),  -- assessment score percent
  last_attempted_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, assessment_id)
);

COMMENT ON TABLE public.assessment_progress IS
  'Per-user assessment completion: completed flag, optional score (0–100), last attempt timestamp.';

-- 2.8 study_sessions ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.study_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      text NOT NULL,                   -- client-generated session id (sync identity)
  user_id        uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  study_date     date NOT NULL,
  start_time     time NOT NULL,
  end_time       time NOT NULL,
  duration_hours numeric(6,2) NOT NULL CHECK (duration_hours >= 0),
  type           text NOT NULL
    CHECK (type IN ('learning','coding','revision','mock','project','break')),
  subtopic_id    text REFERENCES public.subtopics (id) ON DELETE SET NULL,  -- SET NULL: curriculum edits never destroy history
  subtopic_name  text,                             -- denormalized snapshot (curriculum may change)
  module_name    text,                             -- denormalized snapshot
  notes          text,
  source         text CHECK (source IN ('timer','completion')),  -- how the time was recorded
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_sessions_client_uniq UNIQUE (user_id, client_id)
);

COMMENT ON TABLE public.study_sessions IS
  'Raw study sessions (timer logging). One row per session; duration_hours is the recorded actual time.';

-- 2.9 daily_logs --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      text NOT NULL,                   -- client-generated log id (sync identity)
  user_id        uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  study_date     date NOT NULL,
  subtopic_id    text REFERENCES public.subtopics (id) ON DELETE SET NULL,
  subtopic_name  text,                             -- denormalized snapshot
  hours          numeric(6,2) NOT NULL CHECK (hours >= 0),
  source         text CHECK (source IN ('timer','completion')),  -- 'timer' or auto-credit on completion
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_logs_client_uniq UNIQUE (user_id, client_id)
);

COMMENT ON TABLE public.daily_logs IS
  'Per-day study hours entries (the raw facts behind streaks, heatmap, distributions, average daily hours).';

-- 2.10 study_events -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.study_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   text NOT NULL,                      -- client-generated event id (sync identity)
  user_id     uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  type        text NOT NULL
    CHECK (type IN (
      'subtopic.completed','subtopic.uncompleted','timer.started','timer.stopped',
      'session.logged','assessment.completed','assessment.uncompleted','revision.done',
      'roadmap.reset','syllabus.reset','logs.reset','data.imported',
      'backup.created','backup.restored'
    )),
  entity_type text NOT NULL
    CHECK (entity_type IN ('subtopic','assessment','session','roadmap','system')),
  entity_id   text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb, -- free-form typed payload (hours, score, source, …)
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_events_client_uniq UNIQUE (user_id, client_id)
);

COMMENT ON TABLE public.study_events IS
  'Immutable, append-only event log — the substrate for future analytics, revision scheduling and AI coaching. Never updated, never feeds the engine.';

-- 2.11 revision_queue ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.revision_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  subtopic_id     text NOT NULL REFERENCES public.subtopics (id) ON DELETE CASCADE,
  state           text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','completed','skipped')),
  due_date        date NOT NULL,                   -- when the revision is due
  last_revised_at timestamptz,
  times_revised   integer NOT NULL DEFAULT 0 CHECK (times_revised >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.revision_queue IS
  'Spaced-repetition queue (future revision engine). Planned now so no schema migration is needed later.';

-- 2.12 settings ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.settings (
  user_id      uuid PRIMARY KEY REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  theme        text NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
  date_offset  integer NOT NULL DEFAULT 0,         -- simulated system-date offset (Presets screen)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.settings IS
  'Per-user app settings: theme and simulated date offset. One row per user.';

-- 2.13 sync_queue -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sync_queue (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  table_name       text NOT NULL,                  -- target table (e.g. 'daily_logs')
  record_client_id text NOT NULL,                  -- the client id of the affected record
  operation        text NOT NULL CHECK (operation IN ('insert','update','delete')),
  status           text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','uploading','uploaded','failed')),
  attempts         integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error       text,
  next_retry_at    timestamptz,                    -- exponential backoff scheduling
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sync_queue IS
  'Outbox for the Sync Engine: local changes awaiting upload, with retry state. Supports queue compression by (table_name, record_client_id).';

-- 2.14 device_info ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_info (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  device_name text NOT NULL,
  platform    text,                                -- e.g. 'android' | 'web'
  app_version text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_info_uniq UNIQUE (user_id, device_name)
);

COMMENT ON TABLE public.device_info IS
  'Registered devices per user, used by the sync engine for multi-device awareness and diagnostics.';

-- 2.15 backups ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.backups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  name        text NOT NULL,                       -- e.g. 'auto-2026-08-02'
  kind        text NOT NULL DEFAULT 'manual'
    CHECK (kind IN ('manual','auto','pre-import','pre-migration','pre-reset')),
  payload     jsonb NOT NULL,                      -- full portable export snapshot (USER_STORES)
  size_bytes  bigint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.backups IS
  'Manual and automatic backups (keep-latest-5 pruning is client policy). Cloud copy for recovery across devices.';

-- 2.16 app_meta ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_meta (
  id                   integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- single-row singleton
  schema_version       integer NOT NULL DEFAULT 1,                    -- database schema version
  curriculum_version   integer NOT NULL DEFAULT 1,                    -- curriculum data version
  sync_protocol_version integer NOT NULL DEFAULT 1,                   -- sync wire-protocol version
  app_version          text NOT NULL DEFAULT '0.4.0',                 -- application version
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_meta IS
  'Single-row version registry (schema / curriculum / sync protocol / app). Clients read it to decide what to download and whether the schema needs migration.';

-- 2.17 RESERVED: AI-layer tables (future-ready, unused today) ------------------
-- Reserved per the approved architecture so future AI coaching features need
-- no schema migration. Empty now; created to avoid ALTERs later.

CREATE TABLE IF NOT EXISTS public.ai_cache (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  cache_key  text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT ai_cache_uniq UNIQUE (user_id, cache_key)
);

COMMENT ON TABLE public.ai_cache IS 'Reserved: cached AI responses (future AI coach). Unused today.';

CREATE TABLE IF NOT EXISTS public.coach_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  role       text NOT NULL,                       -- e.g. 'user' | 'assistant' | 'system'
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.coach_messages IS 'Reserved: AI coach conversation history. Unused today.';

CREATE TABLE IF NOT EXISTS public.embeddings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  entity_type text NOT NULL,                      -- e.g. 'subtopic' | 'session'
  entity_id   text NOT NULL,
  vector      jsonb NOT NULL DEFAULT '{}'::jsonb, -- embedding vector (jsonb avoids a pgvector dependency for now)
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.embeddings IS 'Reserved: vector embeddings for semantic features. Unused today.';

CREATE TABLE IF NOT EXISTS public.recommendations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  kind       text NOT NULL,                       -- e.g. 'next-topic' | 'revision'
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

COMMENT ON TABLE public.recommendations IS 'Reserved: machine-generated study recommendations. Unused today.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. updated_at TRIGGERS
-- ────────────────────────────────────────────────────────────────────────────
-- Attach set_updated_at() to every table that owns an updated_at column.

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'updated_at'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t);
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. INDEXES (every important lookup)
-- ────────────────────────────────────────────────────────────────────────────

-- Curriculum lookups
CREATE INDEX IF NOT EXISTS idx_topics_module_id        ON public.topics (module_id);
CREATE INDEX IF NOT EXISTS idx_subtopics_topic_id      ON public.subtopics (topic_id);
CREATE INDEX IF NOT EXISTS idx_assessments_module_id   ON public.assessments (module_id);

-- Progress lookups
CREATE INDEX IF NOT EXISTS idx_topic_progress_subtopic    ON public.topic_progress (subtopic_id);
CREATE INDEX IF NOT EXISTS idx_topic_progress_completed   ON public.topic_progress (user_id, completed);
CREATE INDEX IF NOT EXISTS idx_assessment_progress_aid    ON public.assessment_progress (assessment_id);
CREATE INDEX IF NOT EXISTS idx_assessment_progress_done   ON public.assessment_progress (user_id, completed);

-- Sessions & logs: date-range scans, per-type and per-subtopic aggregates
CREATE INDEX IF NOT EXISTS idx_study_sessions_date   ON public.study_sessions (user_id, study_date DESC);
CREATE INDEX IF NOT EXISTS idx_study_sessions_type   ON public.study_sessions (user_id, type);
CREATE INDEX IF NOT EXISTS idx_study_sessions_sub    ON public.study_sessions (subtopic_id);
CREATE INDEX IF NOT EXISTS idx_daily_logs_date       ON public.daily_logs (user_id, study_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_logs_source     ON public.daily_logs (user_id, source);
CREATE INDEX IF NOT EXISTS idx_daily_logs_sub        ON public.daily_logs (subtopic_id);

-- Events: chronological replay + per-entity filtering
CREATE INDEX IF NOT EXISTS idx_study_events_occurred ON public.study_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_study_events_entity   ON public.study_events (user_id, entity_type, entity_id);

-- Revision queue
CREATE INDEX IF NOT EXISTS idx_revision_queue_due    ON public.revision_queue (user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_revision_queue_state  ON public.revision_queue (user_id, state);

-- Sync engine
CREATE INDEX IF NOT EXISTS idx_sync_queue_status     ON public.sync_queue (user_id, status);
CREATE INDEX IF NOT EXISTS idx_sync_queue_retry      ON public.sync_queue (user_id, status, next_retry_at);

-- Backups & devices
CREATE INDEX IF NOT EXISTS idx_backups_created       ON public.backups (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_info_seen      ON public.device_info (user_id, last_seen_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────
-- Single-user app: users may only touch rows where auth.uid() = user_id.
-- Curriculum tables are global read-only data (SELECT for authenticated users;
-- writes happen via the service role / edge functions, which bypass RLS).

ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modules             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topics              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subtopics           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topic_progress      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revision_queue      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_queue          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_info         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backups             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_meta            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_cache            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.embeddings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendations     ENABLE ROW LEVEL SECURITY;

-- ── Curriculum (read-only for the app) ──
DROP POLICY IF EXISTS "modules_read" ON public.modules;
CREATE POLICY "modules_read" ON public.modules FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "topics_read" ON public.topics;
CREATE POLICY "topics_read" ON public.topics FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "subtopics_read" ON public.subtopics;
CREATE POLICY "subtopics_read" ON public.subtopics FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "assessments_read" ON public.assessments;
CREATE POLICY "assessments_read" ON public.assessments FOR SELECT TO authenticated USING (true);

-- ── User-scoped tables (own rows only) ──
DROP POLICY IF EXISTS "profiles_own" ON public.profiles;
CREATE POLICY "profiles_own" ON public.profiles FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "topic_progress_own" ON public.topic_progress;
CREATE POLICY "topic_progress_own" ON public.topic_progress FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "assessment_progress_own" ON public.assessment_progress;
CREATE POLICY "assessment_progress_own" ON public.assessment_progress FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "study_sessions_own" ON public.study_sessions;
CREATE POLICY "study_sessions_own" ON public.study_sessions FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "daily_logs_own" ON public.daily_logs;
CREATE POLICY "daily_logs_own" ON public.daily_logs FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "study_events_own" ON public.study_events;
CREATE POLICY "study_events_own" ON public.study_events FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "revision_queue_own" ON public.revision_queue;
CREATE POLICY "revision_queue_own" ON public.revision_queue FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "settings_own" ON public.settings;
CREATE POLICY "settings_own" ON public.settings FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "sync_queue_own" ON public.sync_queue;
CREATE POLICY "sync_queue_own" ON public.sync_queue FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "device_info_own" ON public.device_info;
CREATE POLICY "device_info_own" ON public.device_info FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "backups_own" ON public.backups;
CREATE POLICY "backups_own" ON public.backups FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "app_meta_read" ON public.app_meta;
CREATE POLICY "app_meta_read" ON public.app_meta FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "ai_cache_own" ON public.ai_cache;
CREATE POLICY "ai_cache_own" ON public.ai_cache FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "coach_messages_own" ON public.coach_messages;
CREATE POLICY "coach_messages_own" ON public.coach_messages FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "embeddings_own" ON public.embeddings;
CREATE POLICY "embeddings_own" ON public.embeddings FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "recommendations_own" ON public.recommendations;
CREATE POLICY "recommendations_own" ON public.recommendations FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. READ-ONLY VIEWS (derived data only — nothing is stored)
-- ────────────────────────────────────────────────────────────────────────────
-- Views are SECURITY INVOKER by default: RLS on the base tables still applies,
-- so a user only ever sees their own rows.

-- 6.1 Full curriculum joined with the current user's progress
CREATE OR REPLACE VIEW public.v_curriculum_progress AS
SELECT
  m.id            AS module_id,
  m.name          AS module_name,
  m.phase,
  m.phase_order,
  t.id            AS topic_id,
  t.name          AS topic_name,
  t.difficulty,
  t.estimated_hours,
  s.id            AS subtopic_id,
  s.name          AS subtopic_name,
  s.base_estimate_minutes,
  tp.completed,
  tp.hours_spent,
  tp.last_studied_at
FROM public.modules m
JOIN public.topics t   ON t.module_id = m.id
JOIN public.subtopics s ON s.topic_id = t.id
LEFT JOIN public.topic_progress tp
  ON tp.subtopic_id = s.id AND tp.user_id = auth.uid();

COMMENT ON VIEW public.v_curriculum_progress IS
  'Read-only: full curriculum tree with the calling user''s per-subtopic progress. Derived, never stored.';

-- 6.2 Per-module progress rollup for the calling user
CREATE OR REPLACE VIEW public.v_module_progress AS
SELECT
  coalesce(tp.user_id, auth.uid()) AS user_id,
  m.id            AS module_id,
  m.name          AS module_name,
  m.weight,
  count(s.id)     AS total_subtopics,
  count(*) FILTER (WHERE tp.completed) AS completed_subtopics,
  coalesce(sum(tp.hours_spent), 0) AS hours_spent,
  coalesce(sum(t.estimated_hours), 0) AS estimated_hours
FROM public.modules m
JOIN public.topics t ON t.module_id = m.id
JOIN public.subtopics s ON s.topic_id = t.id
LEFT JOIN public.topic_progress tp
  ON tp.subtopic_id = s.id AND tp.user_id = auth.uid()
GROUP BY m.id, m.name, m.weight, tp.user_id;

COMMENT ON VIEW public.v_module_progress IS
  'Read-only: raw-fact module rollup (counts, hours) for the calling user. Engine math stays in the app.';

-- 6.3 Daily study summary for the calling user
CREATE OR REPLACE VIEW public.v_daily_summary AS
SELECT user_id, study_date, sum(hours) AS total_hours, count(*) AS entries
FROM public.daily_logs
GROUP BY user_id, study_date;

COMMENT ON VIEW public.v_daily_summary IS
  'Read-only: raw daily hours totals. Drives streaks/heatmap in the app.';

-- ────────────────────────────────────────────────────────────────────────────
-- 7. HELPER FUNCTION: append a study event (convenience for service tooling)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_study_event(
  p_user_id     uuid,
  p_type        text,
  p_entity_type text,
  p_entity_id   text,
  p_payload     jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.study_events (id, user_id, type, entity_type, entity_id, payload, occurred_at)
  VALUES (v_id, p_user_id, p_type, p_entity_type, p_entity_id, p_payload, now());
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.record_study_event(uuid, text, text, text, jsonb) IS
  'Appends an immutable study event row and returns its id. Convenience for server-side tooling; the client writes events directly.';

-- ────────────────────────────────────────────────────────────────────────────
-- 8. VALIDATION QUERIES (read-only — safe to run after migration)
-- ────────────────────────────────────────────────────────────────────────────

-- 8.1 Extensions installed
SELECT extname, extversion FROM pg_extension WHERE extname IN ('pgcrypto') ORDER BY extname;

-- 8.2 All application tables
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- 8.3 RLS enabled on every table
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

-- 8.4 All policies
SELECT schemaname, tablename, policyname, permissive, roles
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 8.5 All indexes
SELECT tablename, indexname FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- 8.6 All triggers
SELECT event_object_table AS table_name, trigger_name, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- 8.7 All views
SELECT table_name FROM information_schema.views
WHERE table_schema = 'public'
ORDER BY table_name;

-- 8.8 Tables owning updated_at MUST have the trg_set_updated_at trigger
SELECT tc.table_name
FROM information_schema.columns tc
WHERE tc.table_schema = 'public' AND tc.column_name = 'updated_at'
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.triggers tr
    WHERE tr.event_object_schema = 'public'
      AND tr.event_object_table = tc.table_name
      AND tr.trigger_name = 'trg_set_updated_at'
  )
ORDER BY tc.table_name;

COMMIT;
