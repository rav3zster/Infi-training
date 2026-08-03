# Infi Training — Complete Storage Architecture Review

**Scope:** Full repository diagnosis and cloud-first redesign evaluation
**Repository snapshot:** `rav3zster/Infi-training` (local copy at `/tasklet/agent/home/infi-training/`)
**Review roles:** Principal Software Architect / Distributed Systems / Backend / Supabase / PostgreSQL / React / Capacitor / Product Architecture
**Constraint honored:** No code was implemented or modified. Analysis and recommendations only.

---

## 0. Governing Constraints (owner-mandated)

These are treated as hard requirements, not preferences. Every recommendation below is derived from them.

1. **The application is permanently online.** Internet connectivity is assumed available at all times.
2. **Offline usage is not a goal.** No architecture decision may be justified by offline capability.
3. **Nothing is preserved because it already exists.** Prior implementation effort carries zero weight.
4. **SQLite, IndexedDB, the Sync Engine, the Outbox, merge logic, local migrations, local databases, and local data caches are all treated as optional components, eligible for complete removal.**
5. **The objective is the simplest, most reliable architecture** — measured by cross-device consistency, number of sources of truth, and defect surface, not by feature checkboxes.

Under these constraints, "keep it as a cache" is not a neutral middle option: a cache is a second copy of the truth, and a second copy is the root cause of every divergence defect catalogued in §16.

---

## 1. Executive Summary

**Verdict: Move to a pure Supabase Cloud-First architecture. Delete all local data persistence — SQLite, IndexedDB, the outbox, the sync engine, and the merge layer — with no cache tier retained in any form.** There is no local database, no local snapshot of application data, and no local write buffer. Application state lives in Supabase; the client holds it only in volatile React memory, hydrated at startup and kept live by Supabase Realtime. Memory is discarded on unmount; the server is re-read on mount and on reconnect.

The only browser storage that remains is `localStorage` for **non-data device preferences** — colour theme and running-timer wall-clock recovery. These are per-device UI state that must *not* sync, contain no study data, and are not a cache of anything on the server. If even these are undesirable, they can be moved into Postgres at the cost of one extra column, with no architectural consequence.

### Why (condensed evidence)

1. **The sync layer is the app's dominant source of bugs — including a catastrophic one.** The remote-purge detector (`src/services/sync/syncEngine.ts:421-434`) counts **delta-filtered** download rows, not actual cloud rows. On any sync cycle where nothing changed remotely for > 5 minutes (the `DELTA_OVERLAP_MS` window, line 70), with an empty outbox and non-empty local data, it dispatches `training:remote-purge`, which resets local data to seed (`src/context/TrainingContext.tsx:107-114`). This alone can explain "progress disappears," "devices display different data," and "some updates never arrive." It is a P0 data-loss bug that exists *only because* a second source of truth (local DB) has to be reconciled with the first (Supabase).

2. **Deletion propagation is structurally broken.** Migration `0003_tombstones.sql` adds `deleted_at` tombstones, and the merge honors them (`syncEngine.ts:522,545`) — but **no code path ever writes `deleted_at`**. The uploader issues hard `DELETE`s (`syncEngine.ts:349-353`). Hard-deleted rows never appear in `updated_at > cutoff` delta downloads, so other devices keep deleted logs/sessions forever. Permanent cross-device divergence, by construction.

3. **The scale does not justify local persistence.** The entire dataset is one user's study log: 129 subtopics, 8 assessments (bundle-verified against `supabase/seed_curriculum.sql`), plus a few hundred daily-log/session rows per year. The full working set is a few hundred KB. Supabase can return all of it in **one or two round trips at startup** (< 500 ms on any realistic connection). There is nothing for SQLite to accelerate.

4. **SQLite is not being used as a database anyway.** The native driver stores each table as `(id TEXT PRIMARY KEY, data TEXT)` JSON blobs (`src/services/database/nativeSqliteDriver.ts:8-10`); IndexedDB mirrors that. No SQL queries, no indexes, no joins — it is a key-value snapshot store for a single `app_state` JSON document (`src/services/repositories/trainingRepository.ts:188-204`). Every claimed benefit of "SQLite" is actually just "a local cache," and that cache is what causes the divergence.

5. **The user's constraints eliminate the only real argument for local-first.** Single user, forever; internet connection acceptable; priorities are consistency, simplicity, and instant sync. Offline-first is the sole engineering justification for the outbox/merge machinery, and it has been explicitly deprioritized.

### What replaces it

```
Supabase (only source of truth)
   → thin repository layer (typed queries + mutations + RPCs)
   → React Query-style store (in-memory cache, optimistic updates)
   → Realtime channel (postgres_changes → patch/invalidate in-memory state)
   → UI
```

Estimated code deletion: ~3,500+ lines (drivers, outbox, sync engine, mergers, diffing, migrations, legacy migration, sync diagnostics plumbing) replaced by ~400–600 lines of repository + realtime glue. Details, migration plan, and improved SQL follow.

---

## 2. Current Architecture Diagram

```
┌──────────────────────────────  DEVICE (Web / Android)  ──────────────────────────────┐
│                                                                                       │
│  React UI (screens/components)                                                        │
│      │  useTraining() / useSync() / useTimer() / useAuth()                            │
│      ▼                                                                                │
│  TrainingContext (src/context/TrainingContext.tsx)                                    │
│   • holds TrainingData in useState (modules+logs+sessions as ONE nested object)       │
│   • every mutation: structuredClone(whole tree) → setData                             │
│   • effect #1: mirror to latestTrainingData module global (:78-92)                    │
│   • effect #2: diff prev→next → outbox ops (trainingDiff.ts) → 'sync:request' event   │
│   • effect #3: debounced 800ms persist to LocalDatabase (:158-167)                    │
│      │                                                                                │
│      ▼                                                                                │
│  LocalDatabase facade (services/database/LocalDatabase.ts)                            │
│   • app_state: single JSON blob of the ENTIRE TrainingData                            │
│   • daily_logs / study_sessions: projected copies, CLEARED + REWRITTEN on every save  │
│   • study_events, sync_outbox, sync_history, backups, app_meta, 4 unused AI stores    │
│      │                                                                                │
│      ▼                                                                                │
│  DatabaseDriver (createDriver.ts)                                                     │
│   ├─ Android: NativeSqliteDriver — SQLite tables of (id TEXT, data TEXT) JSON         │
│   ├─ Web:     IndexedDbDriver — object stores keyed by id                             │
│   └─ Tests:   MemoryDriver                                                            │
│                                                                                       │
│  SyncContext (context/SyncContext.tsx)                                                │
│   • 3-second polling loop (:38, :151-153)  • focus/visibility/online triggers         │
│   • 'sync:request' listener → SyncEngine.requestSync()                                │
│      │                                                                                │
│      ▼                                                                                │
│  SyncEngine (services/sync/syncEngine.ts, 767 lines)                                  │
│   1. ensureProfile: upsert profiles EVERY cycle (:183)                                │
│   2. uploadAll: drain sync_outbox → batched upserts + hard deletes (:282-371)         │
│   3. downloadAndMerge: 6 tables, delta = updated_at > lastSyncAt−5min (:375-442)      │
│      • LWW merge into latestTrainingData clone; pending outbox keys win               │
│      • remote-purge heuristic (:421-434)  ⚠ fires on quiet cycles                     │
│   4. maybeCloudBackup: daily JSON snapshot → backups table (:602-680)                 │
│                                                                                       │
│  realtimeService (services/sync/realtimeService.ts)                                   │
│   • 1 channel, 7 tables, filter user_id=eq.<uid> → 'sync:realtime' event              │
│   • SyncContext reacts by requesting another full sync cycle                          │
└───────────────────────────┬───────────────────────────────────────────────────────────┘
                            │ HTTPS (PostgREST + Realtime WS + Auth)
                            ▼
┌────────────────────────  SUPABASE  ────────────────────────┐
│ Auth: permanent account, silent password sign-in           │
│ (authService.ts; creds inlined via VITE_DEV_EMAIL/PASSWORD)│
│ Postgres: 20 tables (0001) + LWW columns (0002)            │
│           + tombstones (0003, never written)               │
│ Realtime publication: 7 user-data tables                   │
│ RLS: auth.uid() = user_id everywhere                       │
└────────────────────────────────────────────────────────────┘
```

