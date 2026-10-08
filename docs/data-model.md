# Data Model

What the editor stores and the JSON formats it uses. The tables are defined in `server/db.js`.

## Table of Contents
- [Tables](#tables)
- [Flows](#flows)
- [Executions](#executions)
- [Graph](#graph)
- [Export Format](#export-format)
- [Node Runs](#node-runs)
- [Log Entries](#log-entries)
- [Output Cards](#output-cards)

## Tables

There are two tables, created by Sequelize on startup. JSON columns are stored as text (`LONGTEXT` on MySQL and MariaDB, `TEXT` elsewhere) and parsed when read. They have no SQL column default, because MySQL doesn't allow defaults on `TEXT` columns. A Sequelize `beforeValidate` hook fills in missing values instead (`{ nodes: [], edges: [] }` for graphs, `{ exit_on_error: true }` for options, `{}` for `node_runs`, `[]` for `log` and `outputs`), so rows written outside the app must supply them. Deleting a flow deletes its executions.

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
| `graph` | JSON | The graph that ran, so old executions still make sense after the flow changes. |
| `node_runs` | JSON | `{ [node_id]: [node run, …] }`. See [Node Runs](#node-runs). |
| `log` | JSON | `[log entry, …]`. See [Log Entries](#log-entries). |
| `outputs` | JSON | `[card, …]`. See [Output Cards](#output-cards). |
| `createdAt`, `updatedAt` | date | Set by Sequelize. |

The row is created as `running` when the run starts, and `status`, `error`, `finished_at`, `node_runs`, `log` and `outputs` are written when it ends. Executions still `running` when the server starts are marked `error` ("interrupted: the server restarted during this run"). Each flow keeps its newest `MAX_EXECUTIONS_PER_FLOW` executions.

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

Optional. The editor saves its pan and zoom here so a flow reopens where you left it.

## Export Format

**Export JSON** (and `GET /api/flows/:id/export`) produces:

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
