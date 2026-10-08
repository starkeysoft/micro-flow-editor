# Running an Exported Flow in Node.js

A script that runs a logic flow built in the editor, with no editor server and no database. It shows the runtime's callbacks, micro-flow's own events on the compiled `Workflow`, and stopping a run.

## Overview

You will learn:
- Exporting a flow from the editor
- Running it with `runFlow()` and reading the result
- Using `onNodeRun`, `onOutput` and `onLog`
- Listening to `Workflow.events` on the compiled `Workflow`
- Passing a trigger payload, and stopping a run

## Setup

```bash
npm install @ronaldroe/micro-flow-editor
```

(The package isn't published to npm yet. Until it is, install from a local checkout, e.g. `npm install ../micro-flow-editor`.)

In the editor, create a flow from the **Weather board** template, save it, and choose **⋯ → Export JSON**. Save the file as `weather-board.json` next to your script.

## Complete Example

```javascript
import fs from 'node:fs';
import {
  Workflow,
  State,
  workflow_event_names,
  step_event_names,
} from '@ronaldroe/micro-flow';
import { compileFlow, GraphError } from '@ronaldroe/micro-flow-editor/runtime';

// micro-flow prints every event unless this is set. Events still fire.
State.set('log_suppress', true);

const flow = JSON.parse(fs.readFileSync(new URL('./weather-board.json', import.meta.url), 'utf8'));

// ─── Compile ──────────────────────────────────────────────────────────────────

let compiled;
try {
  compiled = compileFlow(flow, {
    exit_on_error: true,
    max_loop_iterations: 50,
    block_private_networks: true,

    // Every time a node finishes, retries, fails or is skipped.
    onNodeRun: (node, entry) => {
      const time = entry.ms != null ? ` ${entry.ms} ms` : '';
      console.log(`  ${entry.status.padEnd(8)} ${node.name}${time}${entry.error ? ` - ${entry.error}` : ''}`);
    },
    onOutput: (card) => console.log(`  ▣ ${card.title}: ${card.text}`),
    onLog: (text, level) => console.log(`  [${level}] ${text}`),
  });
} catch (error) {
  if (error instanceof GraphError) {
    console.error(`The flow is invalid: ${error.message} (node ${error.node_id})`);
    process.exit(1);
  }
  throw error;
}

console.log(`Compiled "${compiled.workflow.name}", starting at "${compiled.trigger.name}"`);

// ─── micro-flow events ────────────────────────────────────────────────────────
// Workflow.events is process-wide: nested Workflows (branches, loop bodies)
// emit too, so compare ids to find the root.

const root_id = compiled.workflow.id;

const onRunning = (wf) => {
  if (wf.id === root_id) console.log(`▶ ${wf.name}`);
};
const onComplete = (wf) => {
  if (wf.id === root_id) console.log(`✓ ${wf.name} (${wf.timing.execution_time_ms} ms)`);
};
const onRetrying = (step) => {
  console.warn(`  ↺ ${step.name} retry ${step.retry_count}/${step.max_retries}`);
};

Workflow.events.workflow.on(workflow_event_names.WORKFLOW_RUNNING, onRunning);
Workflow.events.workflow.on(workflow_event_names.WORKFLOW_COMPLETE, onComplete);
Workflow.events.step.on(step_event_names.STEP_RETRYING, onRetrying);

// ─── Run, with a safety stop ──────────────────────────────────────────────────

const timer = setTimeout(() => compiled.stop(), 60_000);
const result = await compiled.run();
clearTimeout(timer);

Workflow.events.workflow.off(workflow_event_names.WORKFLOW_RUNNING, onRunning);
Workflow.events.workflow.off(workflow_event_names.WORKFLOW_COMPLETE, onComplete);
Workflow.events.step.off(step_event_names.STEP_RETRYING, onRetrying);

// ─── Result ───────────────────────────────────────────────────────────────────

console.log('\nStatus:', result.status);
if (result.error) console.log('Error:', result.error);
console.log('Last output:', result.output);
console.log('Cards:', result.outputs.length);
console.log('Nodes that ran:', Object.keys(result.node_runs).length);
```

## Expected Output

```text
Compiled "Weather board", starting at "Cities"
▶ Weather board
  success  Cities 0 ms
  success  Open-Meteo 212 ms
  success  Shape 0 ms
  ▣ London: 14.2 °C · wind 11.3 km/h
  success  Cool card 0 ms
  success  Warm?
  …
  success  Each city
  success  Warmest last 0 ms
  success  Pick last 0 ms
  ▣ Warmest: Singapore: 29.8 °C
  success  Winner 0 ms
✓ Weather board (1460 ms)

Status: success
Last output: [ { city: 'Singapore', temp: 29.8, wind: 7.6 } ]
Cards: 6
Nodes that ran: 10
```

Temperatures will differ. Control nodes such as **Warm?** are recorded when their step completes, after the branch they ran, and their entry has a `branch` (`true` / `false`). Retries also reach `onLog` as `<name>: retry N of M` (see [Runtime: node_runs](../runtime.md#node_runs)).

## Variations

### Run from a different trigger

```javascript
const result = await runFlow(flow, { trigger_id: 'manual-test' });
```

### Feed a webhook flow

```javascript
const result = await runFlow(flow, {
  trigger_payload: { method: 'POST', path: 'greet', query: {}, headers: {}, body: { name: 'Ada' } },
});
console.log(result.response); // { status: 200, content_type: 'application/json', body: { greeting: 'Hello, Ada!' } }
```

### Run on a timer of your own

A Schedule Trigger only fires inside the editor's server. In your app, call `runFlow()` from your own scheduler. The Schedule Trigger outputs `{ timestamp }` and ignores `trigger_payload`:

```javascript
setInterval(() => runFlow(flow), 5 * 60_000);
```

### Start a manual flow with your own data

A Manual Trigger outputs `trigger_payload` when you pass one, instead of its Output JSON:

```javascript
const result = await runFlow(flow, { trigger_payload: { cities: [{ name: 'Oslo', lat: 59.91, lon: 10.75 }] } });
```

## Related

- [Runtime](../runtime.md)
- [Compilation](../compilation.md)
- [A Webhook Flow in Your Own Express App](webhook-in-express.md)
