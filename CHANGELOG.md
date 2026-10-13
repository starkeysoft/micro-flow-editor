# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-10-13

### Added

- **Optional sign-in**, off by default. Turn it on in the new **Settings** dialog (flows page header,
  or **⋯ → Settings…** on the canvas), which asks for an account in the same step: the first account
  is created if there are none, otherwise an existing one must sign in. Or force it on or off with
  `AUTH_ENABLED` (`--auth[=true|false]`, `startServer({ auth_enabled })`), which locks the switch.
  While it is on, the editor and every `/api` route need a session; `/webhook/*` stays public.
- Login page (`/login`, with `?next=`), which creates the first account when there are none.
  Settings also covers your account (sign out, change password) and the user list (add and delete
  users). Every user can see and edit every flow; there are no roles. The canvas's ⋯ menu gains
  **Settings…** and **Sign out**.
- `/api/auth/*` routes: `session`, `login`, `setup`, `logout`, `enable`, `disable`, `password` and
  `users`. Other `/api` routes answer `401 { error, auth_required: true }` when signed out, and
  `GET /api/meta` reports `auth_enabled`.
- Passwords hashed with scrypt; sessions stored in the database as the SHA-256 of a random token
  held in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` over HTTPS), renewed at half their life.
  Cross-site state-changing requests are refused (`Origin` is checked against the host, which
  follows `X-Forwarded-Host` with `TRUST_PROXY`), and 10 failed sign-ins per IP in 15 minutes (at
  login or when turning sign-in on) return `429`. Usernames are case-insensitive (stored lowercase).
- `micro-flow-editor user <list|add|passwd|remove>` CLI command for managing accounts and resetting
  forgotten passwords (passwords from a hidden prompt or stdin).
- Settings `AUTH_ENABLED`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_TTL_HOURS` and `TRUST_PROXY`
  (environment, `startServer()` options and Docker Compose).
