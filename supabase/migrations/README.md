# Supabase Migrations — Training Tracker

Single-user study operating system. This folder contains the PostgreSQL schema
that mirrors the application's TypeScript models (`src/types.ts`) exactly.

## Migration order

| File | Purpose |
|---|---|
| `0001_initial_schema.sql` | Complete database bootstrap (extensions → tables → triggers → indexes → RLS → views → functions → validation). |
| `0002_sync_realtime.sql` | Sync upgrade: `device_id` + `sync_version` columns on synced tables, revision-queue upsert key, `supabase_realtime` publication membership. |
| `seed_curriculum.sql` (in the parent `supabase/` folder) | Static curriculum rows generated from the app's `createSeedData()` — modules, topics, subtopics, assessments. Required before user progress can reference subtopic ids. |

`0002` must run **after** `0001`. It is idempotent (`IF NOT EXISTS` + existence
checks), so re-running it is safe. Never edit `0001` after it has shipped to a
live project.

**Heads-up for anyone who ran the app before `0002`:** the pre-0002 backup
fallback used a plain `INSERT`, which could leave duplicate `(user_id, name)`
rows in `backups` — that made the first attempt at `0002` fail with
`could not create unique index "uq_backups_user_name"`. The migration now
deduplicates those rows (keeping the newest snapshot per `(user_id, name)`)
**before** creating the unique index, so re-running it succeeds.

## Execution steps

1. Open the **Supabase Dashboard → SQL Editor** for your project.
2. Paste the entire contents of `0001_initial_schema.sql` and press **Run**.
   - The file is transactional: if any statement fails, the whole migration rolls back.
3. Confirm the validation queries at the end return sensible results:
   - 8.2 lists all 20 tables.
   - 8.3 shows `rls_enabled = true` for every table.
   - 8.8 returns **zero rows** (every `updated_at` column has its trigger).
4. **Seed the curriculum** (`modules`, `topics`, `subtopics`, `assessments`).
   Paste `../seed_curriculum.sql` into the SQL Editor and run it. Authenticated
   users only get `SELECT` on curriculum tables (RLS), so the client cannot
   seed it itself — this SQL is generated from the app's own
   `createSeedData()` (regen with `npx vitest run scripts/generateCurriculumSeed.test.ts`)
   and is idempotent (`ON CONFLICT DO NOTHING`).
5. Create a `profiles` row for the account (`user_id = auth.uid()`,
   `joining_date = '2026-09-21'` — the app's `JOINING_DATE`). The client does
   this silently on first boot.

### CLI alternative

```bash
supabase db push
# or, with the CLI linked and local Postgres running:
supabase db reset
```

## What the schema stores (and what it deliberately does NOT)

**Stored (raw facts only):**

- Static curriculum: `modules`, `topics`, `subtopics`, `assessments`
- Per-user state: `profiles`, `topic_progress`, `assessment_progress`
- Study history: `study_sessions`, `daily_logs`, `study_events`
- Infrastructure: `revision_queue`, `settings`, `sync_queue`, `device_info`, `backups`, `app_meta`
- Reserved AI tables (empty, future-ready): `ai_cache`, `coach_messages`, `embeddings`, `recommendations`

**Never stored (always derived in the app):** the entire Adaptive Study Load
Engine, dashboard cards, forecast, analytics, heatmap, readiness score,
achievements, streaks, time distributions. There are no tables for these — the
engine is computation-only and reads the raw facts above.

## Data model mapping (TypeScript → SQL)

| TypeScript model | SQL table(s) | Notes |
|---|---|---|
| `Module` | `modules` | PK = client id (`'m1'`, `'m2'` …) |
| `Topic` + `TopicMeta` | `topics` | difficulty, estimated_hours, objectives/prereqs/exercises as `text[]` |
| `SubTopic` | `subtopics` + `topic_progress` | curriculum split from per-user progress |
| `Assessment` | `assessments` + `assessment_progress` | type check, score 0–100 |
| `StudySession` | `study_sessions` | `client_id` preserves sync identity |
| `DailyLogEntry` | `daily_logs` | `source` = `timer` \| `completion` |
| `StudyEvent` | `study_events` | append-only, typed, JSONB payload |
| `TrainingData` | assembled from the above | never stored as a blob |

Key design decisions:

- **Curriculum ids are the PKs.** `'m2-t1-s1'` etc. are stable cross-device
  identifiers the app already generates; remapping them to UUIDs would break
  the client.
- **User data uses `gen_random_uuid()` PKs + a `client_id` column** with
  `UNIQUE (user_id, client_id)`. The client's own ids (`log-…`, `ses-…`,
  `evt-…`) live in `client_id`, giving the Sync Engine a stable dedup key.
- **Progress is separated from curriculum.** A subtopic's `completed` /
  `hours_spent` / `last_studied` live in `topic_progress`, so curriculum edits
  never touch user data, and multi-device sync stays conflict-free.
- **Denormalized snapshots** (`subtopic_name`, `module_name`) on sessions/logs
  preserve history if the curriculum later changes.
- **`study_sessions.subtopic_id` / `daily_logs.subtopic_id` use `ON DELETE
  SET NULL`** so history survives curriculum changes; progress/revision rows
  use `ON DELETE CASCADE`.

## Rollback considerations

- The migration is **idempotent-friendly** (`IF NOT EXISTS`, `DROP POLICY /
  TRIGGER IF EXISTS`, `CREATE OR REPLACE`), so re-running the file is safe.
- To fully roll back a project, drop the schema objects in reverse dependency
  order (children before parents) or reset the project — there is no
  down-migration by design; `0001` is the ground truth.

## Assumptions

1. Target is **Supabase Postgres (≥ PG13)** — `gen_random_uuid()`, `auth.uid()`,
   and the `auth.users` table are available. On vanilla Postgres you must create
   an `auth` stub before running (see validation notes below).
2. The app is **single-user** — every policy is `auth.uid() = user_id`.
   Curriculum is global read-only for authenticated users.
3. The **service role / Edge Functions** perform admin writes (curriculum
   seeding, profile bootstrap); the client only ever uses the publishable key.
4. `updated_at` is maintained exclusively by the `trg_set_updated_at` trigger.
5. No secrets live in this folder; Supabase URL + publishable key belong in
   `training-tracker/.env` (see `.env.example`).

## Verification steps (after running)

Run the 8 validation query blocks at the end of `0001`. Expected results:

1. `pgcrypto` present.
2. Exactly 20 base tables in `public`.
3. `rls_enabled` = `true` for all 20.
4. 20 policies (5 `_read` on curriculum/app_meta, 15 `_own` on the user tables).
5. All indexes present (curriculum, progress, dates, events, queue, backups).
6. All triggers present (one `trg_set_updated_at` per `updated_at` table).
7. 3 views (`v_curriculum_progress`, `v_module_progress`, `v_daily_summary`).
8. Zero rows (no `updated_at` column missing its trigger).

### Local (non-Supabase) validation

To validate the SQL against a local Postgres, first create an `auth` stub:

```sql
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
```

then run `psql -f 0001_initial_schema.sql` in a scratch database.

## Mapping to the app's local storage

The app's local IndexedDB/SQLite stores map onto these tables as follows:
`app_state` → assembled from curriculum + progress + logs; `daily_logs`,
`study_sessions`, `study_events` → same-named tables; `app_meta` →
`app_meta`; `sync_outbox` → `sync_queue`; `backups` → `backups`.
`sync_history`, and client bookkeeping remain local-only (never synced).
