# Server

The editor's server serves the Vue client, the [REST API](api.md) and `/webhook/*`, runs flows, listens on schedules and webhooks, and stores flows and executions in a SQL database.

## Table of Contents
- [Ways to Start It](#ways-to-start-it)
- [startServer()](#startserver)
- [CLI](#cli)
- [Docker](#docker)
- [Environment Variables](#environment-variables)
- [Databases](#databases)
- [SSRF Guard](#ssrf-guard)
- [Limits](#limits)
- [Startup and Shutdown](#startup-and-shutdown)
- [Security Notes](#security-notes)

## Ways to Start It

| How | Command |
|-----|---------|
| npm | `npm run build && npm start` |
| Development | `npm run dev` (API, restarts on changes) + `npm run dev:client` (Vite on port 5173, proxies `/api` and `/webhook`) |
| CLI | `npx @ronaldroe/micro-flow-editor [options]` |
| Docker | `docker compose up -d --build` |
| In your own process | `startServer()` |

All of them listen on port 8090 by default. The package isn't published to npm yet, so from a checkout use `node bin/micro-flow-editor.js` in place of `npx`.

The client must be built (`npm run build`, into `dist/`) for the server to serve it. Without a build, `/` replies with a short note telling you to build or use the dev server. The API and webhooks work either way.

## startServer()

Starts the editor inside your own Node.js process.

```javascript
import { startServer } from '@ronaldroe/micro-flow-editor';

const editor = await startServer({
  port: 8090,
  database_url: 'postgres://flow:flow@localhost:5432/flow',
  block_private_networks: true,
});

// editor.app    - the Express app
// editor.server - the http.Server
await editor.close(); // stops schedules and webhooks, closes connections and the database
```

### Options

Every option is optional and overrides the matching environment variable (see [Environment Variables](#environment-variables)).

| Option | Environment variable |
|--------|----------------------|
| `port` | `PORT` |
| `database_url` | `DATABASE_URL` |
| `sqlite_path` | `SQLITE_PATH` |
| `db_logging` | `DB_LOGGING` |
| `block_private_networks` | `BLOCK_PRIVATE_NETWORKS` |
| `max_concurrent_runs` | `MAX_CONCURRENT_RUNS` |
| `max_loop_iterations` | `MAX_LOOP_ITERATIONS` |
| `max_executions_per_flow` | `MAX_EXECUTIONS_PER_FLOW` |

- An unknown option throws `startServer(): unknown option "<name>"`.
- Options work by setting `process.env` before the server's modules load, so they also change those variables for the rest of your process.
- There is **one editor per process**. While it is starting or running, later calls return the same promise, whatever options they pass.
- If starting fails (for example, the database can't be reached), the next call tries again.
- After `close()`, `startServer()` throws `startServer(): the editor was closed; start a new process to run it again`.
- `port: 0` picks a free port. Read it from `editor.server.address().port`.
- `close()` doesn't install signal handlers or exit the process. `npm start` and the CLI do both on `SIGTERM` / `SIGINT`.

### Returns

`Promise<{ app, server, close }>`:

| Property | Description |
|----------|-------------|
| `app` | The Express app. Its routes are already set up, including a catch-all that serves the client's `index.html`. |
| `server` | The `http.Server` that is listening. |
| `close()` | `Promise<void>`. Cancels schedules, drops webhooks, closes HTTP connections and the database connection. |

## CLI

```bash
micro-flow-editor [options]
```

| Flag | Environment variable | Description |
|------|----------------------|-------------|
| `-p`, `--port <port>` | `PORT` | Port to listen on (default 8090; `0` picks a free port). |
| `--db`, `--database-url <url>` | `DATABASE_URL` | Sequelize URL: `postgres://…`, `mysql://…`, `mariadb://…`, `mssql://…`, `sqlite:…`. |
| `--sqlite <file>` | `SQLITE_PATH` | SQLite file when no URL is given (default `data/micro-flow-editor.sqlite`). |
| `--block-private-networks[=true\|false]` | `BLOCK_PRIVATE_NETWORKS` | Turns on the [SSRF guard](#ssrf-guard). With no value it means `true`. |
| `-h`, `--help` | | Prints the usage. |

Flags can also be written as `--port=9000`. Only the first `=` splits the flag from its value, so URLs with `=` in them (`--db=postgres://…?sslmode=require`) work. An unknown flag prints an error and exits with code 1. Every other setting is read from the environment.

## Docker

The `Dockerfile` builds the client in a first stage, then copies only what the server needs onto `node:24-trixie-slim`. That base is needed because micro-flow requires Node 24 (for a global `CustomEvent`) and the `sqlite3` 6 driver requires glibc 2.38.

| Image setting | Value |
|---------------|-------|
| Port | `8090` (`PORT=8090`) |
| SQLite file | `/app/data/micro-flow-editor.sqlite`, in the `/app/data` volume |
| User | `node` |
| Health check | `GET /api/meta` every 30 s |

`docker-compose.yml` runs the image as `micro-flow-editor`:

```bash
docker compose up -d --build                       # SQLite in the micro-flow-editor-data volume
docker compose --profile postgres up -d --build    # also starts PostgreSQL 17
docker compose --profile mysql up -d --build       # also starts MySQL 8.4
```

Compose passes `DATABASE_URL`, `BLOCK_PRIVATE_NETWORKS`, `MAX_CONCURRENT_RUNS`, `MAX_LOOP_ITERATIONS` and `MAX_EXECUTIONS_PER_FLOW` through from your shell or `.env`, and maps `HOST_PORT` (default 8090) to the container's port 8090. `SQLITE_PATH` and `DB_LOGGING` are not passed through. The optional databases use the user, password and database name `flow`, and keep their data in the `micro-flow-editor-postgres` and `micro-flow-editor-mysql` volumes.

The image copies the source at build time, so rebuild (`--build`) after changing code.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8090` | Port the server listens on. `0` picks a free port. |
| `HOST_PORT` | `8090` | Docker Compose only: host port mapped to the container. |
| `DATABASE_URL` | *(empty)* | Sequelize connection URL. Empty means SQLite at `SQLITE_PATH`. |
| `SQLITE_PATH` | `data/micro-flow-editor.sqlite` | SQLite file, relative to the working directory. Its folder is created if needed. |
| `DB_LOGGING` | `false` | Logs SQL queries to the console. |
| `BLOCK_PRIVATE_NETWORKS` | `false` | Turns on the [SSRF guard](#ssrf-guard). |
| `MAX_CONCURRENT_RUNS` | `10` | Runs allowed at once, across all flows. |
| `MAX_LOOP_ITERATIONS` | `1000` | Most passes any loop node makes. |
| `MAX_EXECUTIONS_PER_FLOW` | `100` | Executions kept per flow. |

Booleans accept `1`, `true`, `yes` or `on` (any case). The limit settings (`MAX_*`) fall back to their default when they are empty, `0` or not a number. `PORT` falls back to 8090 when it is empty or not a number. Copy `.env.example` to `.env` to set them. `npm start` doesn't read `.env` by itself, so export the variables or use a tool that loads it. Docker Compose reads `.env` for its variable substitution.

## Databases

Persistence goes through [Sequelize](https://sequelize.org/), so any database it supports works:

| Database | `DATABASE_URL` | Driver |
|----------|----------------|--------|
| SQLite (default) | empty, `sqlite:path/to/file.sqlite`, or `sqlite::memory:` | `sqlite3` |
| PostgreSQL | `postgres://user:pass@host:5432/db` | `pg`, `pg-hstore` |
| MySQL | `mysql://user:pass@host:3306/db` | `mysql2` |
| MariaDB | `mariadb://user:pass@host:3306/db` | `mariadb` |
| SQL Server | `mssql://user:pass@host:1433/db` | `tedious` |

`sqlite3` is a dependency. The other drivers are optional dependencies, so they install unless you install with `--omit=optional`.

- On startup the server retries the connection up to 30 times, 2 seconds apart, so a database container has time to start.
- Missing tables are created with `sequelize.sync()`. Existing tables are never altered or dropped, so column changes in a future version on an existing production database need a migration.
- JSON columns are stored as text (`LONGTEXT` on MySQL and MariaDB, `TEXT` elsewhere), so every database stores them the same way. They have no SQL defaults; the app fills missing values itself.

SQLite, PostgreSQL 17 and MySQL 8.4 have been tested end to end. MariaDB and SQL Server go through the same Sequelize code but haven't been run.

The tables are described in [Data Model](data-model.md). The flows page footer and `GET /api/meta` show the dialect in use.

## SSRF Guard

HTTP Request nodes run **on the server**, so anyone who can edit flows can make the server call any URL, including ones on its private network. When the editor is reachable by other people, set `BLOCK_PRIVATE_NETWORKS=true` (or `--block-private-networks`). HTTP Request nodes then refuse addresses in:

- IPv4: `0.0.0.0/8`, `10.0.0.0/8`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, and `224.0.0.0` and above;
- IPv6: `::`, `::1`, `fc00::/7`, `fe80::/10`, and IPv4-mapped forms of the IPv4 ranges.

The host name is resolved first, and the request fails if **any** of its addresses is private. Redirects are followed by hand, at most 5, with every hop checked. Only `http:` and `https:` are allowed. The error reads `blocked: <host> resolves to a private address (BLOCK_PRIVATE_NETWORKS is on)`.

## Limits

| Limit | Value | What happens |
|-------|-------|--------------|
| Concurrent runs | `MAX_CONCURRENT_RUNS` (10) | Further runs are refused with HTTP 429. Scheduled runs are skipped. |
| Loop passes | `MAX_LOOP_ITERATIONS` (1000) | Loop Over Items uses the first N items. Repeat is capped at N. Repeat While stops after N passes. |
| Executions kept | `MAX_EXECUTIONS_PER_FLOW` (100) | Older executions of the flow are deleted after each run. |
| Nodes per flow | 500 | Saving or running a bigger graph fails with HTTP 400. |
| API request body | 4 MB | `/api` JSON bodies. |
| Webhook request body | 1 MB | JSON, form or text. |
| Stored value size | 64 KB | Larger node inputs and outputs are stored as `{ _truncated: true, size, preview }`, with a 2000-character preview. |
| Runs kept per node | 50 per execution | Past 50, each new entry replaces the last one. |
| Log entries | 2000 per execution | Then one "log capped" warning, and nothing more is logged. |
| Output cards | 200 per execution | Further cards are dropped. |
| HTTP response | 5 MB | Larger responses fail the HTTP Request node. |
| Retries | 0–10 per node | |
| Wait | 24 hours | |

## Startup and Shutdown

On startup the server:

1. connects to the database (with retries) and creates missing tables;
2. marks executions still `running` from a previous process as `error` ("interrupted: the server restarted during this run");
3. registers the schedules and webhooks of every active flow;
4. starts listening, and logs `micro-flow-editor running → http://localhost:<port> (database: <dialect>)`.

It also sets micro-flow's `log_suppress` flag, so micro-flow events aren't printed to the console.

On `SIGTERM` or `SIGINT` (`npm start`, the CLI, Docker), it cancels schedules, drops webhooks, closes connections and the database, and exits.

## Security Notes

- **There is no authentication.** Anyone who can reach the editor can read, change and run every flow. Run it on a trusted network or behind a proxy that authenticates.
- Turn on the [SSRF guard](#ssrf-guard) when others can reach the editor.
- Webhooks are public by design. A flow can check a secret header with an If node (for example `headers.x-secret` `===` `…`) before it does anything.
