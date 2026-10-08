# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Micro-Flow Editor (`@ronaldroe/micro-flow-editor` on npm) is a visual, n8n-style drag-and-drop builder for [`@ronaldroe/micro-flow`](https://www.npmjs.com/package/@ronaldroe/micro-flow) logic flows. A Vue 3 + Vue Flow SPA edits graphs. An Express 5 server compiles graphs into real micro-flow `Workflow` trees, runs them (manual, schedule and webhook triggers), streams progress over SSE and stores flows and executions through Sequelize. A standalone runtime runs exported flows in other apps. The library itself lives in `/mnt/storage1/projects/micro-flow`; read its `CLAUDE.md` when behaviour depends on micro-flow internals.

> **Terminology:** say "logic flow" (or "flow") for what users build. Reserve "workflow" / `Workflow` for the micro-flow class.

Built on `@ronaldroe/micro-flow` **4.x**. Requires **Node.js 24+** (micro-flow 4 requires it too): micro-flow's events need a global `CustomEvent`, and `sqlite3` 6 needs Node 20+ and glibc 2.38 (hence the `node:24-trixie-slim` image).

## Commands

```bash
npm install
npm run build        # vite build: client/ -> dist/
npm start            # node server/index.js on PORT (default 8090)
npm run dev          # nodemon: API server, restarts on server/ and shared/ changes
npm run dev:client   # Vite dev server on :5173, proxies /api and /webhook to :PORT
npm test             # node --test test/*.test.js
docker compose up -d --build                     # SQLite in a volume, http://localhost:8090
docker compose --profile postgres up -d --build  # + PostgreSQL (set DATABASE_URL)
docker compose --profile mysql up -d --build     # + MySQL (set DATABASE_URL)
```

Run one test file: `node --test test/engine.test.js`. Settings come from the environment (see `.env.example` and `server/config.js`). `npm start` doesn't load `.env` by itself.

## Architecture

```
shared/        no-import ESM used by BOTH client and server
  nodes.js     NODE_TYPES catalogue (fields, ports, defaults, kind, micro class), getPath/resolve
               (expressions), OPERATORS, withDefaults()
  templates.js starter flows
server/
  config.js    env -> config (read once at import time)
  db.js        Sequelize models Flow + Execution (JSON stored as TEXT/LONGTEXT), initDatabase()
  server.js    start(): DB, markInterrupted(), registerAll(), Express app, static dist/
  index.js     entry for npm start / CLI / Docker (signal handling)
  api/         flows.js (REST + cleanGraph), stream.js (SSE), webhooks.js (/webhook/*)
  engine/
    compile.js   validate() + compileGraph(): graph -> nested micro-flow Workflows; DelayStep subclass
    actions.js   ACTIONS[type](input, config, ctx, step): what trigger/action nodes do; SSRF guard
    context.js   per-run ctx shared by actions and compiled steps; executeRoot(), stopContext()
    observe.js   micro-flow events -> per-node records (control nodes, loop failures, retries, skips,
                 breaks); used by runner.js AND runtime/index.js
    runner.js    server runs: Execution rows, bus -> SSE, concurrency slots, pruning
    triggers.js  schedules (setInterval / node-schedule cron) and the webhook registry
runtime/index.js  compileFlow()/runFlow() for other apps (no server, no DB)
lib/index.js      package root: startServer() + runtime re-exports
bin/              CLI (flags -> env vars, then imports server/index.js)
client/src/       Vue 3 SPA (vue-router: / FlowsView, /flows/:id EditorView)
  components/     FlowNode, FlowEdge, NodePalette, NodeInspector, ExecutionDrawer, StatusPanel, …
  lib/            api.js (REST wrappers), graph.js (graph <-> Vue Flow), history.js (undo), format.js
```

Key ideas:

