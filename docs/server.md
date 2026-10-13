# Server

The editor's server serves the Vue client, the [REST API](api.md) and `/webhook/*`, runs flows, listens on schedules and webhooks, stores flows, snapshots, archived flows and executions in a SQL database, [autosaves](#autosave) the editor's changes through a cache, and can ask for a [sign-in](#sign-in).

## Table of Contents
- [Ways to Start It](#ways-to-start-it)
- [startServer()](#startserver)
- [CLI](#cli)
- [Docker](#docker)
- [Environment Variables](#environment-variables)
- [Databases](#databases)
- [Autosave](#autosave)
- [Sign-in](#sign-in)
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

All of them listen on port 8090 by default. From a checkout, use `node bin/micro-flow-editor.js` in place of `npx`.

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
await editor.close(); // stops schedules and webhooks, writes autosaved edits, closes connections and the database
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
| `auth_enabled` | `AUTH_ENABLED` (`true` / `false` forces [sign-in](#sign-in) on or off; leave it out to use the editor's switch) |
| `admin_username` | `ADMIN_USERNAME` |
| `admin_password` | `ADMIN_PASSWORD` |
| `session_ttl_hours` | `SESSION_TTL_HOURS` |
| `trust_proxy` | `TRUST_PROXY` |
| `redis_url` | `REDIS_URL` |
| `flush_interval_ms` | `FLUSH_INTERVAL_MS` |
| `max_snapshots_per_flow` | `MAX_SNAPSHOTS_PER_FLOW` |

- `undefined` and `null` options are ignored, so `auth_enabled: undefined` leaves the variable as it is.
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
| `close()` | `Promise<void>`. Cancels schedules, drops webhooks, closes HTTP connections, writes every pending [autosave](#autosave) draft to the database, closes the cache (and the Redis connection, if any) and then the database connection. |

## CLI

```bash
micro-flow-editor [options]
micro-flow-editor [database flags] user <list|add|passwd|remove> [username]
```

| Flag | Environment variable | Description |
|------|----------------------|-------------|
| `-p`, `--port <port>` | `PORT` | Port to listen on (default 8090; `0` picks a free port). |
| `--db`, `--database-url <url>` | `DATABASE_URL` | Sequelize URL: `postgres://…`, `mysql://…`, `mariadb://…`, `mssql://…`, `sqlite:…`. |
| `--sqlite <file>` | `SQLITE_PATH` | SQLite file when no URL is given (default `data/micro-flow-editor.sqlite`). |
| `--block-private-networks[=true\|false]` | `BLOCK_PRIVATE_NETWORKS` | Turns on the [SSRF guard](#ssrf-guard). With no value it means `true`. |
| `--auth[=true\|false]` | `AUTH_ENABLED` | Forces [sign-in](#sign-in) on (no value means `true`) or off, and locks the editor's switch. Without it, sign-in is switched in the editor. |
| `-h`, `--help` | | Prints the usage. |

Flags can also be written as `--port=9000`. Only the first `=` splits the flag from its value, so URLs with `=` in them (`--db=postgres://…?sslmode=require`) work. An unknown flag prints an error and exits with code 1. Every other setting is read from the environment.

### The user Command

`micro-flow-editor user …` manages sign-in accounts from a shell and exits without starting the server. It uses the same database settings as the server, so put any `--db` / `--sqlite` flag **before** `user` (everything after `user` belongs to the subcommand).

| Command | What it does |
|---------|--------------|
| `user list` | Lists accounts and when each last signed in. |
| `user add <username>` | Creates an account. |
| `user passwd <username>` | Sets a new password and signs the user out everywhere (deletes their sessions). |
| `user remove <username>` | Deletes the account and its sessions. |
| `user`, `user --help`, `user -h` | Prints the usage. |

Passwords are never taken from the command line, where other users could see them. In a terminal you are asked twice at a hidden prompt; otherwise the first line of stdin is read:

```bash
printf 'new-password\n' | micro-flow-editor user passwd admin
```

It works whether sign-in is on or off, and doesn't need the server to be stopped. Errors (an unknown user, a taken username, a password that is too short, an unknown command) print a message and exit with code 1. See [Recovery](#recovery) for the Docker form.

## Docker

The `Dockerfile` builds the client in a first stage, then copies only what the server needs onto `node:24-trixie-slim`. That base is needed because micro-flow requires Node 24 (for a global `CustomEvent`) and the `sqlite3` 6 driver requires glibc 2.38.

| Image setting | Value |
|---------------|-------|
| Port | `8090` (`PORT=8090`) |
| SQLite file | `/app/data/micro-flow-editor.sqlite`, in the `/app/data` volume |
| User | `node` |
| Health check | `GET /api/auth/session` every 30 s (always public, so it works with sign-in on) |

`docker-compose.yml` runs the image as `micro-flow-editor`:

```bash
docker compose up -d --build                       # SQLite in the micro-flow-editor-data volume
docker compose --profile postgres up -d --build    # also starts PostgreSQL 17
docker compose --profile mysql up -d --build       # also starts MySQL 8.4
docker compose --profile redis up -d --build       # also starts Redis 7.4 (set REDIS_URL=redis://redis:6379)
```

Profiles can be combined (`--profile postgres --profile redis`). The `redis` service (`redis:7.4-alpine`) runs with `--appendonly yes` and keeps its data in the `micro-flow-editor-redis` volume, so pending edits also survive a Redis restart. Starting the profile isn't enough on its own: the editor only uses Redis when `REDIS_URL` is set.

Compose passes `DATABASE_URL`, `BLOCK_PRIVATE_NETWORKS`, `MAX_CONCURRENT_RUNS`, `MAX_LOOP_ITERATIONS`, `MAX_EXECUTIONS_PER_FLOW`, `REDIS_URL`, `FLUSH_INTERVAL_MS`, `MAX_SNAPSHOTS_PER_FLOW`, `AUTH_ENABLED`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_TTL_HOURS` and `TRUST_PROXY` through from your shell or `.env`, and maps `HOST_PORT` (default 8090) to the container's port 8090. `SQLITE_PATH` and `DB_LOGGING` are not passed through. The optional databases use the user, password and database name `flow`, and keep their data in the `micro-flow-editor-postgres` and `micro-flow-editor-mysql` volumes.

The image copies the source at build time, so rebuild (`--build`) after changing code.

> **Warning:** `docker compose down -v` deletes the named volumes, including `micro-flow-editor-data`, and with it every flow, snapshot and execution (and the PostgreSQL, MySQL or Redis data of the profiles). To rebuild and keep your data, run `docker compose up -d --build` (plain `docker compose down` keeps volumes too). Before anything that removes volumes, export your flows (**Export JSON**) or back up the volume.

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
| `REDIS_URL` | *(empty)* | Keeps the [autosave](#autosave) cache in Redis (`redis://…`) instead of in the server process. Needs the optional `redis` package. |
| `FLUSH_INTERVAL_MS` | `1000` | How often the autosave worker writes cached edits to the database. Values under `100` become `100`. |
| `MAX_SNAPSHOTS_PER_FLOW` | `100` | Snapshots kept per flow; the oldest are deleted when a new one is saved. `0` keeps them all. |
| `AUTH_ENABLED` | *(empty)* | Empty: [sign-in](#sign-in) is switched on and off in the editor (off until someone turns it on). `true` / `false`: forces it on or off and locks the editor's switch. |
| `ADMIN_USERNAME` | *(empty)* | With `ADMIN_PASSWORD`, creates this account at startup if it doesn't exist. Never changes an existing account. |
| `ADMIN_PASSWORD` | *(empty)* | Password for `ADMIN_USERNAME` (8–256 characters). |
| `SESSION_TTL_HOURS` | `168` | How long a sign-in lasts (7 days). Sessions in use are renewed. |
| `TRUST_PROXY` | *(empty)* | Behind a reverse proxy: `true`, a hop count, or addresses/subnets (Express `trust proxy`), so client IPs, HTTPS and the host come from `X-Forwarded-*`. Empty, `false`, `no`, `off` or `0` means no proxy is trusted. See [Behind a Reverse Proxy](#behind-a-reverse-proxy). |

Booleans accept `1`, `true`, `yes` or `on` (any case); any other non-empty value means `false` (so `AUTH_ENABLED=no` forces sign-in off). The limit settings (`MAX_CONCURRENT_RUNS`, `MAX_LOOP_ITERATIONS`, `MAX_EXECUTIONS_PER_FLOW`), `FLUSH_INTERVAL_MS` and `SESSION_TTL_HOURS` fall back to their default when they are empty, `0` or not a number. `MAX_SNAPSHOTS_PER_FLOW` falls back to `100` only when it is unset or empty; `0` (or anything that isn't a positive number) keeps every snapshot. `PORT` falls back to 8090 when it is empty or not a number. Copy `.env.example` to `.env` to set them. `npm start` doesn't read `.env` by itself, so export the variables or use a tool that loads it. Docker Compose reads `.env` for its variable substitution.

## Databases

Persistence goes through [Sequelize](https://sequelize.org/), so any database it supports works:

| Database | `DATABASE_URL` | Driver |
|----------|----------------|--------|
| SQLite (default) | empty, `sqlite:path/to/file.sqlite`, or `sqlite::memory:` | `sqlite3` |
| PostgreSQL | `postgres://user:pass@host:5432/db` | `pg`, `pg-hstore` |
| MySQL | `mysql://user:pass@host:3306/db` | `mysql2` |
| MariaDB | `mariadb://user:pass@host:3306/db` | `mariadb` |
| SQL Server | `mssql://user:pass@host:1433/db` | `tedious` |

`sqlite3` is a dependency. The other drivers (and `redis`, for the [autosave cache](#autosave)) are optional dependencies, so they install unless you install with `--omit=optional`.

- On startup the server retries the connection up to 30 times, 2 seconds apart, so a database container has time to start.
- Missing tables are created with `sequelize.sync()`. Existing tables are never altered or dropped, so column changes in a future version on an existing production database need a migration.
- JSON columns are stored as text (`LONGTEXT` on MySQL and MariaDB, `TEXT` elsewhere), so every database stores them the same way. They have no SQL defaults; the app fills missing values itself.

SQLite, PostgreSQL 17 and MySQL 8.4 have been tested end to end. MariaDB and SQL Server go through the same Sequelize code but haven't been run.

The tables are described in [Data Model](data-model.md). The flows page footer and `GET /api/meta` show the dialect in use.

## Autosave

The editor saves every change without a Save button (see [Using the Editor: Saving and Snapshots](editor.md#saving-and-snapshots)). The code is in `server/drafts.js`.

### The Cache and the Worker

1. About 400 ms after a change, the editor sends the whole flow (name, description, graph with viewport, options) to `PUT /api/flows/:id/draft` ([REST API: Autosave](api.md#autosave)). The server cleans it like any other graph and puts it in the **autosave cache** only, so a request never waits on the database. Each write gets a unique `version`.
2. A background worker runs every `FLUSH_INTERVAL_MS` (1000 ms by default, at least 100) and writes every flow with a pending draft to the database as an `UPDATE` of the flow's own row. It never creates rows, so the `flows` table holds one autosaved working copy per flow.
3. After writing a draft, the worker removes it from the cache **only if no newer write arrived meanwhile** (compare-and-delete on `version`). A change made during a flush stays pending for the next one, so no edit is lost.

Writes of one flow are never run twice at once: a flush that is already running is shared by every caller. A failing flow doesn't stop the others; failures are logged as `Autosave flush failed: …` and retried on the next tick. A draft for a flow that has been deleted is dropped.

**Reads flush first,** so the database stays the source of truth: every route that loads one flow (`GET /api/flows/:id`, run, export, duplicate, snapshots…) writes that flow's pending draft before reading it, and `GET /api/flows` writes every pending draft. Archiving a flow writes its pending draft first and then discards any cached one; deleting a flow, or sending a `graph` through `PUT /api/flows/:id`, discards its pending draft.

### Memory or Redis

| Cache | When | Survives | Notes |
|-------|------|----------|-------|
| **memory** (default) | `REDIS_URL` empty | A clean shutdown (everything is flushed) | A `Map` in the server process; nothing else to run. A hard crash (`SIGKILL`, out of memory, power loss) loses at most the last `FLUSH_INTERVAL_MS` of edits. Only correct with a single editor process. |
| **redis** | `REDIS_URL` set | A crash or restart of the editor; with Redis persistence, a Redis restart too | Drafts are hashes `micro-flow-editor:draft:<flow id>` with the fields `version` and `data` (the draft as JSON), plus a set `micro-flow-editor:dirty` of flow ids with pending drafts. The compare-and-delete is a Lua script, so it is atomic. Several editor instances using the same Redis and database can share the cache. |

`redis` is an optional dependency and is only imported when `REDIS_URL` is set. If it isn't installed, startup fails with `REDIS_URL is set but the "redis" package isn't installed (npm install redis).` Redis connection errors are logged as `Redis: …`. The startup log line names the cache in use: `autosave cache: memory` or `autosave cache: redis`.

A lower `FLUSH_INTERVAL_MS` shrinks what a crash of the memory cache can lose, at the price of more database writes while someone is editing. Edits only reach the cache after the editor's own 400 ms delay, and an editor tab that is closed sends its pending edits with a `keepalive` request.

### Snapshots and What Runs

The autosaved row is a working copy. **Save** in the editor (or `POST /api/flows/:id/snapshots`) flushes the flow and copies its name, description, graph and options into the `snapshots` table ([Data Model: snapshots](data-model.md#snapshots)). Up to `MAX_SNAPSHOTS_PER_FLOW` are kept per flow (100 by default; `0` keeps them all); saving a new one deletes the oldest beyond that.

**Active flows run their latest snapshot.** Webhooks and schedules are registered from the latest snapshot, and every webhook call or schedule tick reads the latest snapshot again, so half-finished edits never go live. A flow that has no snapshot (for example one created before snapshots existed) runs its row. See [Triggers: Active Flows](triggers.md#active-flows) for when triggers are re-registered. Manual runs from the editor send the canvas and don't use snapshots.

### Shutdown

`close()` (called on `SIGTERM` / `SIGINT` by `npm start`, the CLI and Docker) stops the worker and writes every pending draft **before** the database connection closes. A failure there is logged as `Autosave flush on shutdown failed: …` and shutdown carries on. `docker compose stop` sends `SIGTERM` and waits 10 seconds before killing the container, which is plenty for the flush.

## Sign-in

The editor can ask for a username and password. It is **off by default**. The code is in `server/auth.js`.

### On or Off

| `AUTH_ENABLED` | Sign-in | The editor's switch |
|----------------|---------|---------------------|
| empty or unset | Follows the switch in the editor's **Settings** dialog, stored in the `settings` table. Off until someone turns it on. | Works |
| `true` (or `--auth`, `auth_enabled: true`) | Always on | Locked |
| `false` (or `--auth=false`, `auth_enabled: false`) | Always off | Locked |

When it is on:

- every `/api` route needs a signed-in user, except `/api/auth/*`. Others answer `401 { "error": "sign in first", "auth_required": true }` (see [REST API: Sign-in](api.md#sign-in)). That includes `GET /api/meta` and the live event stream;
- **`/webhook/*` stays public**, so outside callers still reach Webhook Triggers. Schedules keep running too;
- the editor sends you to a login page (see [Using the Editor: Signing In](editor.md#signing-in)).

When it is off, nothing changes: every request goes through as before. Accounts are kept while it is off, ready for when it is turned back on.

Turning it on from the editor needs a username and password in the same step, so nobody is locked out: with no accounts yet they create the first one, otherwise they must match an existing account. The person who turns it on is signed in. Turning it off needs a signed-in user. The startup log line says `sign-in on` or `sign-in off`.

### The First Account

There are three ways to create the first account:

1. **In the editor**, when you turn sign-in on (as above).
2. **On the login page.** When sign-in is on (for example forced with `AUTH_ENABLED=true`) and there are no accounts, the login page asks for the first account instead, and the startup log says `No accounts yet: the first person to open the editor creates one.` Until then, **anyone who reaches the editor can create it**, so on a public server use option 3.
3. **`ADMIN_USERNAME` and `ADMIN_PASSWORD`.** At startup the server creates this account if no account has that name, and logs `Created the user "<name>" from ADMIN_USERNAME.` It never changes an existing account, so changing `ADMIN_PASSWORD` later does nothing; use the [user command](#the-user-command). If only one of the two is set, both are ignored with a warning. An invalid username or a password that isn't 8–256 characters logs `Could not create the account from ADMIN_USERNAME/ADMIN_PASSWORD: <reason>` and startup carries on without creating the account.

More accounts are added in the Settings dialog, with `POST /api/auth/users` or with `micro-flow-editor user add`. Every user can see, edit, run and delete every flow, and manage every other account; there are no roles. Nobody can delete their own account from the editor.

### Usernames and Passwords

- Usernames are 1–64 characters: letters, digits and `_ . @ -` (`[\w.@-]`). Surrounding spaces are trimmed and usernames are stored in lowercase, so they are case-insensitive on every database: `Ada` and `ada` are the same account when creating, signing in, turning sign-in on and in the `user` command.
- Passwords are 8–256 characters.
- Passwords are hashed with scrypt (`node:crypto`; N = 16384, r = 8, p = 1, a 16-byte random salt, a 64-byte key) and stored as `scrypt$N$r$p$salt$hash`.
- A wrong username takes as long to check as a wrong password, and both get the same `Wrong username or password.`

### Sessions and Cookies

- Signing in creates a random 32-byte token and puts it in the `mfe_session` cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` when the request came over HTTPS. The `sessions` table stores only the token's SHA-256, so a copy of the database can't be turned into working cookies.
- A session lasts `SESSION_TTL_HOURS` (default 168, 7 days). When a request arrives with less than half of that left, the session and cookie are renewed for another full period, so a session in regular use doesn't expire.
- Expired sessions are deleted at startup and every hour after.
- **Sign out** deletes the session. Changing your password signs out your **other** sessions. `user passwd` and deleting an account sign that user out everywhere.
- Sessions live in the database, so they survive restarts and are shared by every server process that uses it.

### Cross-site Requests

`SameSite=Lax` keeps the cookie off cross-site `POST`, `PUT` and `DELETE` requests. On top of that, a state-changing request (anything but `GET`, `HEAD` and `OPTIONS`) whose `Origin` header names a different host than the request's host is refused with `403 { "error": "cross-site request refused" }`. This applies to every `/api` route while sign-in is on, and to `login`, `setup`, `logout`, `enable` and the signed-in `/api/auth/*` routes always. Requests without an `Origin` header (curl, scripts) are allowed.

The request's host is Express's `req.host`: the `Host` header, or `X-Forwarded-Host` when `TRUST_PROXY` is set. So behind a reverse proxy, either pass the original `Host` header through, or set `TRUST_PROXY` and have the proxy send `X-Forwarded-Host`.

### Failed Sign-ins

After 10 failed sign-ins from one IP address within 15 minutes, `POST /api/auth/login` and `POST /api/auth/enable` answer `429` (`Too many failed sign-ins. Wait a few minutes and try again.`) until the oldest failure is 15 minutes old. Wrong credentials on either route count as failures. A successful sign-in clears the count. Counts are kept in memory, so a restart clears them. Behind a proxy, set `TRUST_PROXY` or every visitor shares the proxy's address.

### Behind a Reverse Proxy

Set `TRUST_PROXY` so Express reads the client's address, protocol and host from `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`:

| Value | Meaning |
|-------|---------|
| empty, `false`, `no`, `off`, `0` | No proxy is trusted (the default). |
| `true`, `yes`, `on` | Trust every proxy. |
| a number, e.g. `1` | Trust that many hops. |
| anything else, e.g. `loopback, 10.0.0.0/8` | Addresses or subnets of trusted proxies, passed to Express as they are. |

Without it, the rate limit counts the proxy's address for everybody, a proxy that ends HTTPS makes the server think requests are plain HTTP (so the cookie is sent without `Secure`), and the [cross-site check](#cross-site-requests) compares `Origin` with the `Host` header the proxy sends.

### Recovery

If you forget a password or lock yourself out, reset it from a shell with the [user command](#the-user-command); it works while the server runs:

```bash
micro-flow-editor user passwd admin                    # npm / npx install
node bin/micro-flow-editor.js user passwd admin        # a checkout
docker compose exec micro-flow-editor node bin/micro-flow-editor.js user passwd admin   # Docker
```

`user add <name>` creates a new account the same way. As a last resort, start the server with `AUTH_ENABLED=false` to turn sign-in off. Removing the last account while sign-in is on puts the login page back into "create the first account" mode.

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
| Snapshots kept | `MAX_SNAPSHOTS_PER_FLOW` (100) | Older snapshots of the flow are deleted when a new one is saved. `0` keeps them all. |
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
2. reads the sign-in switch from the `settings` table, and creates the `ADMIN_USERNAME` account if it is set and missing;
3. connects the [autosave](#autosave) cache (Redis when `REDIS_URL` is set) and starts the flush worker. With Redis, drafts left by a previous process are written on the first tick;
4. marks executions still `running` from a previous process as `error` ("interrupted: the server restarted during this run");
5. registers the schedules and webhooks of every active flow, from each flow's latest snapshot;
6. deletes expired sessions (and again every hour);
7. starts listening, and logs `micro-flow-editor running → http://localhost:<port> (database: <dialect>, autosave cache: memory|redis, sign-in on|off)`. With sign-in on, no `ADMIN_USERNAME` and no accounts, it also logs `No accounts yet: the first person to open the editor creates one.`

It also sets micro-flow's `log_suppress` flag, so micro-flow events aren't printed to the console.

On `SIGTERM` or `SIGINT` (`npm start`, the CLI, Docker), it cancels schedules, drops webhooks, stops the session cleanup, closes connections, writes every pending autosave draft to the database, closes the cache and the database, and exits.

## Security Notes

- **Sign-in is off by default.** Until it is turned on, anyone who can reach the editor can read, change and run every flow. Turn on [sign-in](#sign-in), or run the editor on a trusted network or behind a proxy that authenticates. With sign-in on, every account can still do everything.
- With sign-in forced on and no accounts, the first visitor creates the first account. Set `ADMIN_USERNAME` / `ADMIN_PASSWORD` on a public server.
- Serve the editor over HTTPS when others reach it, so passwords and the session cookie aren't sent in clear text. Behind a proxy, set [`TRUST_PROXY`](#behind-a-reverse-proxy).
- Turn on the [SSRF guard](#ssrf-guard) when others can reach the editor.
- Webhooks are public by design, with no authentication even when sign-in is on, and no request timeout (the caller waits for the whole flow). A flow can check a secret header with an If node (for example `headers.x-secret` `===` `…`) before it does anything.