- `settings`, `users` and `sessions` tables, created on startup.
- **Autosave.** The editor saves every change about 400 ms after it is made (one request at a time,
  retried every 3 s while the server can't be reached). The top bar shows **Saved**, **Saving…** or
  **Offline – retrying** (on phones only the offline state). Leaving the page saves first: route
  changes wait for the pending save, closing the tab sends a `keepalive` request (flows over about
  60 KB ask the browser to confirm instead), and hiding the tab saves straight away.
- Write-behind autosave cache on the server (`server/drafts.js`): drafts go to
  `PUT` (or `POST`, for keepalive) `/api/flows/:id/draft` and into the cache only; a background worker
  writes them to the flow's row every `FLUSH_INTERVAL_MS` (default 1000). Reads write a flow's
  pending draft first, `GET /api/flows` writes them all, and shutdown flushes everything before the
  database closes. The cache is in-process by default, or Redis with `REDIS_URL` (survives a restart
  of the editor and can be shared by several instances; `redis` is an optional dependency). The
  startup log names the cache (`autosave cache: memory|redis`).
- **Snapshots.** Save (Ctrl/⌘ + S, the Save button, or the drawer's new **Snapshots** tab with an
  optional label) stores a version of the flow in the new `snapshots` table. The Snapshots tab lists
  them with a live/latest badge and can restore one onto the canvas (Ctrl/⌘ + Z undoes it), download
  it as an importable export, or delete it. The Save button shows an amber dot when there are changes
  since the latest snapshot. `MAX_SNAPSHOTS_PER_FLOW` (default 100, `0` keeps all) prunes the oldest.
- Routes `GET`/`POST /api/flows/:id/snapshots`, `GET /api/snapshots/:id`,
  `GET /api/snapshots/:id/export` and `DELETE /api/snapshots/:id`. `GET /api/flows/:id` (and every
  route returning a full flow) includes `snapshot: { latest, changed_since }`.
- Settings `REDIS_URL`, `FLUSH_INTERVAL_MS` and `MAX_SNAPSHOTS_PER_FLOW` (environment, `startServer()`
  options `redis_url`, `flush_interval_ms`, `max_snapshots_per_flow`, and Docker Compose), plus an
  optional `redis` Compose profile (`redis:7.4-alpine`, append-only, `micro-flow-editor-redis` volume).
- **Archiving flows.** An **Archive** button (box icon, next to Export JSON) on each flow card and
  **⋯ → Archive flow…** in the editor (both ask first; the editor sends pending edits, then returns
  to the flows page) take a flow out of the flow list: its triggers and running executions stop,
  edits that aren't in a snapshot are saved as an `Archived` snapshot, the latest snapshot is copied
  into the new `archived_flows` table, and the flow, its executions and all its snapshots are
  deleted, in one transaction. A collapsed **Archived** section at the bottom of the flows page lists
  archived flows (name, description, triggers, node count, when and by whom) with **Unarchive**,
  **Download** and **Delete permanently**. Unarchiving recreates the flow with the same id (so old
  links work), switched off, with the kept snapshot as its only snapshot and the original creation
  times. Opening an archived flow's URL says it is archived instead of "does not exist".
- Routes `POST /api/flows/:id/archive`, `GET /api/archive`, `GET /api/archive/:id`,
  `GET /api/archive/:id/export`, `POST /api/archive/:id/unarchive` (`409` if a flow with that id
  exists) and `DELETE /api/archive/:id`.

### Changed

- An active flow's only snapshot can't be deleted (`409`), so its triggers never fall back to the
  autosaved working copy. `PUT /api/flows/:id` with `options` now saves a snapshot, like `graph`.
  When re-registering triggers fails, replies carry `deactivated: true` and the editor turns its
  Active switch off.

- **Active flows run their latest snapshot.** Webhooks and schedules are registered from, and run,
  the newest snapshot instead of the flow row, so autosaved, half-finished edits never go live.
  Flows without a snapshot (such as flows from 1.0.0) keep running their row. Turning a flow on
  creates an `Activated` snapshot when it has changes that aren't in one; saving or deleting a
  snapshot of an active flow re-registers its triggers.
- `PUT /api/flows/:id` with a `graph` discards any pending autosave draft and creates a
  `Saved through the API` snapshot, which an active flow then runs.
- **Ctrl/⌘ + S** and the **Save** button now save a snapshot. The "Unsaved changes" indicator and
  the "unsaved changes" prompts on leaving the page and signing out are gone. Duplicate flow, the
  Active switch and Sign out send pending edits first.
- Deleting a flow also deletes its snapshots.
- Node counts on the flows page read "1 node" / "N nodes".
- Opening a flow while the server can't be reached (for example during a restart) shows
  "Reconnecting to the server…" and retries up to 8 times before giving up.
- The Docker health check now probes `GET /api/auth/session`, which stays public when sign-in is on
  (`GET /api/meta` now needs a session).

## [1.0.0] - 2026-10-08

Initial release, built on `@ronaldroe/micro-flow` 4.0.0.

### Added

- **Visual editor** (Vue 3 + Vue Flow): drag-and-drop canvas with a node palette, an inspector
  (Parameters / Settings / Data tabs) and a drawer (Output / Log / Executions / micro-flow tabs).
  Includes undo/redo, copy/paste/duplicate, quick-add by dropping a wire on empty canvas, inserting
  a node on a wire, tidy layout, a minimap, keyboard shortcuts and a touch layout for phones (bottom
  sheets, floating + button, tap-to-connect ports).
- **19 node types** compiling to micro-flow classes: Manual, Schedule and Webhook triggers; HTTP
  Request, Edit Fields, Transform, Random Number; If (`ConditionalStep`), Switch (`SwitchStep` +
  `Case`), Filter (`FlowControlStep` break), Skip Next If (`FlowControlStep` skip); Loop Over Items,
  Repeat and Repeat While (`LoopStep` for_each / for / while); Wait (`DelayStep`); Chaos Monkey;
  Output Card, Log and Respond to Webhook.
- **Graph compiler** that turns a flow into a root `Workflow` with nested `Workflow`s for branches,
  fan-out and loop bodies, mapping node settings to `max_retries` / `max_timeout_ms` and the flow
  option to `exit_on_error`.
- **Expressions**: `{{ path }}` templates with `$item`, `$trigger`, `$node["Name"]`, `$now` and
  `$execution` roots. No code node, no `eval`.
- **Server**: runs flows, records every execution (node inputs/outputs per pass, log, output cards),
  streams live updates over Server-Sent Events, and listens on Schedule (interval or cron) and
  Webhook (`/webhook/<path>`) triggers of active flows.
- **REST API** for flows, executions, import/export, runs, previews and the live stream.
- **Databases** through Sequelize: SQLite by default; PostgreSQL, MySQL, MariaDB and SQL Server via
  `DATABASE_URL`.
- **Runtime** (`@ronaldroe/micro-flow-editor/runtime`): `compileFlow()` and `runFlow()` run exported
  flows in any Node.js app without the server or a database.
- **`startServer()`** programmatic API and the `micro-flow-editor` CLI.
- **Docker** image (`node:24-trixie-slim`) and Compose file with optional PostgreSQL and MySQL
  profiles.
- SSRF guard for HTTP Request nodes (`BLOCK_PRIVATE_NETWORKS`), and limits on concurrent runs, loop
  passes and kept executions.
- Five starter templates: Pokémon type sorter, Weather board, Dog gallery, Flaky API, Webhook echo
  API.