**Persistence count for one user action (e.g., ticking a subtopic):** React state → app_state blob rewrite → daily_logs projection rewrite → study_sessions projection rewrite → outbox row → Supabase upsert → other devices' merge → their app_state + projections. **Eight materializations of the same fact.**

---

## 3. Recommended Architecture Diagram (Cloud-First)

```
┌──────────────────────────  DEVICE (Web / Android)  ──────────────────────────┐
│                                                                              │
│  React UI (unchanged screens/components)                                     │
│      │ useTraining() — same public API, same DashboardMetrics                │
│      ▼                                                                       │
│  TrainingStore (React context or TanStack Query)                             │
│   • in-memory state only: { progressMap, logs, sessions, settings }          │
│   • curriculum stays BUNDLED (src/data/curriculum.ts) — static, versioned    │
│   • mutations: optimistic in-memory patch → await Supabase write             │
│       └ on error: rollback patch + toast (rare; user is online by contract)  │
│   • adaptiveEngine/readinessEngine unchanged: pure functions over state      │
│      │                                                                       │
│      ▼                                                                       │
│  Repository layer (services/cloud/*.ts — the ONLY Supabase-aware code)       │
│   • loadAll(): 1 RPC or 4 parallel selects → full user dataset               │
│   • toggleSubtopic(), logWork(), deleteLog(), toggleAssessment(), …          │
│   • RPCs for multi-table atomic ops (log_work = insert log + upsert progress │
│     in ONE Postgres transaction)                                             │
│      │                                                                       │
│  RealtimeService (kept, simplified)                                          │
│   • postgres_changes on 4 tables → apply row payload DIRECTLY to store       │
│     (INSERT/UPDATE/DELETE row → patch map/array; no re-download, no merge)   │
│   • on channel reconnect → loadAll() once (guarantees convergence)           │
│                                                                              │
│  NO local database. NO IndexedDB. NO SQLite. NO local data cache.            │
│  State lives in volatile React memory only; discarded on reload.             │
│  localStorage ONLY for non-data device prefs: theme, timer wall-clock.       │
└──────────────────────────┬───────────────────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────  SUPABASE — SINGLE SOURCE OF TRUTH  ────────────────┐
│ Tables (trimmed): profiles, topic_progress, assessment_progress,            │
│                   daily_logs, study_sessions, study_events, settings,       │
│                   backups (+ curriculum reference tables)                   │
│ DELETED: sync_queue, device_info, device_id/sync_version cols, deleted_at   │
│ RPCs: get_user_snapshot(), log_work(), reset_progress()                     │
│ Realtime: REPLICA IDENTITY FULL on synced tables (filtered DELETE events)   │
│ pg_cron (optional): nightly backups snapshot, replacing client-driven backup│
└──────────────────────────────────────────────────────────────────────────────┘
```

**Deleted concepts:** outbox, diffing, LWW merge, delta watermarks, tombstones, remote-purge detection, local drivers, local migrations, legacy migration, projections, `latestTrainingData` global, 800 ms debounced persistence, flush-on-hide, sync history/stats stores.

---

## 4. Data Flow Diagram

### 4.1 Current (write path for one subtopic tick)

```
tap checkbox
  → TrainingContext.toggleSubTopic: structuredClone(full tree), mutate, setData
    → effect: enqueueTrainingDiff(prev,next)          [trainingDiff.ts:52]
        → sync_outbox row (compressed by table:clientId)
        → window 'sync:request'
    → effect: debounce 800ms → persistTrainingData
        → app_state blob PUT + clear/rewrite daily_logs + study_sessions
  → SyncEngine.requestSync (throttle 1s, drop if busy)  [syncEngine.ts:121-127]
      → syncNow: getSession → profiles upsert → outbox drain (batch 50)
      → download 6 tables (updated_at > lastSyncAt − 5min)
      → merge onto latestTrainingData clone → persist → 'training:remote-merge'
  → OTHER DEVICE: Realtime event → 'sync:realtime' → full sync cycle
      → its own delta download + merge + persist + setData
```
Latency to other device: realtime push + a *full sync cycle* (session check, profile upsert, outbox scan, 6 table selects, merge, persist) — typically 1–4 s; unbounded when `busy` collides with the 1 s throttle.

### 4.2 Recommended

```
tap checkbox
  → store: optimistic patch progressMap[subId] (instant UI, same frame)
  → repository.toggleSubtopic(subId, completed)
      → supabase.from('topic_progress').upsert({...})       (~100-300 ms)
      → on error: revert patch, show retry toast
  → OTHER DEVICE: Realtime UPDATE payload (already contains the row)
      → store applies row to progressMap directly            (~200-500 ms total)
      → dashboard/analytics/adaptive engine re-derive via useMemo — no refresh
```
One write, one push, zero merges, zero persistence layers. The realtime payload **is** the data; no re-download round trip.

---

## 5. Repository Diagram (code structure)