- **Graph format:** `{ nodes: [{ id, type, name, x, y, config, settings }], edges: [{ id, from, port, to }], viewport? }`. Node names are unique (expressions use `$node["Name"]`). `cleanGraph()` in `server/api/flows.js` sanitises every graph that comes in.
- **Compilation** (`docs/compilation.md`): each node becomes one step. A single successor is appended to the same `Workflow`; fan-out wraps each branch in a `Step` whose callable is a nested `Workflow`. If/Switch/loops get nested branch `Workflow`s. A loop node is one group `Step` (kind `group`) whose callable is `<name> › loop` = `[· start, LoopStep, · done]`, so Skip Next If / Filter treat it as one node; the body `Workflow` has hidden `· item` / `· collect` steps. A node reachable by several paths compiles once per path. Every compiled `Workflow` gets `keepOneSession()` so event payloads don't grow per pass.
- **Data flow:** action steps keep their node's output in `ctx.out` keyed by step id and return only a tiny summary, because every micro-flow event payload embeds step results. Never return large data from a step callable.
- **Events:** micro-flow's `Workflow.events` are process-wide. `observe.js` installs one set of listeners and routes events to runs through `watched` (step id -> observation). Control nodes (If/Switch/Filter/Skip/Wait, its `CONTROL` set) and loop failures are recorded from those events; action nodes record themselves via `ctx.record`. Both the server and the runtime call `observe()`, so their `node_runs` match. `ctx.iteration_failed` is set only on a final failure (no retries left).
- **Shared catalogue:** the client imports `shared/` through the Vite alias `@shared`; the server imports it relatively. Keep `shared/` free of imports and Node/browser-only APIs.
- The server sets micro-flow's `State.set('log_suppress', true)`; the runtime deliberately doesn't (process-wide flag).

## Conventions

- Strict ES Modules (`"type": "module"`), no CommonJS. Express 5.
- **snake_case** for server-side data and properties, as in micro-flow (`node_runs`, `exit_on_error`, `max_loop_iterations`, option names of `startServer()` / `compileFlow()`). camelCase for function names.
- Client: Vue 3 SFCs with `<script setup>`; shared styles in `client/src/styles/base.css`. Keep the phone layout working (≤760px: bottom sheets, FAB, `.wide-only` hidden).
- Use micro-flow's own classes and options rather than re-implementing behaviour in the compiler. Comment any workaround (like the `DelayStep` subclass) with why it exists.
- No code nodes and no `eval`: expressions are paths only.
- Keep `.env.example`, `server/config.js`, `lib/index.js` (`ENV` map), `bin/micro-flow-editor.js` and `docker-compose.yml` in step when adding a setting.

## Adding a Node Type

1. Add an entry to `NODE_TYPES` in `shared/nodes.js`: `title`, `group` (one of `GROUPS`), `icon`, `color`, `kind`, `micro` (class shown in the UI), `outputs` (array or function of config), optional `inputs: false`, `blurb`, `defaults`, `fields` (`text | textarea | json | number | select | operator | cases | checkbox`, optional `show(config)`), `summary(config)`, optional `portLabel`.
2. Behaviour:
   - `kind: 'action'` (or `'trigger'`): add `ACTIONS[type](input, config, ctx, step)` in `server/engine/actions.js`. It returns the node's output; throw to fail. Use `resolve`/`resolveText` for templated fields and `ctx.sleep`/`ctx.abort.signal` for anything slow, so Stop works.
   - A new `kind`: add a `case` in `chain()` in `server/engine/compile.js`, `track()` its step with `{ node_id, kind, inputFn }`, add it to `describeTree()` if needed, and, if it should be recorded from events, to the `CONTROL` set in `server/engine/observe.js`.
3. Add a test in `test/` (engine and/or runtime).
4. Document it in `docs/nodes.md` (and the README's node → class table, `docs/compilation.md` for a new kind, `docs/data-model.md` type list).

## Testing

`node:test` + `node:assert/strict`, flat `test/*.test.js`. `test/engine.test.js` runs graphs through the real compiler and runner against in-memory SQLite (`DATABASE_URL=sqlite::memory:` set before importing server modules). `test/runtime.test.js` covers the standalone runtime and checks that every template compiles. Tests that call external APIs are not allowed; use `manual`, `set`, `transform`, `chaos` (with `fail_pct` 0 or 100) etc.

## Documentation

Every change must update the docs that describe it: `README.md`, the relevant pages in `docs/` (index, editor, nodes, expressions, triggers, compilation, runtime, server, api, data-model, examples), `CHANGELOG.md`, and this file when architecture or commands change. Docs must match the code exactly; if code and docs disagree, fix whichever is wrong in the same change.

## Commits

Commit messages must not mention Claude, AI or any assistant. No Co-Authored-By trailer, no 'Generated with' line.

The git remote is https://github.com/starkeysoft/micro-flow-editor (branch `main`). The package is published to npm as `@ronaldroe/micro-flow-editor`; `prepublishOnly` builds the client and runs the tests.
