# Supabase Migrations — Training Tracker

Single-user study operating system. This folder contains the PostgreSQL schema
that mirrors the application's TypeScript models (`src/types.ts`) exactly.

## Migration order

| File | Purpose |
|---|---|
| `0001_initial_schema.sql` | Complete database bootstrap (extensions → tables → triggers → indexes → RLS → views → functions → validation). |
| `0002_sync_realtime.sql` | Sync upgrade: `device_id` + `sync_version` columns on synced tables, revision-queue upsert key, `supabase_realtime` publication membership. |
| `0003_tombstones.sql` | Soft-delete support for daily logs and study sessions. |
| `0004_cloud_first.sql` | Pure cloud-first migration: REPLICA IDENTITY FULL, one-shot `get_user_snapshot` RPC, atomic `log_work` RPC, `reset_user_data` RPC. |
| `0005_audit_fixes.sql` | Audit fixes: relaxes start/end time constraints on `study_sessions`, expands `source` CHECK constraints for `'manual'` entries, upgrades atomic `log_work` RPC to write `study_sessions`, drops legacy sync tables. |
| `seed_curriculum.sql` (in parent `supabase/`) | Static curriculum rows generated from the app's `createSeedData()` — modules, topics, subtopics, assessments. |

Migrations must be run in sequence from `0001` through `0005`. All migrations are idempotent, safe to re-run.

## Architecture Model

The application uses a **Pure Cloud-First Architecture**:
- Supabase Postgres is the single source of truth.
- State is loaded via `get_user_snapshot()` RPC at startup.
- Realtime changes push via Supabase Realtime WebSocket subscriptions.
- Writes execute via atomic RPCs (`log_work`, `reset_user_data`) or typed table queries with instant client feedback.
- Backups and safety snapshots persist directly in the `backups` table in Supabase.
