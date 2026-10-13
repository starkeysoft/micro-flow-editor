# REST API

The editor's client talks to the server only through this API, so anything the editor does can be scripted. Routes live in `server/api/flows.js`, `server/api/stream.js`, `server/api/webhooks.js`, `server/auth.js` and `server/server.js`.

Sign-in is optional and off by default (see [Server: Sign-in](server.md#sign-in)). While it is on, every `/api` route except [`/api/auth/*`](#sign-in) needs a session cookie; `/webhook/*` never does.

## Table of Contents
- [Conventions](#conventions)
- [Sign-in](#sign-in)
- [Meta](#meta)
- [Flows](#flows)
- [Autosave](#autosave)
- [Snapshots](#snapshots)
- [Archive](#archive)
- [Import and Export](#import-and-export)
- [Running](#running)
- [Executions](#executions)
- [Live Event Stream](#live-event-stream)
- [Webhooks](#webhooks)
- [Other Paths](#other-paths)

## Conventions

- Request and response bodies are JSON. `/api` accepts bodies up to 4 MB.
- Errors are `{ "error": "message" }`. Graph errors add `node_id`.

| Status | Meaning |
|--------|---------|
| `400` | Invalid input (unknown node type, duplicate node ids, more than 500 nodes, a trigger that couldn't be activated). |
| `401` | Sign-in is on and there is no valid session: `{ "error": "sign in first", "auth_required": true }`. |
| `403` | Sign-in is on and a state-changing request came from another site: `{ "error": "cross-site request refused" }`. |
| `404` | Unknown flow, snapshot, archived flow, execution or route. |
| `409` | Conflict: for example the only snapshot of an active flow, or unarchiving a flow whose id is in use. |
| `422` | The graph can't be compiled (`GraphError`): `{ error, node_id }`. |
| `429` | The server is already running `MAX_CONCURRENT_RUNS` flows. |
| `500` | Anything else. |

Graphs sent to the API are cleaned before use: unknown node types are rejected, missing config keys and settings are filled with defaults, names and ids are trimmed to length (a blank name becomes the type's title), wires to missing nodes and duplicate wires are dropped, and a wire's port defaults to `main`. See [Data Model](data-model.md#graph).

## Sign-in

These routes are always reachable, whether you are signed in or not. The session is the `mfe_session` cookie (see [Server: Sessions and Cookies](server.md#sessions-and-cookies)); a script must keep the `Set-Cookie` it gets back and send it as `Cookie` on later requests. Errors are `{ "error": "message" }`, without `auth_required`.

While sign-in is on, every other `/api` route checks the request before it runs:

- a `POST`, `PUT`, `DELETE` or other non-`GET`/`HEAD`/`OPTIONS` request whose `Origin` header names another host than the request's (`Host`, or `X-Forwarded-Host` when `TRUST_PROXY` is set) gets `403 { "error": "cross-site request refused" }` (no `Origin` header is fine);
- a request without a valid session gets `401 { "error": "sign in first", "auth_required": true }`. The editor uses `auth_required` to send you to its login page.

```bash
curl -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"correct horse"}' http://localhost:8090/api/auth/login
curl -b cookies.txt http://localhost:8090/api/flows
```

A **user** object is `{ "id": "…", "username": "admin", "created_at": "…", "last_login_at": "…" }` (`last_login_at` is `null` until the first sign-in).

Routes marked *signed in* answer `404 { "error": "Sign-in is turned off on this server." }` while sign-in is off, and otherwise check the `Origin` (`403`) and the session (`401 { "error": "sign in first" }`).

### GET /api/auth/session

Whether sign-in is on, and who you are. Renews the session like any signed-in request.

```json
{ "auth_enabled": true, "auth_locked": false, "needs_setup": false, "has_users": true, "user": { "id": "…", "username": "admin", "created_at": "…", "last_login_at": "…" } }
```

| Field | Description |
|-------|-------------|
| `auth_enabled` | Whether sign-in is required right now. |
| `auth_locked` | `true` when `AUTH_ENABLED` decides, so `enable` / `disable` are refused. |
| `needs_setup` | Sign-in is on and there are no accounts: [`setup`](#post-apiauthsetup) creates the first one. Always `false` while sign-in is off. |
| `has_users` | Whether any account exists. |
| `user` | You, or `null` (always `null` while sign-in is off). |

`200`. Always public, so the Docker health check uses this route.

### POST /api/auth/login

```json
{ "username": "admin", "password": "correct horse" }
```

Signs in: sets the cookie and records `last_login_at`. The username is case-insensitive. `200 { "user": { … } }`.

| Status | When |
|--------|------|
| `401` | `Wrong username or password.` |
| `403` | Cross-site `Origin`. |
| `404` | Sign-in is off. |
| `429` | 10 failed sign-ins (here or at `enable`) from this IP in the last 15 minutes. |

### POST /api/auth/setup

Creates the **first** account and signs it in. Same body as `login`. Only works while sign-in is on and there are no accounts. `201 { "user": { … } }`.

| Status | When |
|--------|------|
| `400` | Invalid username or password (usernames 1–64 characters of letters, digits and `_ . @ -`, stored in lowercase; passwords 8–256 characters). |
| `403` | Cross-site `Origin`. |
| `404` | Sign-in is off. |
| `409` | An account already exists (`This server already has an account. Sign in instead.`). |

### POST /api/auth/logout

Deletes the session (if the cookie names one) and clears the cookie. Works whether sign-in is on or off. `204`, or `403` for a cross-site `Origin`.

### POST /api/auth/enable

Turns sign-in on (the editor's switch) and signs you in. Same body as `login`. With no accounts, it creates one from the body; otherwise the body must match an existing account. `200 { "user": { … } }`.

| Status | When |
|--------|------|
| `400` | No accounts yet and the username or password is invalid. |
| `401` | Accounts exist and the credentials don't match one (`Sign in with an existing account to turn sign-in back on.`). Counts as a failed sign-in for the rate limit. |
| `403` | Cross-site `Origin`. |
| `409` | Sign-in is already on, or `AUTH_ENABLED` is set. |
| `429` | 10 failed sign-ins from this IP in the last 15 minutes (`Too many failed sign-ins…`). |

### POST /api/auth/disable

*Signed in.* Turns sign-in off (the editor's switch). Accounts are kept. `204`, or `409` when `AUTH_ENABLED` is set.

### POST /api/auth/password

*Signed in.* Changes your own password and signs out your other sessions (this one stays).

```json
{ "current_password": "correct horse", "new_password": "battery staple" }
```

`204`. `403` when `current_password` is wrong (`Your current password is wrong.`), `400` when the new password isn't 8–256 characters.

### GET /api/auth/users

*Signed in.* Every account, by username: `[{ user }, …]`. `200`.

### POST /api/auth/users

*Signed in.* Adds an account. Body `{ "username", "password" }`; the username is stored in lowercase. `201` with the user, `400` for an invalid username or password, `409` when the username is taken (in any case).

### DELETE /api/auth/users/:id

*Signed in.* Deletes an account and signs it out everywhere. `204`. `409` for your own account (`You can't delete your own account.`), `404` for an unknown id.

## Meta

### GET /api/meta

```json
{ "dialect": "sqlite", "block_private_networks": false, "max_loop_iterations": 1000, "auth_enabled": false }
```

`auth_enabled` says whether sign-in is on. Like every non-`auth` route, this one needs a session while sign-in is on (`401` otherwise); use [`GET /api/auth/session`](#get-apiauthsession) to check without one.

## Flows

### Flow Objects

`GET /api/flows` returns **summaries**:

```json
{
  "id": "3b0c…",
  "name": "Weather board",
  "description": "Loop over cities → …",
  "active": false,
  "node_count": 10,
  "triggers": ["manual"],
  "updated_at": "2026-10-08T09:00:00.000Z",
  "created_at": "2026-10-08T08:00:00.000Z",
  "last_execution": { "id": "…", "status": "success", "started_at": "…", "mode": "manual" }
}
```

`triggers` lists the distinct trigger types in the graph. Routes that return a single flow return the **full** flow: a summary, plus:

| Field | Description |
|-------|-------------|
| `graph` | The [graph](data-model.md#graph). |
| `options` | `{ exit_on_error }`. |
| `listening` | `{ webhooks: ["POST greet", …], schedules: 1 }`: what the server has registered for this flow right now. |
| `snapshot` | `{ latest, changed_since }`. `latest` is the newest [snapshot](#snapshots) as `{ id, label, name, created_by, created_at, node_count }`, or `null` when the flow has none. `changed_since` is `true` when the flow's `name`, `description`, `graph` or `options` differ from that snapshot (or there is none). An active flow's triggers run `latest`. |

`graph`, `options`, `name` and `description` are the flow's **autosaved working copy**: what the editor last sent, written to the database by the [autosave](#autosave) worker. Every route that reads a flow writes its pending draft first, so they are never behind the editor's last accepted draft.

```json
"snapshot": {
  "latest": { "id": "9f1e…", "label": "Before the API change", "name": "Weather board", "created_by": "admin", "created_at": "2026-10-08T09:00:00.000Z", "node_count": 10 },
  "changed_since": false
}
```
### GET /api/flows

All flows, most recently updated first, as summaries. Writes every pending autosave draft first (a failure there is logged, and the list is still returned). `200`.

### POST /api/flows

Creates a flow. Every field is optional.

```json
{ "name": "My flow", "description": "", "graph": { "nodes": [], "edges": [] }, "options": { "exit_on_error": true } }
```

Without a `graph`, the flow gets a single Manual Trigger with id `trigger`, named **Start**. The name defaults to `Untitled flow`. New flows are inactive. `201` with the full flow.

### GET /api/flows/:id

`200` with the full flow, or `404`.

### PUT /api/flows/:id

Updates any of `name`, `description`, `graph`, `options` and `active`. Fields you leave out are kept.

```json
{ "active": true }
```

- **With a `graph` or `options`**, this is a save, for API clients: a `graph` discards any pending autosave draft of the flow; the changes are written and a [snapshot](#snapshots) labelled `Saved through the API` is created, which an active flow then runs.
- **Turning a flow on** (`"active": true` on an inactive flow) creates a snapshot labelled `Activated` if the flow (name, description, graph or options) differs from its latest snapshot, so the triggers start with what you see.
- Other changes (`name` or `description` alone, or `active`) only update the flow row and don't create a snapshot.

The snapshot's `created_by` is the signed-in username, or `null`.

After saving, the flow's triggers are registered again from its latest snapshot (or dropped if it's inactive). If that fails, for example because of a bad cron expression or a webhook clash, the changes (and any snapshot) are **kept** but the flow is set to inactive, and the reply is `400` with `{ "error": "… The flow has been turned off.", "deactivated": true }`. Otherwise `200` with the full flow. `POST /api/flows/:id/snapshots` and `DELETE /api/snapshots/:id` answer the same way when re-registering fails.

### DELETE /api/flows/:id

Stops the flow's running executions, drops its triggers, discards its pending autosave draft, and deletes the flow, all its executions and all its snapshots. `204`.

### POST /api/flows/:id/duplicate

Copies the flow's autosaved working copy as `<name> (copy)`, inactive and without snapshots. `201` with the new full flow.

## Autosave

The editor sends its whole document here after every change (see [Server: Autosave](server.md#autosave)). The draft goes into the autosave cache only; a background worker writes it to the flow's row within `FLUSH_INTERVAL_MS`. Drafts don't create snapshots and don't change what an active flow runs.

### PUT /api/flows/:id/draft

Also accepted as `POST`, for `fetch(…, { keepalive: true })` when a tab closes.

```json
{ "name": "Weather board", "description": "", "graph": { "nodes": [ … ], "edges": [ … ], "viewport": { "x": 0, "y": 0, "zoom": 1 } }, "options": { "exit_on_error": true } }
```

`graph` is required and cleaned like any other graph. The name defaults to `Untitled flow` and the description to empty; leaving out `options` gives `{ "exit_on_error": true }`. Every field replaces the stored one, so send the whole document each time.

`200` with `{ "version": "1760345400000-3fa1c2d4e5b6", "updated_at": "2026-10-13T09:30:00.000Z", "cache": "memory" }` (`cache` is `memory` or `redis`). `404` for an unknown flow (checked on every draft; any cached draft for that id is discarded too, so edits to a flow deleted elsewhere aren't silently accepted), `400` without a `graph` (`a draft needs a graph`) or for an invalid one.

## Snapshots

A snapshot is a saved version of a flow: its name, description, graph and options at that moment. The **Save** button in the editor creates one. An active flow's webhooks and schedules run its **latest** snapshot (see [Triggers: Active Flows](triggers.md#active-flows)). A **snapshot summary** is:

```json
{ "id": "9f1e…", "label": "Before the API change", "name": "Weather board", "created_by": "admin", "created_at": "2026-10-08T09:00:00.000Z", "node_count": 10 }
```

`label` is empty when none was given; `created_by` is the signed-in username, or `null` with sign-in off.

### GET /api/flows/:id/snapshots

The flow's snapshots, newest first, as summaries. The newest has `"live": true`, the others `"live": false` (`live` means "latest": an inactive flow runs nothing). `200`, or `404` for an unknown flow.

### POST /api/flows/:id/snapshots

Saves a snapshot. The body is optional:

```json
{ "label": "Before the API change" }
```

Writes the flow's pending autosave draft, then copies the flow into a new snapshot (labels are cut to 200 characters). Snapshots beyond `MAX_SNAPSHOTS_PER_FLOW` are deleted, oldest first. If the flow is active, its triggers are registered again from the new snapshot; if that fails, the snapshot is kept, the flow is set to inactive and the reply is `400` (as for [PUT /api/flows/:id](#put-apiflowsid)). Otherwise `201` with the summary and `"live": true`.

### GET /api/snapshots/:id

One snapshot: the summary plus `flow_id`, `description`, `graph` and `options`. `200`, or `404` (`snapshot not found`).

### GET /api/snapshots/:id/export

Downloads the snapshot in the same [export format](data-model.md#export-format) as [`GET /api/flows/:id/export`](#get-apiflowsidexport), so `POST /api/flows/import` accepts it. The file is named after the flow and the snapshot's UTC time: `Weather-board-2026-10-08-09-00.json`.

### DELETE /api/snapshots/:id

Deletes a snapshot. `204`, or `404`. If the flow is active, its triggers are registered again, so deleting the latest snapshot makes the one before it live. The **only** snapshot of an active flow can't be deleted (`409`), because the triggers would then run the autosaved working copy; turn the flow off first or save another snapshot. If re-registering fails, the flow is set to inactive and the reply is `400` with `deactivated: true`.

## Archive

Archiving takes a flow out of the flows table and keeps only its most recent snapshot, in the `archived_flows` table (see [Data Model](data-model.md#archived-flows)). Unarchiving recreates the flow from it. An **archived summary** is:

```json
{
  "id": "4c0d…",
  "name": "Weather board",
  "description": "",
  "node_count": 10,
  "triggers": ["schedule"],
  "archived_at": "2026-10-13T09:30:00.000Z",
  "archived_by": "admin",
  "snapshot": { "id": "9f1e…", "label": "Before the API change", "created_at": "2026-10-08T09:00:00.000Z", "created_by": "admin" }
}
```

`id` is the flow's id. `triggers` lists the distinct trigger node types in the graph. `archived_by` is the signed-in username, or `null` with sign-in off. `snapshot` describes the kept snapshot.

### POST /api/flows/:id/archive

Archives a flow:

1. Writes the flow's pending autosave draft, drops its triggers and stops its running executions.
2. If the flow has no snapshot, or its name, description, graph or options differ from its latest snapshot, saves a snapshot labelled `Archived` (`created_by` is the signed-in username, or `null`).
3. In one transaction: copies the latest snapshot into `archived_flows`, then deletes the flow's executions, **all** its snapshots and the flow itself.
4. Discards any cached autosave draft.

`200` with the archived summary, or `404` for an unknown flow.

### GET /api/archive

All archived flows, most recently archived first, as summaries. `200`.

### GET /api/archive/:id

One archived flow: the summary plus `graph` and `options`. `200`, or `404` (`archived flow not found`).

### GET /api/archive/:id/export

Downloads the archived flow in the same [export format](data-model.md#export-format) as [`GET /api/flows/:id/export`](#get-apiflowsidexport), named after the flow (`Weather-board.json`), so `POST /api/flows/import` accepts it as a new flow. `404` when not archived.

### POST /api/archive/:id/unarchive

Brings an archived flow back. In one transaction it recreates the flow with the **same id** (so old links work), **inactive**, from the kept snapshot; recreates that snapshot (same id, label and `created_by`) as the flow's only snapshot; puts back the original creation times of the flow and the snapshot (whole seconds on MySQL); and deletes the archived row. Executions don't come back. `200` with the full flow (as [`GET /api/flows/:id`](#get-apiflowsid)), `404` (`archived flow not found`), or `409` (`A flow with this id already exists.`).

### DELETE /api/archive/:id

Deletes an archived flow permanently. `204`, or `404`.

## Import and Export

### GET /api/flows/:id/export

Downloads the flow's autosaved working copy (not a snapshot; see [GET /api/snapshots/:id/export](#get-apisnapshotsidexport)) as an attachment named after the flow (`Weather-board.json`). See [Data Model: Export Format](data-model.md#export-format).

```json
{ "format": "micro-flow-editor", "version": 1, "name": "…", "description": "…", "options": { "exit_on_error": true }, "graph": { … } }
```

### POST /api/flows/import

Creates a flow from an export. Only `graph` is required, and `format` and `version` aren't checked. The name defaults to `Imported flow`, and the flow starts inactive. `201` with the full flow, or `400` (`not a micro-flow-editor export: "graph" is missing`).

## Running

### POST /api/flows/:id/run

Starts a manual run and returns at once.

```json
{ "graph": { … }, "options": { "exit_on_error": true }, "trigger_id": "t" }
```

All fields are optional. `graph` and `options` default to the flow's autosaved working copy (not its latest snapshot). The editor sends the canvas as it is. `trigger_id` picks the trigger (see [Triggers](triggers.md#choosing-the-trigger-for-a-run)).

`202` with `{ "execution_id": "…" }`. Follow the run on the [event stream](#live-event-stream), or fetch [the execution](#get-apiexecutionsid) when it has finished. `422` for a graph that won't compile (no execution is created), `429` when the server is busy.

### POST /api/flows/:id/preview

Compiles without running, for the editor's micro-flow tab.

```json
{ "graph": { … }, "trigger_id": null }
```

`200` with:

```json
{
  "tree": { "workflow": "…", "steps": [ … ] },
  "serialized": { … }
}
```

`tree` is described in [Runtime: The Tree](runtime.md#the-tree). `serialized` is the root workflow's `prepareForSerialization()` output. `422` for a graph that won't compile.

### GET /api/runs

Runs in progress on the server: `[{ "id", "flow_id", "mode" }]`.

## Executions

### GET /api/flows/:id/executions

The flow's executions, newest first, without their bulky fields:

```json
[{ "id": "…", "flow_id": "…", "mode": "webhook", "status": "success", "started_at": "…", "finished_at": "…", "error": null }]
```

`?limit=` sets how many (default 50, at most 200).

### DELETE /api/flows/:id/executions

Deletes the flow's finished executions (`success`, `error` and `stopped`). Running ones are kept. `204`.

### GET /api/executions/:id

The whole execution, including the graph that ran, `node_runs`, `log` and `outputs`. See [Data Model: Executions](data-model.md#executions). `404` if it doesn't exist.

### DELETE /api/executions/:id

Deletes one execution. `204`, even if it didn't exist.

### POST /api/executions/:id/stop

Asks a running execution to stop. `202` with `{ "stopping": true }`, or `404` if it isn't running. The run then finishes with the status `stopped`.

## Live Event Stream

### GET /api/flows/:id/stream

A [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) stream of everything that happens in the flow's runs, whether manual, webhook or scheduled. The editor uses it to animate the canvas.

```javascript
const source = new EventSource(`/api/flows/${flow_id}/stream`);
source.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log(message.type, message);
};
```

The stream sends `retry: 3000` first, then a `{ "type": "hello" }` message, then a message for each update. A `: ping` comment every 25 seconds keeps proxies from closing it. Every message except `hello` has an `execution_id`.

| `type` | Other fields | When |
|--------|--------------|------|
| `hello` | | On connect. |
| `execution_started` | `execution: { id, flow_id, mode, status: 'running', started_at }`, `trigger_id` | A run starts. |
| `node_running` | `node_id` | A node's step starts (each attempt, each pass). |
| `node_run` | `node_id`, `entry` (a [node run](data-model.md#node-runs)), `count` (the node's entries so far) | A node finished, failed, is retrying or was skipped. |
| `node_done` | `node_id` | A node's step completed or failed. |
| `output` | `card: { title, image, text, tone, at }` | An Output Card ran. |
| `log` | `entry` (a [log entry](data-model.md#log-entries)) | Something was logged. |
| `execution_finished` | `execution: { id, flow_id, mode, status, error, started_at, finished_at }` | The run ended and was saved. |

Hidden steps and fan-out branch steps send no messages.

## Webhooks

### ANY /webhook/*path

Public: no sign-in is needed, even when sign-in is on.

Runs the active flow whose Webhook Trigger matches the method and path, using the flow's latest snapshot (or its row when it has none), waits for it to finish, and replies with what a Respond to Webhook node set, or the flow's last output. JSON, URL-encoded and `text/plain` bodies up to 1 MB are parsed. See [Triggers: Webhook Trigger](triggers.md#webhook-trigger) and [Webhook Responses](triggers.md#webhook-responses).

```bash
curl -X POST http://localhost:8090/webhook/greet -H 'Content-Type: application/json' -d '{"name":"Ada"}'
# {"greeting":"Hello, Ada!"}
```

## Other Paths

| Path | Description |
|------|-------------|
| `GET /shared/*` | The node catalogue and templates (`shared/nodes.js`, `shared/templates.js`) as static files. |
| `GET /*` | The built client. Unknown paths get `index.html`, so links like `/flows/<id>` load directly. |
| `/api/*` (anything else) | `404 { "error": "not found" }` (`401` first while sign-in is on and you aren't signed in). |