### Current
```
src/
├─ context/        TrainingContext (679) ─ owns state + mutations + persistence wiring
│                  SyncContext (181) ─ engine lifecycle, 3s poll, realtime wiring
│                  AuthContext (108) ─ silent-auth snapshot
│                  TimerContext (215) ─ localStorage-backed timer
│                  ThemeContext (77), ConfirmContext (102)
├─ engine/         adaptiveEngine (972, pure), readinessEngine (115), layoutEngine (253)
├─ services/
│  ├─ database/    LocalDatabase (516), 3 drivers (555), migrations (56),
│  │               legacyMigration (142), stores (30), versions (30)   ≈ 1,330 lines
│  ├─ sync/        syncEngine (767), outboxRepository (261), mappers (155),
│  │               trainingDiff (124), realtimeService (75), SyncStatus (86),
│  │               settingsSync (25), clientSettings (50), deviceId (23),
│  │               latestData (11)                                     ≈ 1,580 lines
│  ├─ repositories/ trainingRepository (50), eventRepository (50)
│  └─ supabase/    supabaseClient (99), authService (169)
├─ screens/        Dashboard, Analytics, Syllabus, LogWork, CalendarPlanner,
│                  Presets, Diagnostics
└─ data/           curriculum.ts (822 — static seed, ids generated positionally :59)
```
≈ **2,900 lines of storage/sync infrastructure** to move a few hundred KB of one user's data — versus 972 lines for the entire adaptive engine that is the actual product.

### Recommended
```
src/
├─ context/        TrainingContext (thin: state + optimistic mutations)
│                  AuthContext, TimerContext, ThemeContext, ConfirmContext (unchanged)
├─ engine/         unchanged (pure functions — the redesign's biggest asset)
├─ services/cloud/ repository.ts (~250: typed selects/upserts/RPC calls)
│                  realtime.ts   (~80: channel + row→store application)
│                  authService.ts, supabaseClient.ts (kept as-is)
└─ data/           curriculum.ts (kept as the bundled static curriculum)
```

---

## 6. Storage Diagram

### Current — five persistent stores for the same facts
```
localStorage            IndexedDB / SQLite (12 stores)         Supabase (20 tables)
─────────────           ──────────────────────────────         ─────────────────────
theme                   app_state (FULL TrainingData blob)     topic_progress
date-offset             daily_logs   (projection of blob)      assessment_progress
timer recovery          study_sessions (projection of blob)    daily_logs
device-id               study_events (cap 2000)                study_sessions
legacy training data    sync_outbox / sync_history             study_events (unbounded)
                        backups / app_meta                     settings, profiles
                        ai_cache, coach_messages,              backups, revision_queue
                        embeddings, recommendations (empty)    sync_queue (NEVER USED)
                                                               device_info (NEVER USED)
                                                               app_meta, 4 AI tables (empty)
```
- `hoursSpent` exists in **four places**: subtopic field in app_state, derived from daily_logs (local), `topic_progress.hours_spent` (cloud), derivable from `daily_logs` (cloud). Nothing enforces agreement.
- Cloud `sync_queue` and `device_info` are dead schema: the client's outbox is the local `sync_outbox` store; nothing reads/writes those tables (verified: no references outside migrations).

### Recommended — one persistent store
```
localStorage (device prefs only)      Supabase (single source of truth)
─────────────────────────────        ─────────────────────────────────
theme                                 profiles, settings
timer recovery                        topic_progress, assessment_progress
                                      daily_logs, study_sessions, study_events
                                      backups (pg_cron or client daily snapshot)
                                      modules/topics/subtopics/assessments (reference)
```
In-memory only: normalized store `{ progressMap, assessmentMap, logs[], sessions[] }` hydrated at startup, patched by realtime.

---

## 7. Realtime Diagram

### Current
```
Device A write ──► Supabase table change ──► Realtime WS ──► Device B
                                                    │
                                          'sync:realtime' CustomEvent
                                                    │
                                     SyncContext → requestSync() (throttled 1s,
                                     DROPPED if engine busy — no rescheduling)
                                                    │
                              FULL sync cycle: session + profile upsert + outbox
                              + 6 delta selects + merge + persist + setData
```
Problems: the push payload (which already contains the changed row) is discarded and replaced with a polling cycle; `requestSync` drops requests while busy (`syncEngine.ts:123`) leaving convergence to the 3 s poll; every realtime event costs ~8 network calls.

### Recommended
```
Device A write ──► Supabase ──► Realtime WS (postgres_changes, REPLICA IDENTITY FULL)
                                        │ payload = the actual new/old row
                                        ▼
                     Device B store.applyRealtimeRow(table, eventType, row)
                       INSERT/UPDATE → upsert into map/array
                       DELETE        → remove by key
                                        ▼
                     React re-render; adaptive engine / dashboard / analytics
                     re-derive via existing useMemo(calculateMetrics)
   On WS reconnect or app resume → repository.loadAll() once (self-healing)
```
Phone tick → tablet/browser update in one WS hop. No refresh, no manual sync, no merge policy — there is nothing to merge because there is only one store.

---

## 8. Cross-Device Synchronization Diagram

### Current failure modes (all evidence-backed)
```
Device A                     Supabase                      Device B
────────                     ────────                      ────────
delete log ──hard DELETE──►  row gone                      row still local FOREVER
                             (no tombstone ever written;   (delta query can't see
                              0003 deleted_at unused)       deleted rows)          P0

quiet ≥5 min ──delta=∅──►    (data intact!)               local reset to SEED
                                                           via remote-purge
                                                           false positive          P0

clock skew >5min ──────►     rows exist                    watermark skips them:
                                                           "updates never arrive"  P0

same subtopic ± hours        LWW verbatim                  one increment lost      P1
on 2 devices in window
```

### Recommended
```
Device A ──write──► Postgres row (single truth) ──realtime──► every online device
App start / reconnect ──loadAll()──► exact server state (no watermark, no cutoff)
Deletes: real DELETE + realtime DELETE event (+ reload-on-reconnect safety net)
Conflicts: single user typing on one device at a time — Postgres row atomicity
           suffices; increments via RPC (UPDATE ... SET hours = hours + $1) if
           simultaneous-device arithmetic must be exact.
```
Consistency guarantee: every device shows `SELECT * WHERE user_id = me` — definitionally identical across devices.

---

## 9. SQLite Review — remain / cache / removed

**Conclusion: REMOVED.** Evaluated with evidence, not assumption:

