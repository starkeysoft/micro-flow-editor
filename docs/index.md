# Micro-Flow Editor Documentation

Build micro-flow logic flows on a canvas, run them on a server with manual, schedule and webhook triggers, and run exported flows inside your own app.

## Table of Contents

### Getting Started
- [Getting Started](getting-started.md) - Install, start the editor and build your first flow.
- [Using the Editor](editor.md) - The canvas, palette, inspector, drawer, runs, history and mobile layout.

### Building Flows
- [Node Reference](nodes.md) - Every node type: what it does, its fields, its ports and the micro-flow class it compiles to.
- [Expressions](expressions.md) - `{{ path }}` templates and the `$item`, `$trigger`, `$node`, `$now` and `$execution` roots.
- [Triggers](triggers.md) - Manual, Schedule and Webhook triggers, active flows and the Respond node.

### How It Works
- [Compilation](compilation.md) - How a graph becomes a tree of nested micro-flow Workflows.
- [Data Model](data-model.md) - The `flows` and `executions` tables, the graph JSON and the export format.

### Using It with micro-flow
- [Runtime](runtime.md) - `compileFlow()` and `runFlow()`: run exported flows in your own Node.js app.

### Running the Server
- [Server](server.md) - `startServer()`, the CLI, Docker, environment variables, databases and limits.
- [REST API](api.md) - Every `/api` route, the live event stream and `/webhook/*`.

### Examples
- [Bundled Templates](examples/templates.md) - The five starter flows, explained node by node.
- [Running an Exported Flow in Node.js](examples/run-exported-flow-node.md) - A script that runs a flow and listens to micro-flow events.
- [A Webhook Flow in Your Own Express App](examples/webhook-in-express.md) - Serve an editor-built flow from your own route.

## Terminology

- **Logic flow** (or just **flow**) - what you build on the canvas: nodes and the wires between them.
- **`Workflow`** - the micro-flow class. A flow compiles into a root `Workflow` with nested `Workflow`s for its branches.
- **Execution** (or **run**) - one run of a flow. The server saves each one.
- **Node** - a box on the canvas. Each node compiles to one micro-flow step in its `Workflow` (a loop node to a group step that wraps its `LoopStep` and hidden helper steps).
