# Data Model

What the editor stores and the JSON formats it uses. The tables are defined in `server/db.js`.

## Table of Contents
- [Tables](#tables)
- [Flows](#flows)
- [Snapshots](#snapshots)
- [Archived Flows](#archived-flows)
- [Executions](#executions)
- [Settings](#settings)
- [Users](#users)
- [Sessions](#sessions)
- [Graph](#graph)
- [Export Format](#export-format)
- [Node Runs](#node-runs)
- [Log Entries](#log-entries)
- [Output Cards](#output-cards)

## Tables

There are seven tables, created by Sequelize on startup: `flows`, `snapshots` and `executions` hold your logic flows, their saved versions and their runs; `archived_flows` holds archived flows; `settings`, `users` and `sessions` belong to the optional [sign-in](server.md#sign-in). JSON columns are stored as text (`LONGTEXT` on MySQL and MariaDB, `TEXT` elsewhere) and parsed when read. They have no SQL column default, because MySQL doesn't allow defaults on `TEXT` columns. A Sequelize `beforeValidate` hook fills in missing values instead (`{ nodes: [], edges: [] }` for graphs, `{ exit_on_error: true }` for options (in `flows`, `snapshots` and `archived_flows`), `{}` for `node_runs`, `[]` for `log` and `outputs`), so rows written outside the app must supply them. Deleting a flow deletes its snapshots and executions, archiving one deletes its executions and all its snapshots (after copying the latest into `archived_flows`), and deleting a user deletes their sessions.

## Flows

Table `flows`:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key. |
| `name` | string (200) | Flow name. |
| `description` | string (1000) | Optional description. |
| `graph` | JSON | The [graph](#graph). |
| `options` | JSON | `{ exit_on_error }`. Defaults to `{ "exit_on_error": true }`. |
| `active` | boolean | Whether its Schedule and Webhook triggers listen. Default `false`. |
| `createdAt`, `updatedAt` | date | Set by Sequelize. The API returns them as `created_at` / `updated_at`. |

The row is the flow's **autosaved working copy**: the editor's changes reach it through the autosave cache, as an `UPDATE` of this row every `FLUSH_INTERVAL_MS` (see [Server: Autosave](server.md#autosave)), so `updatedAt` moves while someone edits. Pending edits may sit in the cache for up to that long; the server writes them before it reads a flow and when it shuts down. Saved versions live in [`snapshots`](#snapshots).

## Snapshots

Table `snapshots`, one row per saved version of a flow. **Save** in the editor, turning a flow on with changes that aren't in a snapshot (label `Activated`), `PUT /api/flows/:id` with a `graph` or `options` (label `Saved through the API`), and archiving a flow that has no snapshot or has changes that aren't in one (label `Archived`) create one. An active flow's Schedule and Webhook triggers run its **latest** snapshot; a flow with no snapshot runs its `flows` row.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key. |
| `flow_id` | UUID | The flow. |
| `label` | string (200) | Optional label. Default `''`. |
| `name` | string (200) | The flow's name when the snapshot was taken. |
| `description` | string (1000) | The flow's description then. Default `''`. |
| `graph` | JSON | The [graph](#graph), viewport included. |
| `options` | JSON | `{ exit_on_error }`. |
| `created_by` | string (64) | Username of who saved it when sign-in is on, otherwise `null`. |
| `createdAt`, `updatedAt` | date | Set by Sequelize. "Latest" means the newest `createdAt` (ties broken by `id`). The API returns `createdAt` as `created_at`. |

Each flow keeps its newest `MAX_SNAPSHOTS_PER_FLOW` snapshots (100 by default, `0` keeps all); older ones are deleted when a new one is created. Snapshots are never changed after they are created. Unarchiving recreates the kept snapshot with its original `id`, `label`, `created_by` and `createdAt`.

## Archived Flows

Table `archived_flows`, one row per [archived](editor.md#archived-flows) flow. Archiving copies the flow's latest snapshot here (saving an `Archived` snapshot first if the flow has none or has changes that aren't in one), then deletes the flow's row, its executions and all its snapshots, in one transaction. Unarchiving recreates the flow (same `id`, inactive) and that one snapshot from this row, then deletes the row. See [REST API: Archive](api.md#archive).

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key: the flow's id. |
| `name` | string (200) | The flow's name in the kept snapshot. |
| `description` | string (1000) | Its description there. Default `''`. |
| `graph` | JSON | The kept snapshot's [graph](#graph). |
| `options` | JSON | The kept snapshot's `{ exit_on_error }`. |
| `snapshot_id` | UUID | The kept snapshot's id. |
| `snapshot_label` | string (200) | Its label. Default `''`. |
| `snapshot_created_by` | string (64) | Who saved it, or `null`. |
| `snapshot_created_at` | date | When it was saved. |
| `flow_created_at` | date | When the flow was created (nullable), restored on unarchive. |
| `archived_at` | date | When it was archived. |
| `archived_by` | string (64) | Username of who archived it when sign-in is on, otherwise `null`. |
| `createdAt`, `updatedAt` | date | Set by Sequelize. |

On MySQL dates are stored to the whole second, so restored creation times lose their milliseconds there.

## Executions

Table `executions`, one row per run:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key. |
| `flow_id` | UUID | The flow. |
| `mode` | string | `manual`, `webhook` or `schedule`. |
| `status` | string | `running`, `success`, `error` or `stopped`. |
| `started_at`, `finished_at` | date | `finished_at` is `null` while running. |
| `error` | text | The error message, or `null`. |
| `graph` | JSON | The graph that ran, so old executions still make sense after the flow changes. For webhook and schedule runs that is the latest snapshot's graph (or the flow row's, when it has no snapshot). |
| `node_runs` | JSON | `{ [node_id]: [node run, …] }`. See [Node Runs](#node-runs). |
| `log` | JSON | `[log entry, …]`. See [Log Entries](#log-entries). |
| `outputs` | JSON | `[card, …]`. See [Output Cards](#output-cards). |
| `createdAt`, `updatedAt` | date | Set by Sequelize. |

The row is created as `running` when the run starts, and `status`, `error`, `finished_at`, `node_runs`, `log` and `outputs` are written when it ends. Executions still `running` when the server starts are marked `error` ("interrupted: the server restarted during this run"). Each flow keeps its newest `MAX_EXECUTIONS_PER_FLOW` executions.

## Settings

Table `settings`, editor-wide settings changed from the UI:

| Column | Type | Description |
|--------|------|-------------|
| `key` | string (64) | Primary key. |
| `value` | string (1000) | The value as JSON. |
| `createdAt`, `updatedAt` | date | Set by Sequelize. |

The only key so far is `auth_enabled` (`true` / `false`), the editor's sign-in switch. It is read at startup and ignored while `AUTH_ENABLED` is set. With no row, sign-in is off.

## Users

Table `users`, the sign-in accounts. Every user can see and edit every flow; there are no roles.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key. |
| `username` | string (64), unique | 1–64 characters of letters, digits and `_ . @ -`, trimmed and stored in lowercase (so usernames are case-insensitive on every database). |
| `password_hash` | string (255) | `scrypt$N$r$p$salt$hash` (salt and hash in base64). |
| `last_login_at` | date | Last sign-in, or `null`. |
| `createdAt`, `updatedAt` | date | Set by Sequelize. The API returns `createdAt` as `created_at`. |

## Sessions

Table `sessions`, one row per signed-in browser:

| Column | Type | Description |
|--------|------|-------------|
| `id` | string (64) | Primary key: the hex SHA-256 of the cookie's token. The token itself is never stored. |
| `user_id` | UUID | The user. Deleting the user deletes their sessions. |
| `expires_at` | date | When it ends. Pushed forward by `SESSION_TTL_HOURS` when less than half is left. |
| `createdAt`, `updatedAt` | date | Set by Sequelize. |

Expired rows are deleted at startup and every hour.

## Graph

```json
{
  "nodes": [
    {
      "id": "n1a2b3c4d5e6",
      "type": "http",
      "name": "Fetch Pokémon",
      "x": 760,
      "y": 100,
      "config": { "method": "GET", "url": "https://pokeapi.co/api/v2/pokemon/{{id}}", "headers": "", "body": "", "response": "auto" },
      "settings": { "retries": 2, "timeout_ms": 10000, "notes": "" }
    }
  ],
  "edges": [
    { "id": "n1.main>n2", "from": "n1", "port": "main", "to": "n2" }
  ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

### Nodes

| Field | Description |
|-------|-------------|
| `id` | Unique in the graph, up to 64 characters. The editor makes ids like `n` + 12 hex digits. |
| `type` | A key of `NODE_TYPES` (see [Node Reference](nodes.md)): `manual`, `schedule`, `webhook`, `http`, `set`, `transform`, `random`, `if`, `switch`, `stop`, `skip`, `loop`, `repeat`, `while`, `wait`, `chaos`, `output`, `log`, `respond`. |
| `name` | Unique in the graph, up to 100 characters. Expressions use it (`$node["Name"]`). |
| `x`, `y` | Canvas position. |
| `config` | The node's fields. Keys are listed in the [Node Reference](nodes.md). Missing keys are filled with the type's defaults. |
| `settings` | `{ retries, timeout_ms, notes }`. Defaults `{ retries: 0, timeout_ms: '', notes: '' }`. |

Note the type names that differ from the titles: Edit Fields is `set`, Filter (Stop If) is `stop`, Loop Over Items is `loop`, Repeat While is `while`, Chaos Monkey is `chaos`, Output Card is `output`, Respond to Webhook is `respond`.

### Edges

| Field | Description |
|-------|-------------|
| `id` | The editor uses `<from>.<port>><to>`. |
| `from`, `to` | Node ids. |
| `port` | The output port on `from`: `main`, `true`/`false` (If), `case-0`, `case-1`, …/`default` (Switch), `each`/`done` (loops). |

### Viewport

Optional. The editor sends its pan and zoom here with every autosave, so a flow reopens where you left it (on a big screen; phones always fit the flow to the screen). Panning or zooming alone doesn't trigger an autosave.

## Export Format

**Export JSON** (and `GET /api/flows/:id/export`) produces the following, from the flow's autosaved working copy. Downloading a snapshot (`GET /api/snapshots/:id/export`) or an archived flow (`GET /api/archive/:id/export`) produces the same format from that snapshot or archived copy.

```json
{
  "format": "micro-flow-editor",
  "version": 1,
  "name": "Webhook echo API",
  "description": "A tiny HTTP endpoint: …",
  "options": { "exit_on_error": true },
  "graph": { "nodes": [ … ], "edges": [ … ], "viewport": { … } }
}
```

Import it on the flows page (or with `POST /api/flows/import`), or run it with the [runtime](runtime.md). Exports contain no executions and no active state.

## Node Runs

Each node has a list of entries, one per time it ran:

```json
{
  "at": "2026-10-08T09:00:01.250Z",
  "status": "success",
  "input": { "id": 25 },
  "output": { "name": "pikachu", "…": "…" },
  "ms": 182,
  "attempt": 0
}
```

| Field | Present for | Description |
|-------|-------------|-------------|
| `at` | all | When the entry was recorded. |
| `status` | all | `success`, `error`, `retrying` (failed, a retry follows) or `skipped`. |
| `input` | action nodes, control nodes, loops | The node's input. |
| `output` | successes | The node's output. Control nodes (If, Switch, Filter, Skip Next If, Wait) output their input. Loops output their list of results. |
| `error` | `error`, `retrying` | The error message. Control nodes and loops whose branch failed get `a step inside this node or its branch failed`. |
| `ms` | action nodes | Time taken. |
| `attempt` | action nodes | `0` for the first attempt, then 1, 2, … for retries. |
| `branch` | If, Switch | The branch taken: `true` or `false` for If; `case-N` for a Switch case. `default` when no case matched. Recorded per pass, so an If or Switch inside a loop shows each pass's branch. |
| `note` | skipped nodes, loops | Why it was skipped (`no input: an earlier node failed`, `skipped by Skip Next If`), or `N passes`. |

On the server, an `input` or `output` larger than 64 KB is stored as `{ "_truncated": true, "size": 123456, "preview": "…" }` (the first 2000 characters), a value JSON can't encode as `{ "_unserializable": "…" }`, and each node keeps at most 50 entries per execution.

## Log Entries

```json
{ "at": "2026-10-08T09:00:01.432Z", "level": "info", "event": "step_complete", "node_id": "h", "text": "Fetch Pokémon (182 ms)" }
```

| Field | Description |
|-------|-------------|
| `at` | Time. |
| `level` | `info`, `warn` or `error`. |
| `event` | `workflow_running`, `step_complete`, `step_failed`, `step_retrying`, `workflow_step_skipped`, `workflow_break_executed`, `log` (a Log node), `workflow_complete`, `workflow_failed` or `workflow_cancelled` (stop requested). |
| `node_id` | The node, when there is one. |
| `text` | The message. |

## Output Cards

```json
{ "title": "pikachu", "image": "https://…/25.png", "text": "electric · HP 35", "tone": "violet", "at": "2026-10-08T09:00:01.500Z" }
```

`tone` is one of `violet`, `red`, `blue`, `green`, `amber`, `slate`. The runtime's cards have no `at`.
