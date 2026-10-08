# Micro-Flow Editor

A visual, drag-and-drop builder for [`@ronaldroe/micro-flow`](https://www.npmjs.com/package/@ronaldroe/micro-flow) logic flows, in the style of n8n. You draw a logic flow on a canvas, and the editor compiles the graph into real micro-flow objects: a root `Workflow`, `Step`s, `ConditionalStep`, `SwitchStep` and `Case`, `LoopStep`, `DelayStep` and `FlowControlStep`, with a nested `Workflow` for every branch. A bundled server runs flows when you press Run, on a schedule or when a webhook is called, and stores every execution in a SQL database. A small runtime runs exported flows inside your own app, with no server or database.

> The package is called `@ronaldroe/micro-flow-editor`. It is **not published to npm yet**, so the `npx` and `npm install` commands below will work once it is. Until then, run it from a checkout.

## Features

- **Canvas editor** - Drag nodes in from a palette, wire outputs to inputs, and edit each node in an inspector. Includes undo/redo, copy/paste, quick-add (drop a wire on empty canvas), insert-on-wire, tidy layout and a minimap.
- **Compiles to micro-flow** - Every node maps to a micro-flow class. The drawer's **micro-flow** tab shows the compiled `Workflow` tree and its `serialize()` output.
- **Live runs** - Nodes light up as they run. Wires show the path the run took. Every node keeps its input and output for each pass, and the drawer shows output cards and an event log.
- **Triggers** - Manual, Schedule (every N minutes or cron) and Webhook (`/webhook/<path>`, with a Respond node to shape the reply).
- **Execution history** - Every manual, webhook and scheduled run is saved. Open an old run and its data shows on the canvas again.
- **Any SQL database** - SQLite by default. PostgreSQL, MySQL, MariaDB and SQL Server are supported through Sequelize with `DATABASE_URL`.
- **Expressions** - `{{ path }}`, `$item`, `$trigger`, `$node["Name"]`, `$now` and `$execution` in node fields. There is no code node and no `eval`.
- **Runtime for your app** - `compileFlow()` / `runFlow()` run an exported flow in any Node.js app. `compileFlow(...).workflow` is a real micro-flow `Workflow`.
- **Works on phones** - Bottom-sheet palette and inspector, a floating + button, tap-to-connect ports and pinch zoom.
- **Docker-ready** - One `docker compose up`, with optional PostgreSQL or MySQL profiles.

## Requirements

**Node.js 24 or newer**, the same as `@ronaldroe/micro-flow` 4.x, which the editor is built on. (micro-flow's events need a global `CustomEvent`, which Node 18 lacks.) The `sqlite3` 6 driver needs Node 20+ and glibc 2.38, which is why the Docker image is based on `node:24-trixie-slim`.

## Quick Start (Docker)

```bash
docker compose up -d --build
```

Open http://localhost:8090. Flows and executions are stored in SQLite in the `micro-flow-editor-data` volume. To change the host port, set `HOST_PORT` in a `.env` file (copy `.env.example`).

## Running with npm

```bash
npm install
npm run build   # builds the Vue client into dist/
npm start       # http://localhost:8090
```

For development, run the API with auto-restart and the Vite dev server side by side:

```bash
npm run dev          # API server on PORT (8090), restarts on server/ and shared/ changes
npm run dev:client   # Vite on http://localhost:5173, proxies /api and /webhook to the API
```

## CLI

```bash
npx @ronaldroe/micro-flow-editor --port 8090 --db postgres://user:pass@localhost:5432/flows
```

| Flag | Environment variable | Description |
|------|----------------------|-------------|
| `-p`, `--port <port>` | `PORT` | Port to listen on (default `8090`; `0` picks a free port). |
| `--db`, `--database-url <url>` | `DATABASE_URL` | Sequelize connection URL. |
| `--sqlite <file>` | `SQLITE_PATH` | SQLite file to use when no URL is given. |
| `--block-private-networks[=true\|false]` | `BLOCK_PRIVATE_NETWORKS` | Turns on the SSRF guard for HTTP Request nodes (no value means `true`). |
| `-h`, `--help` | | Prints the usage. |

Flags override the environment. From a checkout, run `node bin/micro-flow-editor.js` after `npm run build`. See [Server](docs/server.md) for the programmatic `startServer()` API.

## Configuration

Every setting is optional. Copy `.env.example` to `.env` to set them.

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST_PORT` | `8090` | Host port that `docker compose` maps to the container. |
| `PORT` | `8090` | Port the server listens on (`npm start`, the CLI). `0` picks a free port. The Docker image always listens on 8090. |
| `DATABASE_URL` | *(empty)* | Any Sequelize URL: `postgres://`, `mysql://`, `mariadb://`, `mssql://` or `sqlite:`. Empty means SQLite at `SQLITE_PATH`. |
| `SQLITE_PATH` | `data/micro-flow-editor.sqlite` | SQLite file, relative to the working directory. The image uses `/app/data/micro-flow-editor.sqlite`. |
| `DB_LOGGING` | `false` | Logs every SQL query to the console. |
| `BLOCK_PRIVATE_NETWORKS` | `false` | Stops HTTP Request nodes from reaching private, loopback and link-local addresses. Turn it on if other people can reach the editor. |
| `MAX_CONCURRENT_RUNS` | `10` | Runs allowed at once. Further runs are refused with HTTP 429. |
| `MAX_LOOP_ITERATIONS` | `1000` | Most passes any Loop, Repeat or Repeat While node makes. |
| `MAX_EXECUTIONS_PER_FLOW` | `100` | Executions kept per flow. Older ones are deleted after each run. |

Boolean variables accept `1`, `true`, `yes` or `on`.

## Choosing a Database

SQLite is the default and needs no setup. For anything else, set `DATABASE_URL`:

```bash
DATABASE_URL=postgres://user:pass@host:5432/db
DATABASE_URL=mysql://user:pass@host:3306/db
DATABASE_URL=mariadb://user:pass@host:3306/db
DATABASE_URL=mssql://user:pass@host:1433/db
```

The drivers (`pg`, `mysql2`, `mariadb`, `tedious`) are optional dependencies and install with the app. Tables are created on startup if they are missing.

`docker-compose.yml` includes optional PostgreSQL and MySQL services behind profiles:

```bash
# PostgreSQL
echo 'DATABASE_URL=postgres://flow:flow@postgres:5432/flow' >> .env
docker compose --profile postgres up -d --build

# MySQL
echo 'DATABASE_URL=mysql://flow:flow@mysql:3306/flow' >> .env
docker compose --profile mysql up -d --build
```

The editor retries the connection for about a minute while the database container starts.

## Using It with micro-flow

Build a flow in the editor, choose **⋯ → Export JSON**, and run the file in your own app with the runtime:

```javascript
import fs from 'node:fs';
import { runFlow, compileFlow } from '@ronaldroe/micro-flow-editor/runtime';

const flow = JSON.parse(fs.readFileSync('my-flow.json', 'utf8'));

// One call: compile and run.
const result = await runFlow(flow);
console.log(result.status, result.output);

// Or compile first, to work with the micro-flow Workflow it builds.
const compiled = compileFlow(flow);
console.log(compiled.workflow.name);   // a real @ronaldroe/micro-flow Workflow
const again = await compiled.run();
```

`compileFlow(...).workflow` is a real micro-flow `Workflow`, so `Workflow.events`, `serialize()` and the rest of micro-flow work on it as usual. Keep a single copy of `@ronaldroe/micro-flow` installed (`npm ls @ronaldroe/micro-flow`) so `Workflow.events` is the same instance in your code and in the runtime. See [Runtime](docs/runtime.md) for every option and the result shape.

## How the Canvas Maps to micro-flow

| Node | micro-flow class |
|------|------------------|
| The whole flow | a root `Workflow` |
| Manual, Schedule and Webhook Trigger | `Step` (the first step of the root `Workflow`) |
| HTTP Request, Edit Fields, Transform, Random Number, Chaos Monkey, Output Card, Log, Respond to Webhook | `Step` |
| If | `ConditionalStep` (each branch is a nested `Workflow`) |
| Switch | `SwitchStep` with one `Case` per case (each branch is a nested `Workflow`) |
| Filter (Stop If) | `FlowControlStep` (`break`) |
| Skip Next If | `FlowControlStep` (`skip`) |
| Loop Over Items | `LoopStep` (`for_each`) |
| Repeat | `LoopStep` (`for`) |
| Repeat While | `LoopStep` (`while`) |
| Wait | `DelayStep` (`relative`) |
| Several wires from one output (fan-out) | one `Step` per branch, each with a nested `Workflow` as its callable |

A node's **Retries** and **Timeout** settings become `max_retries` and `max_timeout_ms`. **Stop on first error** becomes `exit_on_error` on every `Workflow`. See [Compilation](docs/compilation.md) for the details.

## Keyboard Shortcuts

| Keys | Action |
|------|--------|
| Ctrl/⌘ + S | Save |
| Ctrl/⌘ + Enter | Run the flow |
| Ctrl/⌘ + Z | Undo |
| Ctrl/⌘ + Shift + Z, Ctrl + Y | Redo |
| Ctrl/⌘ + C / V | Copy / paste selected nodes |
| Ctrl/⌘ + D | Duplicate selected nodes |
| Ctrl/⌘ + A | Select all nodes |
| Delete, Backspace | Delete the selection |
| Shift + drag | Box-select nodes |
| 1 | Fit the flow in view |
| N | Focus node search |
| Esc | Close panels / deselect |

## On a Phone

On screens 760px wide or less, the editor switches to a touch layout:

- Tap the floating **+** button to open the node palette as a bottom sheet. Tapping a node opens its inspector as a bottom sheet too.
- To connect two nodes, tap an output port, then tap an input port.
- Pinch to zoom and drag to pan.
- Select a wire to show its **+** (insert a node) and **✕** (delete) buttons.
- Save, Undo, Redo and the Active switch move into the **⋯** menu.

## Testing

```bash
npm test
```

Runs `test/*.test.js` with Node's built-in test runner. The engine tests use an in-memory SQLite database, and the runtime tests need no database.

## Documentation

- [Documentation index](docs/index.md)
- [Getting Started](docs/getting-started.md)
- [Using the Editor](docs/editor.md)
- [Node Reference](docs/nodes.md)
- [Expressions](docs/expressions.md)
- [Triggers](docs/triggers.md)
- [Compilation](docs/compilation.md)
- [Runtime](docs/runtime.md)
- [Server](docs/server.md)
- [REST API](docs/api.md)
- [Data Model](docs/data-model.md)
- [Examples](docs/examples/)

## License

MIT. See [LICENSE](LICENSE).
