# Micro-Flow Editor

A visual, drag-and-drop builder for [`@ronaldroe/micro-flow`](https://www.npmjs.com/package/@ronaldroe/micro-flow) logic flows, in the style of n8n. You draw a logic flow on a canvas, and the editor compiles the graph into real micro-flow objects: a root `Workflow`, `Step`s, `ConditionalStep`, `SwitchStep` and `Case`, `LoopStep`, `DelayStep` and `FlowControlStep`, with a nested `Workflow` for every branch. A bundled server runs flows when you press Run, on a schedule or when a webhook is called, and stores every execution in a SQL database. A small runtime runs exported flows inside your own app, with no server or database.

> Published on npm as [`@ronaldroe/micro-flow-editor`](https://www.npmjs.com/package/@ronaldroe/micro-flow-editor). Source: [github.com/starkeysoft/micro-flow-editor](https://github.com/starkeysoft/micro-flow-editor).

## Features

- **Canvas editor** - Drag nodes in from a palette, wire outputs to inputs, and edit each node in an inspector. Includes undo/redo, copy/paste, quick-add (drop a wire on empty canvas), insert-on-wire, tidy layout and a minimap.
- **Compiles to micro-flow** - Every node maps to a micro-flow class. The drawer's **micro-flow** tab shows the compiled `Workflow` tree and its `serialize()` output.
- **Live runs** - Nodes light up as they run. Wires show the path the run took. Every node keeps its input and output for each pass, and the drawer shows output cards and an event log.
- **Triggers** - Manual, Schedule (every N minutes or cron) and Webhook (`/webhook/<path>`, with a Respond node to shape the reply).
- **Autosave and snapshots** - Every change is saved as you make it. **Save** keeps a snapshot you can restore, download or delete, and an active flow's webhooks and schedules run the latest snapshot, so half-finished edits never go live.
- **Archiving** - Archive a flow you no longer need: it leaves the flow list and its triggers stop, but its latest snapshot is kept, so you can unarchive it (same id, switched off), download it or delete it for good.
- **Execution history** - Every manual, webhook and scheduled run is saved. Open an old run and its data shows on the canvas again.
- **Any SQL database** - SQLite by default. PostgreSQL, MySQL, MariaDB and SQL Server are supported through Sequelize with `DATABASE_URL`.
- **Expressions** - `{{ path }}`, `$item`, `$trigger`, `$node["Name"]`, `$now` and `$execution` in node fields. There is no code node and no `eval`.
- **Runtime for your app** - `compileFlow()` / `runFlow()` run an exported flow in any Node.js app. `compileFlow(...).workflow` is a real micro-flow `Workflow`.
- **Optional sign-in** - Off by default. Turn it on in the editor's Settings (or force it with `AUTH_ENABLED`) to require a username and password for the editor and its API. Webhooks stay public.
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
| `--auth[=true\|false]` | `AUTH_ENABLED` | Forces sign-in on (no value means `true`) or off and locks the editor's switch. |
| `-h`, `--help` | | Prints the usage. |

Flags override the environment. From a checkout, run `node bin/micro-flow-editor.js` after `npm run build`. See [Server](docs/server.md) for the programmatic `startServer()` API.

`micro-flow-editor user <list|add|passwd|remove> [username]` manages sign-in accounts against the same database (put `--db` / `--sqlite` before `user`). Passwords are read from a hidden prompt, or from stdin when piped, never from the command line. See [Server: The user Command](docs/server.md#the-user-command).

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
| `REDIS_URL` | *(empty)* | Keeps the autosave cache in Redis (e.g. `redis://redis:6379`) instead of in the server process. Needs the optional `redis` package. |
| `FLUSH_INTERVAL_MS` | `1000` | How often the background worker writes autosaved edits to the database (at least `100`). |
| `MAX_SNAPSHOTS_PER_FLOW` | `100` | Snapshots kept per flow. Older ones are deleted when a new one is saved. `0` keeps them all. |
| `AUTH_ENABLED` | *(empty)* | Empty: sign-in is switched in the editor's Settings (off until turned on). `true` / `false`: forces it on or off and locks that switch. |
| `ADMIN_USERNAME` | *(empty)* | With `ADMIN_PASSWORD`, creates this account at startup if it doesn't exist. Never changes an existing one. |
| `ADMIN_PASSWORD` | *(empty)* | Password for `ADMIN_USERNAME` (8–256 characters). |
| `SESSION_TTL_HOURS` | `168` | How long a sign-in lasts. Sessions in use are renewed. |
| `TRUST_PROXY` | *(empty)* | Behind a reverse proxy: `true`, a hop count, or addresses (Express `trust proxy`), so client IPs, HTTPS (for `Secure` cookies) and the host come from `X-Forwarded-*`. Empty, `false`, `no`, `off` or `0` trusts no proxy. |

Boolean variables accept `1`, `true`, `yes` or `on`.

## Autosave and Snapshots

The editor saves every change on its own, about 400 ms after you make it. The top bar shows **Saved**, **Saving…** or **Offline – retrying**; there is no "unsaved changes" prompt any more. On the server, edits go into a cache first and a background worker writes them to the flow's row every `FLUSH_INTERVAL_MS` (1 s by default). The cache lives in the server process unless `REDIS_URL` is set. Anything that reads a flow writes its pending edits first, and stopping the server writes them all.

**Save** (Ctrl/⌘ + S) creates a **snapshot**: a named version of the flow. The **Snapshots** tab in the drawer lists them, and each one can be restored onto the canvas, downloaded as an importable JSON file or deleted. Up to `MAX_SNAPSHOTS_PER_FLOW` are kept per flow.

**Save is what goes live.** An active flow's webhooks and schedules run its latest snapshot, not the autosaved canvas, so you can edit a live flow without the half-finished version answering requests. Press Save when the changes are ready. Turning a flow on saves an "Activated" snapshot if it has changes that aren't in one. **▶ Run** in the editor still runs the canvas as it is. See [Using the Editor: Saving](docs/editor.md#saving-and-snapshots) and [Server: Autosave](docs/server.md#autosave).

### Archiving

**Archive** (the box icon on a flow card, or **⋯ → Archive flow…** in the editor) takes a flow out of the flow list and stops its triggers and running executions. Only its most recent snapshot is kept (edits that aren't in a snapshot are saved as an "Archived" snapshot first); its other snapshots and its execution history are deleted. The collapsed **Archived** section at the bottom of the flows page lists archived flows, with **Unarchive** (brings the flow back with the same id, switched off, with that snapshot as its only one), **Download** and **Delete permanently**. See [Using the Editor: Archived flows](docs/editor.md#archived-flows) and [REST API: Archive](docs/api.md#archive).

## Sign-in (optional)

Sign-in is **off by default**: anyone who can reach the editor can use it. To require an account:

- **In the editor:** open **Settings** (flows page header, or **⋯ → Settings…** on the canvas) and turn **Sign-in** on. It asks for an account in the same step: you create the first one if there are none, otherwise you sign in with an existing one. Add more users in the same dialog.
- **From the environment:** set `AUTH_ENABLED=true` (or `--auth`). The editor's switch is then locked. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` to create the first account at startup; without them, the first person to open the editor creates it.

While it is on, the editor and every `/api` route need a session (an `HttpOnly` cookie); `/webhook/*` stays public so outside callers still work. Every user can see and edit every flow; there are no roles. Forgot a password? Reset it on the server:

```bash
micro-flow-editor user passwd admin
docker compose exec micro-flow-editor node bin/micro-flow-editor.js user passwd admin
```

See [Server: Sign-in](docs/server.md#sign-in) for sessions, proxies, rate limiting and recovery.

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

To keep the autosave cache in Redis (it then survives a restart of the editor, and several editor instances can share it), start the `redis` profile:

```bash
echo 'REDIS_URL=redis://redis:6379' >> .env
docker compose --profile redis up -d --build
```

The `redis` service uses `redis:7.4-alpine` with append-only persistence in the `micro-flow-editor-redis` volume. Profiles combine: `--profile postgres --profile redis`.

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
| Ctrl/⌘ + S | Save a snapshot |
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
- Save snapshot, Undo, Redo and the Active switch move into the **⋯** menu. The save indicator only shows when the editor is offline.

## Testing

```bash
npm test
```

Runs `test/*.test.js` with Node's built-in test runner. The engine, server, autosave, archive and sign-in tests use an in-memory SQLite database (the `user` CLI tests in `test/auth-cli.test.js` use a temporary SQLite file), and the runtime tests need no database. The Redis autosave test (`test/drafts-redis.test.js`) is skipped unless `TEST_REDIS_URL` points at a Redis server:

```bash
TEST_REDIS_URL=redis://localhost:6379 npm test
```

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