| Dimension | Current (SQLite/IDB + outbox + sync) | Cloud-first (pure Supabase) | Winner |
|---|---|---|---|
| **Startup performance** | Open DB → run local migrations → hydrate blob → legacy-migration check → seed fallback (`TrainingContext.tsx:122-155`). Fast (~50-150 ms) but then a sync cycle mutates state again seconds later (visible "data jump"). | 1 RPC / 2-4 parallel selects of a few hundred rows over one HTTP/2 connection: ~200-500 ms, then **stable**. Splash screen already exists (`SplashScreen.tsx`). | Cloud-first (correctness); tie on raw ms |
| **Synchronization** | 1,580 lines; 4 confirmed P0 defects (see §16). | None — the concept is deleted. | Cloud-first, decisively |
| **Maintenance** | 3 drivers × platform quirks (see P0-02/P0-03 fix comments in `nativeSqliteDriver.ts:34-47,90-95` — the drivers have *already* accumulated hard-won bug fixes), local migrations, legacy migration, projections. | One schema, in Postgres, migrated with SQL. | Cloud-first |
| **Debugging** | A bug can live in 8 layers; Diagnostics screen exists *because* the architecture is undebuggable by inspection. | Data = the table. Supabase Studio is the debugger. | Cloud-first |
| **Scalability** | Whole-tree `structuredClone` per mutation + full blob + full projection rewrite per 800 ms save; grows O(dataset) forever. | Per-row writes; reads paginate if ever needed. | Cloud-first |
| **Complexity** | ~2,900 infra lines; 5 stores of the same fact. | ~400-600 lines; 1 store. | Cloud-first |
| **Failure recovery** | Local DB can wipe itself (P0-1); backups defend against the architecture itself. | Postgres durability + PITR + optional snapshot table. | Cloud-first |
| **Conflict handling** | LWW without timestamp comparison; lost increments; delete resurrection. | Single store: conflicts structurally impossible for one user; RPCs for atomic arithmetic. | Cloud-first |
| **Cross-device consistency** | Eventual at best; divergent in practice (the reported symptom). | Definitionally identical. | Cloud-first |
| **Offline use** | Fully offline-capable. | Requires internet. | Not scored — offline is out of scope per §0.2, so this dimension carries no weight |
| **Developer experience** | Every feature must thread: type → mapper → outbox → merge → projection → migration. | Feature = SQL column + repository function + state field. | Cloud-first |

**Every case for keeping SQLite — examined and rejected:**
- *"Offline study sessions (train/flight)"* — inadmissible. Per §0.1–0.2 the app is permanently online and offline capability may not justify architecture. This is the *only* dimension SQLite wins, and it has been ruled out of scope. Note also that the current implementation does not actually deliver reliable offline value: it trades it for chronic divergence and a data-wipe bug (P0-1).
- *"Instant startup"* — a splash screen already exists (`SplashScreen.tsx`), and a 200–500 ms fetch of <500 rows is imperceptible behind it. More importantly, the current local-first startup is *worse perceived* behaviour: it paints stale local data, then visibly mutates it seconds later when the first sync cycle lands. Cloud-first paints once, correctly. **No stale-while-revalidate snapshot is recommended** — it would reintroduce a second copy of the truth to save time the user cannot perceive.
- *"Query performance"* — nothing queries SQLite; it stores JSON blobs (`nativeSqliteDriver.ts:8-10`). The adaptive engine computes over in-memory objects either way.
- *"Network cost"* — inverted. The **current** design polls a full sync cycle every 3 seconds (`SyncContext.tsx:38,151-153`), including a `profiles` upsert per cycle (`syncEngine.ts:183`). Cloud-first with realtime push uses dramatically *less* network.
- *"It already works / it took effort to build"* — inadmissible per §0.3. Sunk cost is not evidence. The drivers' accumulated fix comments (`nativeSqliteDriver.ts:34-47,90-95`) are evidence of ongoing cost, not of value.
- *"Keep it as a harmless runtime cache"* — rejected. A cache is a second copy of the truth that can be stale, and staleness is precisely the reported symptom. React memory already serves every legitimate need a runtime cache would serve, and it cannot survive a reload to poison the next session.

**Verdict: pure Supabase. SQLite, IndexedDB, the outbox, the sync engine, the merge layer, local migrations, and legacy migration are all deleted. There is no local data cache of any kind — authoritative or otherwise.** Local persistence is limited to non-data device preferences (theme, timer wall-clock).

---

## 10. Supabase Review (schema, policies, indexes, realtime)

### 10.1 Table-by-table

| Table | Status | Findings |
|---|---|---|
| `profiles` | Keep | Fine. But `ensureProfile` upserts it **every sync cycle** with the hardcoded `JOINING_DATE` constant (`syncEngine.ts:270-280`; `adaptiveEngine.ts:27` = `2026-09-21`) — the DB value is decoration. Cloud-first: make `profiles.joining_date` authoritative and read it at startup; write once. |
| `modules/topics/subtopics/assessments` | Keep (reference) | Good design (stable text PKs). **Risk:** ids are generated **positionally** in `curriculum.ts:59` (`${topicId}-s${index+1}`); `seed_curriculum.sql` is hand-regenerated. Inserting/reordering a subtopic silently remaps ids (progress attaches to the wrong subtopic) and any unseeded id makes every referencing upload fail FK **forever** (retry loop: `RETRY_CAP=8` then `resetStuckOps` re-enables each cycle, `syncEngine.ts:288`). Verified in-sync today (129 subtopic ids in both bundle and seed) but there is no guard. Add a startup assertion comparing bundled curriculum ids against cloud ids, and generate the seed from code in CI. |
| `topic_progress` | Keep | Composite PK `(user_id, subtopic_id)` is correct. `hours_spent` duplicates `SUM(daily_logs.hours)` — accept as denormalized rollup but maintain it **in one place** (the `log_work` RPC below), not from two clients merging. |
| `assessment_progress` | Keep | Fine. |
| `daily_logs` / `study_sessions` | Keep | `UNIQUE (user_id, client_id)` is exactly right; keep client-generated ids as natural keys. Simplify: make `client_id` the PK (drop the shadow uuid `id`) in a cloud-first world. `deleted_at` (0003) becomes unnecessary — drop it (realtime DELETE events + reload-on-reconnect handle propagation). |
| `study_events` | Keep | Append-only, correct. Note asymmetry: local copy trimmed to 2000 (`eventRepository.ts:8,26-33`), cloud unbounded — fine once cloud is the only copy. |
| `settings` | Keep | Currently half-synced: theme is uploaded (`settingsSync.ts:20`) but never applied on download (`syncEngine.ts:582-593` applies only `date_offset` — comment admits "theme is device-local"). Decide per-field: `date_offset` cloud, `theme` device-local, and stop uploading theme. |
| `revision_queue` | Keep (dormant) | Upload-capable but no local store and not in `DOWNLOAD_TABLES` (`mappers.ts:33-41`) — currently unreachable code. Fine as future schema. |
| `sync_queue` | **DROP** | Never referenced by any client code (outbox lives in the local `sync_outbox` store). Dead schema that misleads readers. |
| `device_info` | **DROP** | Never referenced by any client code despite the comment claiming the sync engine uses it. |
| `backups` | Keep | Useful independent of sync. The upsert-with-fallback dance (`syncEngine.ts:626-646`) exists only to tolerate un-migrated databases; post-0002 it can be a plain upsert — or move backups server-side with `pg_cron`. |
| `app_meta` | Simplify or drop | Client never reads it (verified: no client references). Either implement the version handshake or remove. |
| `ai_cache/coach_messages/embeddings/recommendations` | Neutral | Empty reserved tables; harmless, but reserving schema "to avoid ALTERs later" is unnecessary — ALTERs are cheap. Consider dropping until needed. |
| `device_id`/`sync_version` columns (0002) | **DROP** | LWW provenance for a merge policy that never reads them. |

