# MCP for AI Agents

The server has a [Model Context Protocol](https://modelcontextprotocol.io) endpoint at `/mcp`, so AI agents (Claude Code, Claude Desktop, or any MCP client) can read the node catalogue and build, check, save, switch on and run logic flows on the same server you use in the editor. The code is in `server/api/mcp.js`; it uses the official `@modelcontextprotocol/sdk`.

## Table of Contents
- [Connecting a Client](#connecting-a-client)
- [Sign-in and API Tokens](#sign-in-and-api-tokens)
- [Tools](#tools)
- [What Agents Change](#what-agents-change)
- [Transport](#transport)
- [Turning It Off](#turning-it-off)

## Connecting a Client

The endpoint is `http://<host>:<port>/mcp` (Streamable HTTP). The editor's **Settings** dialog shows the URL and a ready-made command.

**Claude Code**, with sign-in off:

```bash
claude mcp add --transport http micro-flow http://localhost:8090/mcp
```

With sign-in on, add an [API token](#sign-in-and-api-tokens):

```bash
claude mcp add --transport http micro-flow http://localhost:8090/mcp \
  --header "Authorization: Bearer mfe_…"
```

Any client that speaks Streamable HTTP works the same way: the URL, plus an `Authorization: Bearer` header when sign-in is on. For a client that only runs local (stdio) servers, put a bridge such as [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) in front of it.

Then ask the agent for what you want, for example "Make a flow that fetches a random Pokémon every morning and posts its name to a webhook", and open the flow it makes in the editor.

## Sign-in and API Tokens

`/mcp` follows the same rules as `/api` (see [Server: Sign-in](server.md#sign-in)):

- **Sign-in off** (the default): open to anyone who can reach the server, like the editor and the REST API.
- **Sign-in on:** every request needs an API token (`Authorization: Bearer mfe_…`) or a session cookie. Without one the reply is `401 { "error": "sign in first", "auth_required": true }`, and a token that is wrong or revoked gets `401 { "error": "invalid API token", "auth_required": true }`.

**API tokens** belong to a user and act as that user (snapshots an agent saves show the username, for example). Create one in **Settings → AI agents (MCP) → Create API token** while signed in, or from a shell:

```bash
micro-flow-editor user token admin "Claude Code"     # prints the token
```

The token is shown once. Only its SHA-256 is stored, along with its name, its first 10 characters (so you can tell tokens apart) and when it was last used. Tokens don't expire; revoke one with **✕** in Settings or `DELETE /api/auth/tokens/:id` (see [REST API: API Tokens](api.md#api-tokens)). Deleting a user revokes their tokens. Tokens work for every `/api` route too, but they can't create or list tokens: that needs a signed-in browser session.

Whether sign-in is on or off, a request to `/mcp` whose `Origin` header names another host is refused with `403`. This stops a web page from driving a local editor through your browser (DNS rebinding). Clients that aren't browsers send no `Origin`.

## Tools

Tool results are JSON text. Problems an agent can fix (an unknown flow, an invalid graph, a busy server) come back as tool errors with a readable message.

| Tool | What it does |
|------|--------------|
| `get_node_types` | The graph format, the expression syntax, every [node type](nodes.md) (fields, defaults, ports, the micro-flow class), the condition operators, the Transform operations and the server's limits. Agents are told to call it first. |
| `list_templates` | The [starter flows](examples/templates.md) (`include_graphs: true` adds their graphs, as worked examples). |
| `list_flows` | Every flow's summary, as in `GET /api/flows`. |
| `get_flow` | One flow with its graph, as in `GET /api/flows/:id`. |
| `check_flow` | Compiles a `graph`, a stored flow (`flow_id`) or both, without running it, from `trigger_id` (default: the Manual Trigger, else the first trigger). Returns `{ ok, triggers, warnings, compiled }`, where `compiled` is the micro-flow `Workflow` tree, or `{ ok: false, error, node_id }`. Warnings cover what doesn't stop a run but is almost always a mistake: a wire from a port the node doesn't have, a wire into a trigger, and nodes no trigger reaches. |
| `create_flow` | Creates a flow, switched off, from a `graph`, a `template` key, or neither (one Manual Trigger). Returns the flow plus a `check` of its graph. |
| `update_flow` | Changes `name`, `description`, `graph` (the whole graph) and/or `options`. Saves a snapshot labelled `Saved through MCP` (see below). Returns the flow plus a `check`. |
| `set_flow_active` | Switches a flow's Webhook and Schedule triggers on or off, as in `PUT /api/flows/:id { active }`. |
| `run_flow` | Runs a flow now, like **▶ Run**, and waits up to `wait_ms` (default 30 s, at most 5 minutes, `0` = don't wait). Optional `graph` (runs it without saving it), `trigger_id` and `input` (replaces the trigger's output: the Manual Trigger's JSON or the Webhook Trigger's test body). Returns the [execution](#execution-results), or `{ execution_id, status: 'running' }` if it is still going. |
| `get_execution` | An execution's [result](#execution-results). `all_runs_of: <node id>` adds every recorded run of that node, with inputs. |
| `list_executions` | A flow's latest runs (`limit`, default 20, at most 200). |
| `stop_execution` | Stops a running execution. |
| `archive_flow` | [Archives](editor.md#archived-flows) a flow, as in `POST /api/flows/:id/archive`. It can be unarchived in the editor. |

There is no tool that deletes a flow or a snapshot; archiving is as far as an agent goes.

### Execution Results

```json
{
  "id": "…", "flow_id": "…", "mode": "manual", "status": "success", "error": null,
  "started_at": "…", "finished_at": "…",
  "nodes": [{ "node_id": "s", "name": "Double", "runs": 1, "status": "success", "output": { "n": 2, "twice": "22" } }],
  "outputs": [{ "title": "got 22", "image": "", "text": "", "tone": "violet", "at": "…" }],
  "log": ["Run started (manual) from \"Start\"", "Start (1 ms)", "…", "Run finished"],
  "log_entries": 6
}
```

`nodes` has each node's run count and its **last** run (status, branch, error, note and output, clipped like everywhere else at 64 KB). `log` is the last 100 log lines (warnings and errors are prefixed with `[warn]` / `[error]`), and `log_entries` the full count. `run_flow` also adds `last_output` (the flow's last output) and, when a Respond node ran, `webhook_response`.

## What Agents Change

MCP goes through the same code as the REST API, so the rules for [autosave and snapshots](server.md#autosave) are the same:

- `create_flow` and `update_flow` write the flow straight to the database. A new `graph` replaces the whole graph and discards any autosaved edits the editor hasn't written yet. Every `update_flow` that changes the graph or options saves a snapshot labelled **Saved through MCP**, and an active flow's triggers switch to it at once.
- `run_flow` runs as a **manual** execution, saved in the history like a run from the editor. HTTP Request nodes really call their URLs (the [SSRF guard](server.md#ssrf-guard) applies).
- **An editor that has the flow open** hears about the change on its [live event stream](api.md#live-event-stream) (`flow_changed`). If it has no edits waiting to be sent, it reloads the flow and says so. If you are in the middle of editing, it warns you instead: your next edit then replaces the agent's version, or you can reload the page to see the agent's. The same happens for changes made through `PUT /api/flows/:id`.

## Transport

The server runs MCP's Streamable HTTP transport in **stateless** mode: each `POST /mcp` gets a fresh MCP server, nothing is kept between requests, and replies are plain JSON (no server-sent event streams, since no tool sends progress). Several editor processes behind one load balancer therefore work without sticky sessions. `GET` and `DELETE /mcp` (used by stateful servers for streams and session ends) answer `405`. Bodies up to 4 MB are accepted.

## Turning It Off

Set `MCP_ENABLED=false` (or `startServer({ mcp_enabled: false })`) and the server doesn't mount `/mcp`. The startup log ends with `MCP at /mcp` or `MCP off`, and `GET /api/meta` reports `mcp_enabled`. API tokens still work for the REST API.
