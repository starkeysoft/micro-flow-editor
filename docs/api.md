# REST API

The editor's client talks to the server only through this API, so anything the editor does can be scripted. Routes live in `server/api/flows.js`, `server/api/stream.js`, `server/api/webhooks.js` and `server/server.js`.

There is no authentication. See [Server: Security Notes](server.md#security-notes).

## Table of Contents
- [Conventions](#conventions)
- [Meta](#meta)
- [Flows](#flows)
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
| `404` | Unknown flow, execution or route. |
| `422` | The graph can't be compiled (`GraphError`): `{ error, node_id }`. |
| `429` | The server is already running `MAX_CONCURRENT_RUNS` flows. |
| `500` | Anything else. |

Graphs sent to the API are cleaned before use: unknown node types are rejected, missing config keys and settings are filled with defaults, names and ids are trimmed to length (a blank name becomes the type's title), wires to missing nodes and duplicate wires are dropped, and a wire's port defaults to `main`. See [Data Model](data-model.md#graph).

## Meta

### GET /api/meta

```json
{ "dialect": "sqlite", "block_private_networks": false, "max_loop_iterations": 1000 }
```

The Docker health check uses this route.

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

### GET /api/flows

All flows, most recently updated first, as summaries. `200`.

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

After saving, the flow's triggers are registered again (or dropped if it's inactive). If that fails, for example because of a bad cron expression or a webhook clash, the changes are **kept** but the flow is set to inactive, and the reply is `400` with an error ending in "The flow was saved but is now inactive." Otherwise `200` with the full flow.

### DELETE /api/flows/:id

Stops the flow's running executions, drops its triggers, and deletes the flow and all its executions. `204`.

### POST /api/flows/:id/duplicate

Copies the flow as `<name> (copy)`, inactive. `201` with the new full flow.

## Import and Export

### GET /api/flows/:id/export

Downloads the saved flow as an attachment named after the flow (`Weather-board.json`). See [Data Model: Export Format](data-model.md#export-format).

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

All fields are optional. `graph` and `options` default to the saved ones. The editor sends the canvas as it is, so unsaved changes run. `trigger_id` picks the trigger (see [Triggers](triggers.md#choosing-the-trigger-for-a-run)).

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

Runs the active flow whose Webhook Trigger matches the method and path, waits for it to finish, and replies with what a Respond to Webhook node set, or the flow's last output. JSON, URL-encoded and `text/plain` bodies up to 1 MB are parsed. See [Triggers: Webhook Trigger](triggers.md#webhook-trigger) and [Webhook Responses](triggers.md#webhook-responses).

```bash
curl -X POST http://localhost:8090/webhook/greet -H 'Content-Type: application/json' -d '{"name":"Ada"}'
# {"greeting":"Hello, Ada!"}
```

## Other Paths

| Path | Description |
|------|-------------|
| `GET /shared/*` | The node catalogue and templates (`shared/nodes.js`, `shared/templates.js`) as static files. |
| `GET /*` | The built client. Unknown paths get `index.html`, so links like `/flows/<id>` load directly. |
| `/api/*` (anything else) | `404 { "error": "not found" }` |