### 10.2 Policies, indexes, triggers, views
- **RLS:** correct and complete — every table enabled, user tables scoped `auth.uid() = user_id`, curriculum read-only (`0001:433-526`). Keep as-is even single-user (defends the anon key).
- **Indexes:** comprehensive; several are dead weight at this scale (`idx_daily_logs_source`, `idx_study_events_entity`, partial `deleted_at` indexes from 0003 once tombstones are dropped). Harmless; prune with the columns.
- **`set_updated_at` trigger:** correct, keep — it becomes the *only* timestamp authority in cloud-first (today clients also stamp client clocks, creating the skew problem).
- **Views** (`v_curriculum_progress`, `v_module_progress`, `v_daily_summary`): well-designed but **unused by the client** (never selected anywhere in `src/`). In cloud-first they become genuinely useful (dashboard rollups). Note `v_module_progress`'s `count(*) FILTER (WHERE tp.completed)` + `coalesce(tp.user_id, auth.uid())` grouping is convoluted; simplify.
- **Realtime publication** (0002 §3): correct. Add `REPLICA IDENTITY FULL` (SQL below) — without it, filtered `postgres_changes` **DELETE events do not match the `user_id=eq.` filter** (old row only carries the PK), which is another latent reason deletions never propagate even via realtime.

### 10.3 Improved SQL (proposed migration `0004_cloud_first.sql`)

```sql
-- ============================================================================
-- 0004_cloud_first.sql — schema cleanup + cloud-first primitives (PROPOSAL)
-- ============================================================================
BEGIN;

-- 1. Filtered DELETE events require full old-row images.
ALTER TABLE public.topic_progress      REPLICA IDENTITY FULL;
ALTER TABLE public.assessment_progress REPLICA IDENTITY FULL;
ALTER TABLE public.daily_logs          REPLICA IDENTITY FULL;
ALTER TABLE public.study_sessions      REPLICA IDENTITY FULL;
ALTER TABLE public.settings            REPLICA IDENTITY FULL;

-- 2. One-shot startup snapshot: the entire user dataset in a single request.
CREATE OR REPLACE FUNCTION public.get_user_snapshot()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER STABLE AS $$
  SELECT jsonb_build_object(
    'profile',  (SELECT to_jsonb(p) FROM public.profiles p WHERE p.user_id = auth.uid()),
    'settings', (SELECT to_jsonb(s) FROM public.settings s WHERE s.user_id = auth.uid()),
    'topic_progress', COALESCE((SELECT jsonb_agg(to_jsonb(t))
        FROM public.topic_progress t WHERE t.user_id = auth.uid()), '[]'::jsonb),
    'assessment_progress', COALESCE((SELECT jsonb_agg(to_jsonb(a))
        FROM public.assessment_progress a WHERE a.user_id = auth.uid()), '[]'::jsonb),
    'daily_logs', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.study_date)
        FROM public.daily_logs d WHERE d.user_id = auth.uid()), '[]'::jsonb),
    'study_sessions', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.study_date)
        FROM public.study_sessions x WHERE x.user_id = auth.uid()), '[]'::jsonb)
  );
$$;

-- 3. Atomic multi-table mutation: log work = insert log + roll up progress
--    in ONE transaction (replaces client-side dual writes + rollup merging).
CREATE OR REPLACE FUNCTION public.log_work(
  p_client_id     text,
  p_subtopic_id   text,
  p_subtopic_name text,
  p_hours         numeric,
  p_study_date    date DEFAULT CURRENT_DATE,
  p_source        text DEFAULT 'timer'
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  INSERT INTO public.daily_logs (user_id, client_id, study_date, subtopic_id, subtopic_name, hours, source)
  VALUES (auth.uid(), p_client_id, p_study_date, p_subtopic_id, p_subtopic_name, p_hours, p_source)
  ON CONFLICT (user_id, client_id) DO NOTHING;

  INSERT INTO public.topic_progress (user_id, subtopic_id, hours_spent, last_studied_at)
  VALUES (auth.uid(), p_subtopic_id, p_hours, p_study_date)
  ON CONFLICT (user_id, subtopic_id) DO UPDATE
    SET hours_spent     = public.topic_progress.hours_spent + EXCLUDED.hours_spent,
        last_studied_at = GREATEST(public.topic_progress.last_studied_at, EXCLUDED.last_studied_at);
END; $$;

-- 4. Atomic full-progress reset (replaces client purge loops, syncEngine.ts:130-152).
CREATE OR REPLACE FUNCTION public.reset_user_data(p_scope text DEFAULT 'all')
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  IF p_scope IN ('all','progress') THEN
    DELETE FROM public.topic_progress      WHERE user_id = auth.uid();
    DELETE FROM public.assessment_progress WHERE user_id = auth.uid();
  END IF;
  IF p_scope IN ('all','logs') THEN
    DELETE FROM public.daily_logs     WHERE user_id = auth.uid();
    DELETE FROM public.study_sessions WHERE user_id = auth.uid();
  END IF;
END; $$;

-- 5. Dead-schema removal (after client migration is complete).
DROP TABLE IF EXISTS public.sync_queue;
DROP TABLE IF EXISTS public.device_info;
ALTER TABLE public.topic_progress      DROP COLUMN IF EXISTS device_id, DROP COLUMN IF EXISTS sync_version;
ALTER TABLE public.assessment_progress DROP COLUMN IF EXISTS device_id, DROP COLUMN IF EXISTS sync_version;
ALTER TABLE public.daily_logs          DROP COLUMN IF EXISTS device_id, DROP COLUMN IF EXISTS sync_version, DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE public.study_sessions      DROP COLUMN IF EXISTS device_id, DROP COLUMN IF EXISTS sync_version, DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE public.study_events        DROP COLUMN IF EXISTS device_id, DROP COLUMN IF EXISTS sync_version;
ALTER TABLE public.settings            DROP COLUMN IF EXISTS device_id, DROP COLUMN IF EXISTS sync_version;
DROP INDEX IF EXISTS idx_daily_logs_deleted_at;
DROP INDEX IF EXISTS idx_study_sessions_deleted_at;

COMMIT;
```
*(Do not run until the client migration in §18 reaches step 6.)*

---

## 11. Repository Review (services, contexts, hooks, engines, screens)

