# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-08

Initial release, built on `@ronaldroe/micro-flow` 4.0.0.

### Added

- **Visual editor** (Vue 3 + Vue Flow): drag-and-drop canvas with a node palette, an inspector
  (Parameters / Settings / Data tabs) and a drawer (Output / Log / Executions / micro-flow tabs).
  Includes undo/redo, copy/paste/duplicate, quick-add by dropping a wire on empty canvas, inserting
  a node on a wire, tidy layout, a minimap, keyboard shortcuts and a touch layout for phones (bottom
  sheets, floating + button, tap-to-connect ports).
- **19 node types** compiling to micro-flow classes: Manual, Schedule and Webhook triggers; HTTP
  Request, Edit Fields, Transform, Random Number; If (`ConditionalStep`), Switch (`SwitchStep` +
  `Case`), Filter (`FlowControlStep` break), Skip Next If (`FlowControlStep` skip); Loop Over Items,
  Repeat and Repeat While (`LoopStep` for_each / for / while); Wait (`DelayStep`); Chaos Monkey;
  Output Card, Log and Respond to Webhook.
- **Graph compiler** that turns a flow into a root `Workflow` with nested `Workflow`s for branches,
  fan-out and loop bodies, mapping node settings to `max_retries` / `max_timeout_ms` and the flow
  option to `exit_on_error`.
- **Expressions**: `{{ path }}` templates with `$item`, `$trigger`, `$node["Name"]`, `$now` and
  `$execution` roots. No code node, no `eval`.
- **Server**: runs flows, records every execution (node inputs/outputs per pass, log, output cards),
  streams live updates over Server-Sent Events, and listens on Schedule (interval or cron) and
  Webhook (`/webhook/<path>`) triggers of active flows.
- **REST API** for flows, executions, import/export, runs, previews and the live stream.
- **Databases** through Sequelize: SQLite by default; PostgreSQL, MySQL, MariaDB and SQL Server via
  `DATABASE_URL`.
- **Runtime** (`@ronaldroe/micro-flow-editor/runtime`): `compileFlow()` and `runFlow()` run exported
  flows in any Node.js app without the server or a database.
- **`startServer()`** programmatic API and the `micro-flow-editor` CLI.
- **Docker** image (`node:24-trixie-slim`) and Compose file with optional PostgreSQL and MySQL
  profiles.
- SSRF guard for HTTP Request nodes (`BLOCK_PRIVATE_NETWORKS`), and limits on concurrent runs, loop
  passes and kept executions.
- Five starter templates: Pokémon type sorter, Weather board, Dog gallery, Flaky API, Webhook echo
  API.
