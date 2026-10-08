# Runtime

Run logic flows built in the editor inside your own Node.js app, with no editor server and no database. The runtime compiles an exported flow into a real micro-flow `Workflow` tree (see [Compilation](compilation.md)) and executes it.

```javascript
import { runFlow, compileFlow } from '@ronaldroe/micro-flow-editor/runtime';
```

The same exports are also available from the package root (`@ronaldroe/micro-flow-editor`), next to [`startServer()`](server.md#startserver). Importing `/runtime` doesn't load the server, Express or Sequelize.

## Table of Contents
- [Quick Start](#quick-start)
- [Getting a Flow](#getting-a-flow)
- [compileFlow(flow, options)](#compileflowflow-options)
- [runFlow(flow, options)](#runflowflow-options)
- [Options](#options)
- [The Result](#the-result)
- [The Tree](#the-tree)
- [Listening to micro-flow Events](#listening-to-micro-flow-events)
- [Running a Webhook Flow in Your Own Route](#running-a-webhook-flow-in-your-own-route)
- [Stopping a Run](#stopping-a-run)
- [Console Logging](#console-logging)
- [One Copy of micro-flow](#one-copy-of-micro-flow)
- [Other Exports](#other-exports)
- [Differences from the Server](#differences-from-the-server)

## Quick Start

```javascript
import fs from 'node:fs';
import { runFlow } from '@ronaldroe/micro-flow-editor/runtime';

const flow = JSON.parse(fs.readFileSync('./flows/weather-board.json', 'utf8'));
const result = await runFlow(flow, {
  onOutput: (card) => console.log(`${card.title}: ${card.text}`),
});

console.log(result.status); // 'success'
console.log(result.output); // the last node's output
```

## Getting a Flow

Build the flow in the editor and choose **⋯ → Export JSON** (or the ⇩ button on the flows page). Export downloads the **saved** flow. The runtime accepts any of:

| Shape | Example |
|-------|---------|
| An export file | `{ format: 'micro-flow-editor', version: 1, name, description, options, graph }` |
| A flow | `{ name, graph, options }` (e.g. a row from the [REST API](api.md#get-apiflowsid)) |
| A bare graph | `{ nodes, edges }` (named `flow`, default options) |

Anything else throws a `TypeError`. See [Data Model](data-model.md) for the formats.

## compileFlow(flow, options)

Compiles a flow without running it.

```javascript
import { compileFlow } from '@ronaldroe/micro-flow-editor/runtime';

const compiled = compileFlow(flow, { trigger_payload: { body: { name: 'Ada' } } });
compiled.workflow;  // the root micro-flow Workflow
compiled.trigger;   // the trigger node the run starts from
compiled.tree;      // a plain description of the Workflow tree
await compiled.run();
```

Throws a [`GraphError`](#other-exports) (with `.node_id` when one node is at fault) if the graph is invalid: no trigger, a cycle, duplicate node names, an unknown node type. See [Compilation: Validation](compilation.md#validation).

### Returns

| Property | Type | Description |
|----------|------|-------------|
| `workflow` | `Workflow` | The root micro-flow `Workflow`, built from your installed `@ronaldroe/micro-flow`. |
| `trigger` | `object` | The trigger node (`{ id, type, name, config, … }`) the run starts from. |
| `tree` | `object` | A plain description of the compiled tree. See [The Tree](#the-tree). |
| `run()` | `() => Promise<object>` | Executes the flow once and resolves with [the result](#the-result). Calling it a second time throws. Call `compileFlow()` again for another run. |
| `stop()` | `() => void` | Stops a run in progress. See [Stopping a Run](#stopping-a-run). |

`run()` resolves for a failing flow too. It doesn't reject. Check `status`.

## runFlow(flow, options)

Compiles and runs in one call: `runFlow(flow, options)` is `compileFlow(flow, options).run()`. It takes the same options and resolves with the same result. It throws (rejects) only for an invalid flow.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `trigger_id` | `string` | first Manual Trigger, else first trigger | Id of the trigger node to start from. |
| `trigger_payload` | `any` | `null` | What a **Manual** or **Webhook** trigger outputs instead of its own settings. Without it, a Manual Trigger outputs its Output JSON and a Webhook Trigger its test body. For a webhook, pass `{ method, path, query, headers, body }`. A **Schedule** trigger ignores it and outputs `{ timestamp }`. |
| `exit_on_error` | `boolean` | the flow's own setting (`true` if unset) | Sets `exit_on_error` on every `Workflow` in the tree. See [Compilation: Errors](compilation.md#errors-and-exit_on_error). |
| `max_loop_iterations` | `number` | `1000` | Most passes any loop node makes. |
| `block_private_networks` | `boolean` | `false` | The [SSRF guard](server.md#ssrf-guard) for HTTP Request nodes. |
| `onNodeRun` | `(node, entry) => void` | none | Called each time a node finishes, fails, retries or is skipped. `node` is the graph node and `entry` is a [node run](#node_runs). |
| `onOutput` | `(card) => void` | none | Called for each Output Card: `{ title, image, text, tone }`. |
| `onLog` | `(text, level) => void` | none | Called for each Log node message, each retry (`<name>: retry N of M`, level `warn`) and each Filter break (`Filter stopped the branch "…"`). `level` is `info`, `warn` or `error`. |

## The Result

```javascript
{
  status: 'success',      // 'success' | 'error' | 'stopped'
  error: null,            // the error message when status isn't 'success'
  output: { ... },        // the output of the last action node that ran, or null
  response: null,         // what a Respond to Webhook node set: { status, content_type, body }
  outputs: [ ... ],       // Output Card cards, in order
  logs: [ ... ],          // Log node messages, retries and Filter breaks
  node_runs: { ... },     // what each node did, by node id
}
```

| Field | Description |
|-------|-------------|
| `status` | `success` when the root `Workflow` completed, `error` when it failed, `stopped` after `stop()`. With `exit_on_error: false`, a run with failed nodes can still be `success`. |
| `error` | The first error's message, `stopped by user`, or `null`. |
| `output` | The latest output of any action node, trigger or loop node (a loop's output is its list of results). `null` if none ran. |
| `response` | `{ status, content_type, body }` from the first Respond to Webhook node that ran, else `null`. |
| `outputs` | `[{ title, image, text, tone }]`. |
| `logs` | `[{ at, level, text }]`: Log node messages, retries and Filter breaks (the same messages `onLog` receives). |
| `node_runs` | `{ [node_id]: [entry, …] }`. See below. |

### node_runs

One entry per time a node ran (several in loops, and one per retry):

| Field | Description |
|-------|-------------|
| `at` | ISO time the entry was recorded. |
| `status` | `success`, `error`, `retrying` (failed, will retry) or `skipped`. |
| `input` | The node's input. |
| `output` | The node's output (on success). |
| `error` | The error message (on `error` / `retrying`). |
| `ms` | How long the node took. |
| `attempt` | `0` for the first attempt, then `1`, `2`, … for retries. |
| `branch` | For If and Switch: the branch taken (`true`, `false`, `case-N`, `default`). |
| `note` | For skipped nodes, why. For loop nodes, how many passes ran (`3 passes`). |

`node_runs` covers every node that ran. Triggers and action nodes record themselves. Control nodes (If, Switch, Filter, Skip Next If, Wait) and loop failures are recorded from micro-flow's events, by the same code the server uses (`server/engine/observe.js`). A control node's output is its input. Values are not trimmed in size, as they are on the server.

## The Tree

`compiled.tree` describes the compiled micro-flow objects. The editor's **micro-flow** tab shows the same thing.

```javascript
{
  workflow: 'Webhook echo API',
  steps: [
    { name: 'Incoming', class: 'Step', node_id: 't', children: [] },
    {
      name: 'Has a name?', class: 'ConditionalStep', node_id: 'i',
      children: [
        { label: 'true', workflow: 'Has a name? › true', steps: [ /* … */ ] },
        { label: 'false', workflow: 'Has a name? › false', steps: [ /* … */ ] },
      ],
    },
  ],
}
```

Each step has `name`, `class` (the micro-flow class name), `node_id` (`null` for [hidden steps](compilation.md#hidden-steps) and fan-out branch steps; a loop node's id appears on both its group `Step` and its `LoopStep`), `detail` (the `loop_type`, `flow_control_type` or delay, when there is one) and `children` (the nested `Workflow`s, each with a `label`).

To get micro-flow's own serialized form, call it on the workflow: `compiled.workflow.serialize()` or `compiled.workflow.prepareForSerialization()`. The node callables are closures over the run, so a serialized flow can be inspected but not hydrated and run again. Keep the export JSON and call `compileFlow()` instead.

## Listening to micro-flow Events

`compiled.workflow` is an ordinary micro-flow `Workflow`, so its steps emit the usual lifecycle events through `Workflow.events`:

```javascript
import { Workflow, workflow_event_names, step_event_names } from '@ronaldroe/micro-flow';
import { compileFlow } from '@ronaldroe/micro-flow-editor/runtime';

const compiled = compileFlow(flow);
const root_id = compiled.workflow.id;

const onComplete = (wf) => {
  if (wf.id === root_id) console.log(`done in ${wf.timing.execution_time_ms} ms`);
};
const onRetry = (step) => console.log(`retrying ${step.name} (${step.retry_count}/${step.max_retries})`);

Workflow.events.workflow.on(workflow_event_names.WORKFLOW_COMPLETE, onComplete);
Workflow.events.step.on(step_event_names.STEP_RETRYING, onRetry);

await compiled.run();

Workflow.events.workflow.off(workflow_event_names.WORKFLOW_COMPLETE, onComplete);
Workflow.events.step.off(step_event_names.STEP_RETRYING, onRetry);
```

Things to know:

- **Events are process-wide.** Every `Workflow` in the process emits on the same `Workflow.events`, nested ones included. Filter by id: the root workflow's `id` for workflow events, or the step `name`. Steps for nodes are named after their node, and node names are unique within a flow. A loop node has two steps with its name: the group `Step` and the `LoopStep` inside it.
- **Payloads are JSON copies**, not the live instances. micro-flow clones the payload when it emits.
- Every nested `Workflow` (a branch, a loop body) emits its own `workflow_running` / `workflow_complete`. Hidden steps (names starting with `·`) and fan-out branch steps (`branch → …`) emit step events too.
- For per-node information, `onNodeRun` is usually simpler. It hands you the graph node with its input and output, control nodes included.

See micro-flow's [event documentation](https://www.npmjs.com/package/@ronaldroe/micro-flow) for every event name.

## Running a Webhook Flow in Your Own Route

A flow built around a Webhook Trigger and Respond to Webhook nodes can serve a route in your own Express app. Pass the request as `trigger_payload`, then reply the way the editor's server does:

```javascript
import express from 'express';
import fs from 'node:fs';
import { runFlow } from '@ronaldroe/micro-flow-editor/runtime';

const greet = JSON.parse(fs.readFileSync('./flows/webhook-echo-api.json', 'utf8'));
const app = express();

app.post('/greet', express.json(), async (req, res) => {
  const result = await runFlow(greet, {
    trigger_payload: {
      method: req.method,
      path: 'greet',
      query: req.query,
      headers: req.headers,
      body: req.body ?? null,
    },
    block_private_networks: true,
  });

  if (result.response) {
    const { status, content_type, body } = result.response;
    res.status(status).type(content_type);
    return content_type === 'application/json' ? res.json(body) : res.send(String(body ?? ''));
  }
  if (result.status !== 'success') return res.status(500).json({ error: result.error });
  return res.json(result.output);
});

app.listen(3000);
```

The flow doesn't need to be active, and the Webhook Trigger's path and method are not used: your route decides. See [the full example](examples/webhook-in-express.md).

## Stopping a Run

```javascript
const compiled = compileFlow(flow);
const pending = compiled.run();
setTimeout(() => compiled.stop(), 5000);
const result = await pending; // status: 'stopped' if it was still running
```

`stop()` aborts in-flight HTTP requests, Chaos Monkey delays and Wait nodes, and stops before the next node or loop pass. See [Compilation: Stopping a Run](compilation.md#stopping-a-run).

## Console Logging

micro-flow itself `console.log`s every workflow and step event in your process. The only switch is the flag on micro-flow's deprecated `State` singleton:

```javascript
import { State } from '@ronaldroe/micro-flow';
State.set('log_suppress', true); // events still fire, they just aren't printed
```

The editor's server sets this flag itself. The runtime doesn't, because the flag is process-wide and would silence micro-flow for the rest of your app too. Set it yourself if you want quiet runs.

## One Copy of micro-flow

The runtime imports `Workflow`, `Step` and the other classes from `@ronaldroe/micro-flow`. If your app also imports micro-flow (for `Workflow.events`, `State`, or `instanceof Workflow`), both must resolve to **the same installed copy**, or you'll be listening on a different `Workflow.events` from the one the flow emits on. Check with:

```bash
npm ls @ronaldroe/micro-flow
```

It should show a single version, deduplicated. `@ronaldroe/micro-flow` (`^4.0.0`) is a regular dependency of the editor:

- If your app doesn't install micro-flow itself, npm installs it as the editor's dependency, and `import ... from '@ronaldroe/micro-flow'` in your app resolves to that same copy.
- If your app does install it, use a compatible version (4.0.0 or a later 4.x). npm then keeps one shared copy.
- An incompatible version gives you two copies, and listeners on your `Workflow.events` won't see the flow's events.

## Other Exports

| Export | Description |
|--------|-------------|
| `compileFlow`, `runFlow` | See above. |
| `validate(graph, trigger_id?)` | Checks a graph and returns `{ trigger, reachable }`, or throws `GraphError`. |
| `GraphError` | Thrown for invalid graphs. Has `node_id`. |
| `StopError` | Thrown inside a run when it is stopped. |
| `NODE_TYPES`, `GROUPS`, `OPERATORS` | The node catalogue, palette groups and condition operators (also at `@ronaldroe/micro-flow-editor/nodes`). |
| `getPath(input, path, ctx?)` | Reads a [path](expressions.md#paths). |
| `resolve(template, input, ctx?)` | Resolves a [template](expressions.md#templates). |
| `isTrigger(type)`, `outputsOf(node)` | Whether a node type is a trigger, and a node's output port names. |
| `TEMPLATES` | The [bundled template flows](examples/templates.md). Each one can be passed straight to `runFlow()`. |

## Differences from the Server

| | Server | Runtime |
|-|--------|---------|
| Triggers | Manual, schedule and webhook, while active | Whatever you call it from |
| Saved executions | Yes, in the database | No. You get the result object |
| Node data size | Values over 64 KB are trimmed; 50 entries per node | Not trimmed |
| `$execution` | `{ id, mode }` of the saved execution | `{ id: null, mode: 'runtime' }` |
| Concurrent runs | Limited by `MAX_CONCURRENT_RUNS` | Not limited |
| micro-flow console logging | Off | On unless you suppress it |