- **TrainingContext (679 lines)** — carries four responsibilities: state, mutation math, persistence wiring, sync adoption. The mutation math (`logSession`, `toggleSubTopic`, etc., lines 207-621) is clean and survives the redesign; effects #1–#3 (`:78-186`) and the `training:remote-merge`/`training:remote-purge` listeners (`:97-119`) are all deleted in cloud-first. The `window.dispatchEvent` string-event bus between contexts and the engine (`sync:request`, `sync:realtime`, `training:remote-merge`, `training:remote-purge`, `training:theme-applied`, `training:date-offset-applied`, `training:purge`) is an untyped hidden dependency graph — replace with direct function calls into the store.
- **SyncContext / SyncEngine / outbox / mappers / trainingDiff / SyncStatus / deviceId / latestData** — deleted wholesale. `mappers.ts` survives in spirit (the only place knowing row shapes) inside the new repository layer. `latestData.ts` is a module-global escape hatch documenting the debounce race it papers over (`latestData.ts:5-10`) — a smell that disappears with the debounce.
- **trainingRepository.ts** — `saveTrainingData` clears and rewrites *all* logs and sessions on every debounced save (`:188-204`): O(dataset) I/O per edit and a widening loss window as data grows. Deleted.
- **eventRepository.ts** — becomes a one-line `insert` into `study_events` (drop the local cap/trim loop).
- **AuthContext / authService** — good; keep unchanged. Silent permanent-account sign-in is the right call (§12).
- **TimerContext** — correctly device-local via localStorage; keep. Consider also writing a `timer.started` event so an abandoned timer is visible cross-device (nice-to-have).
- **adaptiveEngine / readinessEngine / layoutEngine** — pure functions over `TrainingData`; the redesign's biggest asset. Zero changes needed if the store hydrates the same `TrainingData` shape (recommended interim), or trivially adapted to a normalized store later. `JOINING_DATE` hardcoded (`adaptiveEngine.ts:27`) should come from `profiles.joining_date`.
- **Screens** — all consume `useTraining()`/`useSync()`; none touch storage directly (verified by grep: no driver/localDatabase imports in screens). UI impact of the migration ≈ zero except DiagnosticsScreen (rebuild around connection status, realtime channel state, last snapshot age) and PresetsScreen's backup/restore section (point at cloud backups).
- **Hooks/components** — derive everything from `metrics = useMemo(calculateMetrics(data))` (`TrainingContext.tsx:188-191`); dashboards/analytics update automatically on any state change. This already gives cloud-first "everything recomputes instantly" for free.

## 12. Authentication Review

Current: silent sign-in with a permanent account; credentials inlined at build time via `VITE_DEV_EMAIL`/`VITE_DEV_PASSWORD` (`src/config/devCredentials.ts:22-27`); session persistence + auto-refresh delegated to the SDK (`supabaseClient.ts:56-61`); boot restores session, falls back to password sign-in (`authService.ts:85-107`).

**Recommendation: keep exactly this.** For a permanent single-user app it is the simplest stable design: no login UI, survives token expiry, works identically on web and APK. RLS still protects the row space if the anon key leaks. Two hygiene notes: (1) anyone who obtains the APK can extract the credentials — acceptable for a personal app, but don't reuse that password anywhere; a marginal upgrade is an Edge Function that exchanges a device secret for a session, as the file's own comment anticipates. (2) Add one visible "signed out / auth failed" UI state — in cloud-first, auth failure means read-only, and it must be obvious rather than silent.

## 13. Code Quality Review

**Strengths:** disciplined layering (drivers ← facade ← repos ← contexts), pure computation engine, exhaustive doc comments, meaningful test suites (2,000+ test lines; `syncEngine.test.ts` 545 lines), typed mappers isolated in one file, idempotent SQL migrations with validation queries.

**Weaknesses (evidence):**
- Comment/code drift: SyncContext header effectively promises a slow cadence while `PERIODIC_MS = 3_000` (`SyncContext.tsx:38`); `0001` claims "sync engine … multi-device awareness" for `device_info` which nothing uses; `syncEngine.ts` header promises "NEWEST updated_at wins" but no merge compares timestamps (`:449-511` compare values only).
- The most dangerous code path (remote-purge, `syncEngine.ts:421-434`) has **no test** (`grep purge syncEngine.test.ts` → only `purgeRemote`).
- Fire-and-forget error swallowing: `enqueueOp` "never throws" (`outboxRepository.ts:63-130` catch-all), `recordEvent` swallows all errors (`eventRepository.ts:34-36`), boot hydration swallows all errors into seed fallback (`TrainingContext.tsx:143-149`) — a corrupt DB silently becomes "fresh install".
- Hidden global mutable state (`latestData.ts`) and a string-typed window-event bus (7 event names) as inter-module API.
- `structuredClone(prev!)` non-null assertions in every mutation (`TrainingContext.tsx:210` et al.).
- Duplicated helpers: `collectSubtopics`/`collectAssessments` exist in both `syncEngine.ts:685-701` and `trainingDiff.ts:138-154`.

## 14. Performance Review

- **Cold start:** local hydration is fast, but correctness costs follow: first sync mutates state seconds after paint; every boot runs legacy-migration checks. Cloud-first: one snapshot call behind the existing splash; ~200–500 ms; stable thereafter.
- **Steady-state network (current):** every 3 s while online → `requestSync(2000)` (`SyncContext.tsx:151-153`); an eligible cycle performs: `auth.getSession`, `profiles` upsert (a **write** per cycle, `syncEngine.ts:183`), outbox scan, up to 6 delta SELECTs, backup check — order of 100+ requests/hour while idle, plus the realtime socket. Cloud-first: realtime socket + writes only on user action + one snapshot per launch/reconnect. **Net large reduction.**
- **Write amplification (current):** one checkbox tick → clone full tree, rewrite full `app_state` blob, clear+rewrite two projected stores (800 ms debounce), outbox write, cloud upsert. IndexedDB `transaction()` opens readwrite over **all stores** (`indexedDbDriver.ts:157`), serializing unrelated reads, with a non-atomic "independent transaction" fallback on contention (`:77-81`). Cloud-first: one row upsert.
- **Rendering:** `calculateMetrics` recomputes on every data change via `useMemo` — fine at 129 subtopics/`~10²-10³` logs; keep. Charts/heatmap derive from metrics; unchanged. If logs grow to many thousands, memoize per-slice (streaks vs distributions) before reaching for storage changes.
- **Realtime latency:** current path ≈ push + full cycle (1–4 s, sometimes dropped to the next poll). Cloud-first ≈ push + direct row application (~200–500 ms end-to-end).

## 15. Maintainability & 16-adjacent Production Readiness Review

**Maintainability:** the storage/sync infrastructure (~2,900 lines across `services/database` + `services/sync`) is ~3× the adaptive engine. Three drivers must be kept behaviorally identical (history shows they weren't — see fix comments P0-02/P0-03/P0-09 embedded in `nativeSqliteDriver.ts`). Every new synced field touches: `types.ts` → mutation → `trainingDiff` → `mappers` → merge function → SQL migration → local store, ×2 platforms. Cloud-first cuts this to: SQL column → repository function → state field.

**Production readiness (current): NOT production-ready.** P0-1 (idle-cycle local wipe) and P0-2 (deletes never propagate) are live data-integrity defects; P0-3 (clock-skew watermark) silently loses updates; the permanent-failure loop of P0-4 can wedge specific records forever. Strengths worth preserving: RLS everywhere, daily cloud backups with pruning, integrity checks, sync history/diagnostics UI, real test coverage.

**Production readiness (target):** cloud-first removes the entire defect class; residual risks are (a) Supabase availability — explicitly accepted per §0.1; the app should render a clear "reconnecting" banner and disable mutations rather than fall back to any local store; (b) free-tier project pausing after inactivity — mitigate with paid tier or a keep-alive ping; (c) realtime message gaps — mitigated by re-reading the server snapshot on reconnect.

---

## 16. Complete List of Problems (P0–P3)

### P0 — data loss / permanent divergence

**P0-1. Remote-purge false positive wipes local data on any quiet sync cycle.**
- **Root cause:** purge detection counts rows from **delta-filtered** downloads, not actual cloud state.
- **Evidence:** `syncEngine.ts:381-392` (each `remote[table]` filtered by `updated_at > lastSyncAt − 5min`) feeding `:423-434` (`totalRemoteRows === 0 && pendingKeys.size === 0 && hasLocalData && cutoffIso → dispatch 'training:remote-purge'`); handler resets to seed and persists it, `TrainingContext.tsx:107-114`. No test covers it (`syncEngine.test.ts` mentions only `purgeRemote`).
- **Impact:** once no remote change has occurred for > 5 min and the outbox is empty — i.e., the normal idle state — the next cycle can reset the device to seed. Cloud rows older than the watermark are never re-downloaded, so the data *appears* gone. Directly explains the reported symptoms.
- **Best solution:** cloud-first removes the heuristic entirely (factory reset becomes explicit `reset_user_data()` RPC + realtime).
- **Interim hotfix if staying:** detect purge only via an unfiltered `count()` probe of one table, or an explicit purge marker row. **Complexity:** low. **Risk of fix:** low.

**P0-2. Deletions never propagate — tombstones designed but never written.**
- **Root cause:** upload path hard-deletes; nothing sets `deleted_at`.
- **Evidence:** `supabase/migrations/0003_tombstones.sql` adds columns; merge honors them (`syncEngine.ts:522-529,545-552`); uploader does `client.from(table).delete()` (`syncEngine.ts:349-353`); repo-wide grep for `deleted_at` finds only the two merge reads.
- **Impact:** a log/session deleted on device A survives forever on device B (delta queries cannot return absent rows); if B later edits it, it re-uploads and **resurrects** on A. Permanent divergence.
- **Best solution:** cloud-first (real DELETE + realtime DELETE event + snapshot-on-reconnect). **Interim:** convert delete ops to `UPDATE … SET deleted_at = now()` upserts. **Complexity:** low-medium. **Risk:** low.

**P0-3. Delta watermark uses the client clock — skew silently loses updates.**
- **Root cause:** `lastSyncAt` written from `new Date()` on the device (`syncEngine.ts:189-191`), compared against server `updated_at` (`:384-389`); only a fixed 5-minute overlap defends it (`:70`, the comment itself documents the hazard).
- **Impact:** any device clock > 5 min ahead of Postgres permanently skips rows written in the gap → "some updates never arrive." Android clocks drift.
- **Best solution:** cloud-first (no watermark exists). **Interim:** derive the watermark from `max(updated_at)` of downloaded rows or a server-time RPC. **Complexity:** low. **Risk:** low.

**P0-4. Curriculum FK coupling can wedge uploads permanently.**
- **Root cause:** cloud `topic_progress.subtopic_id` FK → `subtopics(id)` (`0001:135`); app subtopic ids are generated positionally at bundle time (`curriculum.ts:59`); `seed_curriculum.sql` is regenerated by hand ("generated from createSeedData", seed header).
- **Impact:** any curriculum edit not mirrored to the cloud makes every upsert referencing a new id fail FK; ops hit `RETRY_CAP=8`, `resetStuckOps` (`syncEngine.ts:288`) re-enables them next cycle → infinite retry, progress "stays local only." Reordering subtopics also silently reattaches history to wrong ids. (Verified in-sync today: 129 ids in both bundle and seed — but unguarded.)
- **Best solution:** generate seed SQL from `createSeedData()` in CI; startup check comparing bundled ids to cloud ids with a loud error; longer term, treat cloud curriculum as authoritative with `curriculum_version` (column already exists). **Complexity:** medium. **Risk:** low.

### P1 — divergence / reliability

**P1-1. Multiple sources of truth for the same facts.** `hoursSpent` lives in app_state subtopics, local `daily_logs` projection, cloud `topic_progress.hours_spent`, and is derivable from cloud `daily_logs`; merges adopt remote rollups verbatim (`syncEngine.ts:465-478`) while logs merge append-only (`:513-563`) — a device can converge to `hours_spent ≠ SUM(logs)`. **Fix:** single writer per fact (the `log_work` RPC) or derive rollups server-side. Complexity: medium.

**P1-2. LWW without timestamps; non-commutative increments lost.** Merge compares values only, never `updated_at` (`syncEngine.ts:449-511` vs. header claim `:34-35`); two devices adding hours to the same subtopic inside a sync window lose one increment. **Fix:** cloud-first + additive RPC (`hours = hours + $1`). Complexity: low in target design.

**P1-3. Full projection rewrite per save; widening crash window.** `saveTrainingData` clears + rewrites all logs/sessions each debounced save (`trainingRepository.ts:188-204`); IDB fallback path abandons atomicity under contention (`indexedDbDriver.ts:77-81`). **Fix:** deleted in cloud-first. Complexity: n/a.

**P1-4. 3-second full-cycle polling incl. a cloud write per cycle.** `SyncContext.tsx:38,151-153`; `ensureProfile` upsert every cycle `syncEngine.ts:183`. Battery/network churn; realtime is reduced to a poll trigger; `requestSync` drops events while busy (`syncEngine.ts:123`) without rescheduling. **Fix:** event-driven realtime application (target design). Complexity: low in target.

**P1-5. 800 ms debounce + flush-on-hide loses the newest edits on crash/kill.** `TrainingContext.tsx:158-186`; Android process death without `pagehide` loses the window (and the outbox op may or may not have been written — they are separate stores, so local DB and outbox can disagree). **Fix:** synchronous per-action cloud writes (target). Complexity: n/a.

### P2 — correctness edges / hygiene

**P2-1.** Settings merge ignores `pendingKeys` and applies any downloaded `date_offset` even when a local change is queued (`syncEngine.ts:583-593`); theme uploaded but never applied on download (asymmetry with `settingsSync.ts:20`). Fix: per-field ownership.
**P2-2.** Dead cloud schema misleads maintainers: `sync_queue`, `device_info`, `app_meta` (client never touches them), `device_id`/`sync_version` columns (written, never read). Drop (SQL §10.3).
**P2-3.** `study_events` local cap 2000 with O(n log n) trim on insert (`eventRepository.ts:25-33`) vs unbounded cloud — the "immutable substrate" is silently lossy on-device. Cloud-only storage fixes it.
**P2-4.** Realtime DELETE events cannot match `user_id=eq.` filters without `REPLICA IDENTITY FULL` (not set anywhere in migrations) — even the current design's delete notifications are unreliable. Fix in §10.3.
**P2-5.** Bundled permanent credentials (`devCredentials.ts`) extractable from the APK. Accepted risk for single-user; document it; unique password; optional Edge Function exchange later.
**P2-6.** Boot error path silently replaces possibly-recoverable data with seed (`TrainingContext.tsx:143-149`) with no user-visible warning.
**P2-7.** `purgeCloudData`/`purgeRemote` loop non-atomically over tables (`syncEngine.ts:130-152,247-266`); a mid-loop failure leaves partial cloud state that the purge detector may then misread. Replace with `reset_user_data()` RPC.

### P3 — polish

**P3-1.** Comment drift (3 s vs documented slow cadence; "NEWEST updated_at wins" vs value-compare; `device_info` claims). **P3-2.** Duplicated `collectSubtopics/collectAssessments` (syncEngine vs trainingDiff). **P3-3.** Hardcoded `JOINING_DATE = 2026-09-21` (`adaptiveEngine.ts:27`) — move to `profiles.joining_date`. **P3-4.** String window-event bus (7 event names) as inter-module API. **P3-5.** Unused Supabase views; convoluted `v_module_progress` grouping. **P3-6.** `package.json` mixes `@capacitor/*` v8 runtime with `@capacitor/cli` v7 — verify intentional. **P3-7.** Non-null assertions `structuredClone(prev!)` in all mutations.

---

## 17. Final Recommendation

**Adopt pure Supabase Cloud-First. Remove SQLite/IndexedDB persistence, the outbox, the sync engine, and the merge layer entirely.**

Engineering justification, in order of weight:
1. **Correctness:** every reported symptom traces to reconciling two persistent stores (P0-1 idle wipe, P0-2 delete divergence, P0-3 watermark skew, P1-1/P1-2 merge semantics). Cloud-first eliminates the defect class, not just the defects — there is nothing to reconcile.
2. **Fit to constraints:** one user, permanently online, consistency prized (§0). Offline-first was the only justification for the outbox/merge complexity, and it is explicitly out of scope — which removes the last load-bearing argument for any local store.
3. **Scale reality:** the full dataset is a few hundred rows; a single snapshot RPC beats any cache-coherence protocol.
4. **Simplicity dividend:** ~2,900 infra lines → ~500; one mental model ("the table is the truth"); Supabase Studio becomes the debugger; the pure adaptive engine — the actual product — is untouched.
5. **SQLite retention was tested against evidence and failed on every admissible dimension:** it is used as a JSON key-value blob store, accelerates nothing measurable, and is the substrate of the divergence. The "keep it as a runtime cache" compromise is rejected too — a cache is a second copy of the truth, and the entire defect class in §16 arises from having two copies. **Local data persistence is removed completely, with no snapshot, no stale-while-revalidate tier, and no read-only offline view.** Volatile React memory is the only client-side copy, and it dies with the page.

**Answer to the posed question:** the application should **not** continue with SQLite + Sync + Supabase. It should move to a pure Supabase cloud-first architecture with zero local data persistence.

## 18. Safe Migration Plan (no data loss, reversible until step 7)

Preconditions: apply the **interim hotfix for P0-1** first (disable/guard the remote-purge dispatch) so no device wipes itself during the transition; take a manual export from the healthiest device (Presets → backup) and a cloud `backups` snapshot.

1. **Freeze & reconcile truth (no code changes).** On the device with the most complete data: force a full upload (outbox drain), then verify in Supabase Studio that `topic_progress`, `daily_logs`, `study_sessions`, `assessment_progress` match that device (spot-check counts + latest rows). Where cloud is missing local rows, use the export JSON to backfill via SQL editor. Cloud is now declared canonical.
2. **Ship SQL primitives.** Run §10.3 items 1–4 only (`REPLICA IDENTITY`, `get_user_snapshot`, `log_work`, `reset_user_data`). Purely additive; old clients unaffected.
3. **Build the repository layer** (`services/cloud/`): `loadAll()` via `get_user_snapshot()` reassembling the existing `TrainingData` shape (bundled curriculum + cloud progress overlay — mirror of today's merge mappers), plus per-action mutations. Unit-test against a test project.
4. **Rewire TrainingContext behind the same public API.** Replace boot hydration with `loadAll()`; replace each mutation's persistence side with optimistic patch + awaited repository call; delete effects #1–#3 and the window-event listeners. Screens and engine remain untouched. Keep the old code path behind a build flag for one release if desired.
5. **Rewire realtime** to apply row payloads directly to state; `loadAll()` on channel reconnect/app resume. Delete SyncContext's polling loop; keep a slim SyncContext exposing `isOnline`/`lastLoadedAt` for the UI.
6. **Verify on both platforms** (web + APK): tick/untick, log/delete work, assessments, settings offset, two-device convergence < 1 s, kill-and-relaunch, airplane-mode behavior (clear read-only messaging).
7. **Delete dead client code:** `services/database/*` (all drivers, LocalDatabase, migrations, legacyMigration), `services/sync/*` except the new realtime module, `trainingRepository`, sync stores. Keep `localStorage` theme/timer. Rebuild DiagnosticsScreen around connection/realtime/snapshot-age.
8. **Run §10.3 item 5** (drop `sync_queue`, `device_info`, LWW columns, tombstone columns/indexes) once no old client build remains installed.
9. **Backups:** keep the daily snapshot (now trivially `get_user_snapshot()` → `backups` upsert on app open, or `pg_cron` server-side) and the manual export button.

Rollback: until step 7 the old path still exists behind the flag and cloud data is a superset of local — reverting is a build flag flip.

---

*Report generated as a read-only architecture review. No repository files were modified. All file/line references are against the current snapshot at `/tasklet/agent/home/infi-training/`.*

