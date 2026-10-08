# Compilation

How a graph on the canvas becomes a tree of micro-flow objects. The compiler is `compileGraph()` in `server/engine/compile.js`. The server and the [runtime](runtime.md) both use it, and the drawer's **micro-flow** tab shows its result for the current canvas.

## Table of Contents
- [Overview](#overview)
- [Validation](#validation)
- [Chains](#chains)
- [Fan-Out](#fan-out)
- [A Node Reached by Several Paths](#a-node-reached-by-several-paths)
- [Branches: If and Switch](#branches-if-and-switch)
- [Loops](#loops)
- [Hidden Steps](#hidden-steps)
- [Flow Control: Filter and Skip Next If](#flow-control-filter-and-skip-next-if)
- [Wait and the DelayStep Subclass](#wait-and-the-delaystep-subclass)
- [Settings: Retries and Timeouts](#settings-retries-and-timeouts)
- [Errors and exit_on_error](#errors-and-exit_on_error)
- [How Data Passes Between Steps](#how-data-passes-between-steps)
- [Sessions: One per Nested Workflow](#sessions-one-per-nested-workflow)
- [Stopping a Run](#stopping-a-run)
- [A Worked Example](#a-worked-example)

## Overview

Compilation starts at one trigger and walks the wires. The result is one **root `Workflow`**, named after the flow, whose first step is the trigger. Every branch in the graph becomes a **nested `Workflow`** used as a callable.

| Node kind | Compiles to |
|-----------|-------------|
| Trigger, action node | `Step` whose callable runs the node |
| If | `ConditionalStep`, branches as nested `Workflow`s |
| Switch | `SwitchStep` + one `Case` per case, branches as nested `Workflow`s |
| Loop Over Items / Repeat / Repeat While | a group `Step` (named after the node) whose callable is a `Workflow` holding hidden steps and a `LoopStep` (`for_each` / `for` / `while`), whose callable is a body `Workflow` |
| Filter (Stop If) / Skip Next If | `FlowControlStep` (`break` / `skip`) |
| Wait | `DelayStep` (`relative`) |
| Fan-out (several wires from one port) | one `Step` per branch, with a nested `Workflow` as its callable |

The micro-flow classes are imported from your installed `@ronaldroe/micro-flow`, so everything the library offers (events, `serialize()`, statuses, timing, `results`) works on the compiled tree.

## Validation

Before compiling, `validate()` checks the graph and picks the trigger. It throws a `GraphError` (with a `node_id` when one node is at fault) if:

- a node has an unknown type, or a wire points at a node that doesn't exist;
- the flow has no trigger, or the requested `trigger_id` isn't a trigger in the flow;
- two nodes have the same name ([expressions](expressions.md) refer to nodes by name);
- the graph has a cycle reachable from the trigger.

With no `trigger_id`, the first Manual Trigger is used, or else the first trigger. Nodes that can't be reached from that trigger are ignored.

## Chains

A node with a single successor on a port appends that successor to the **same** `Workflow`. A straight line of nodes is one `Workflow` with one step per node:

```text
Manual → HTTP Request → Edit Fields → Log

Workflow "My flow"
├── Step "Manual"
├── Step "HTTP Request"
├── Step "Edit Fields"
└── Step "Log"
```

## Fan-Out

When one output port has several wires, each branch becomes its own `Workflow`, wrapped in a `Step` named `branch → <first node>` whose callable is that `Workflow`. The branch steps are added to the current `Workflow` in the order the wires were created, so **branches run one after another, not in parallel**.

```text
Workflow "My flow"
├── Step "Manual"
├── Step "branch → Log A"     callable: Workflow "branch → Log A"
└── Step "branch → Log B"     callable: Workflow "branch → Log B"
```

Branch steps have no timeout (`max_timeout_ms: null`).

## A Node Reached by Several Paths

There is no merge. A node that several paths lead to (for example a node wired from both the `true` and the `false` port of an If, or from two fan-out branches) is compiled **once per path**, and runs once for each path that reaches it. Its Data tab then lists each run.

## Branches: If and Switch

**If** compiles to a `ConditionalStep`:

- `conditional.subject` is a function that reads **Value at path** from the node's input when micro-flow checks the condition.
- `conditional.value` is the **Compare with** value (a function when it contains `{{ }}`, see [Conditions and Operators](nodes.md#conditions-and-operators)).
- `true_callable` and `false_callable` are nested `Workflow`s named `<If name> › true` and `<If name> › false`. An unwired port gives an empty `Workflow`.

Nothing follows a `ConditionalStep` in its own `Workflow`. Everything downstream lives inside the branches.

**Switch** compiles to a `SwitchStep` whose `subject` is a function reading **Value at path** (a missing value becomes `''`, because a `Case` throws on a `null` subject). Each case becomes a `Case` with the case's operator and value and a nested `Workflow` (`<Switch name> › case-N`) as its callable. The default branch (`<Switch name> › default`) is the `default_callable`. micro-flow runs the first matching `Case`, or the default.

## Loops

Loop Over Items, Repeat and Repeat While each compile to a `LoopStep` with `max_iterations` set to the loop limit (`MAX_LOOP_ITERATIONS`, default 1000):

| Node | `loop_type` | Driven by |
|------|-------------|-----------|
| Loop Over Items | `for_each` | `iterable`: a function that reads **List at path** when the loop starts and returns at most `max_iterations` items |
| Repeat | `for` | `iterations`: **Times**, resolved by the hidden **start** step just before the loop runs (so it can be a `{{ path }}` template), capped at the loop limit |
| Repeat While | `while` | `conditional`: checked against the previous pass's output |

The `LoopStep`'s callable is a **body `Workflow`** (`<Loop name> › each`) that runs once per pass.

The `LoopStep` doesn't sit directly in the outer `Workflow`. It runs inside a **group `Step`**, named after the loop node, whose callable is a `Workflow` called `<Loop name> › loop` that holds `[· start, LoopStep, · done]`. So to the outer `Workflow` the loop node is a single step, and a [Skip Next If or Filter](#flow-control-filter-and-skip-next-if) in front of it affects the whole loop. The steps on the `done` port follow the group step in the outer `Workflow`.

The group step has no timeout and no retries. The node's Retries and Timeout settings go on the `LoopStep` itself.

## Hidden Steps

Loops need a little bookkeeping that micro-flow steps don't do on their own, so the compiler adds plain `Step`s whose names start with `·`. They have no node, are never recorded in node data, and are dimmed in the micro-flow tab.

```text
Workflow "Weather board"
├── Step "Cities"
├── Step "Each city"                         the group step for the loop node
│     callable: Workflow "Each city › loop"
│       ├── Step "· Each city start"          resets the results, remembers the outer $item
│       ├── LoopStep › for_each "Each city"
│       │     callable: Workflow "Each city › each"
│       │       ├── Step "· Each city item"     makes the item this pass's input and $item
│       │       ├── Step "Open-Meteo"
│       │       ├── Step "Shape"
│       │       ├── ConditionalStep "Warm?"  …
│       │       └── Step "· Each city collect"  adds the pass's last output to the results
│       └── Step "· Each city done"           hands the results to the done branch
├── Step "Warmest last"
└── …
```

- **start** clears the result list, remembers the enclosing loop's `$item` and captures the loop's input. For a Repeat, it also resolves **Times** against that input and sets the `LoopStep`'s `iterations`.
- **item** clears the outputs left over from the previous pass, sets `$item`, and stores the item as the input of the first node in the branch.
- **collect** adds the pass's last output to the result list, unless a node in the pass failed for good (after its last retry). A pass whose node succeeded on a retry is kept.
- **done** restores the outer `$item`, records the loop node's output (the result list, with a note like `6 passes`) and passes the list to `done`.

A [Filter](nodes.md#filter-stop-if) directly in the branch breaks the body `Workflow` before **collect** runs, which is why it drops the item.

## Flow Control: Filter and Skip Next If

Both compile to a `FlowControlStep` whose `conditional` is built the same way as an If's. When the condition is true, micro-flow sets `should_break` (Filter) or `should_skip` (Skip Next If) on the `Workflow` the step sits in:

- `break` ends that `Workflow`. In a branch, that is the rest of the branch. At the top level, it ends the run, which still counts as a success.
- `skip` skips the next step in that `Workflow`. For an action node, the skipped node's input passes on to the node after it.

Every node is a single step in its `Workflow` (a loop node through its [group step](#loops)), so a Skip Next If skips exactly one node: an action, an If or Switch with all its branches, or a whole loop. The skipped node is recorded as `skipped` (`skipped by Skip Next If`).

When the skipped node is a loop, the whole loop is skipped and its `done` branch receives the loop's own input instead of a results list, just as a skipped action node passes its input on.

## Wait and the DelayStep Subclass

Wait compiles to a `DelayStep` with `relative_delay_ms` set to the node's milliseconds (clamped to 0–24 hours). The compiler uses a small subclass of micro-flow's `DelayStep` (in `server/engine/compile.js`) for two reasons:

1. **A short delay could hang forever.** micro-flow's `DelayStep` works out when to wake up, then emits its "scheduled" event before it hands that time to node-schedule. Emitting serializes the step, and in a large tree that can take longer than a short delay. When it does, the wake-up time is already in the past, `scheduleJob()` returns `null`, and the step never finishes. The subclass finishes at once when the time has already passed, and also when `scheduleJob()` returns `null`.
2. **Stop must end a wait.** The subclass takes the run's abort signal and cancels the scheduled job when the run is stopped.

It emits the same `delay_step_relative_scheduled` and `delay_step_relative_complete` events as micro-flow's own `DelayStep`. The micro-flow tab shows it as `DelayStep`.

## Settings: Retries and Timeouts

Each node's [settings](nodes.md#settings-every-node) map onto step options:

| Setting | Step option | Notes |
|---------|-------------|-------|
| Retries | `max_retries` | Clamped to 0–10. micro-flow emits `step_retrying` before each retry, and the node's Data tab shows each attempt. |
| Timeout ms | `max_timeout_ms` | Blank or 0: `30000` for action nodes, triggers, Filter and Skip Next If; `null` (no timeout) for If, Switch and the loop nodes, whose branches may take a while. For a `LoopStep` the timeout covers the whole loop, not each pass. |

Wait ignores both. Hidden steps, loop group steps, fan-out branch steps and `Case`s have no timeout.

The HTTP Request node also aborts its `fetch` when its step's timeout passes. micro-flow stops waiting for a timed-out step, but it can't cancel the work inside it.

## Errors and exit_on_error

The flow's **Stop on first error** option becomes `exit_on_error` on **every** `Workflow` in the tree, the root and each nested one.

- **On (default).** When a step fails after its retries, its `Workflow` fails. micro-flow (3.1+) rethrows a nested `Workflow`'s failure in the step that called it, so the failure travels up through every enclosing If, Switch, loop and branch to the root. The run ends with the status `error` and the message of the first error.
- **Off.** A failing step emits `workflow_errored` and its `Workflow` carries on. The nodes after it in the same branch receive no input and are recorded as `skipped` ("no input: an earlier node failed"). In a loop, that pass is left out of the results. The run can still end with `success`.

## How Data Passes Between Steps

micro-flow steps don't pass return values to each other, so the compiled steps share a per-run **context** (`server/engine/context.js`):

- Each action step stores its node's output in the context, keyed by its step id. The next node's step reads it there.
- The step's own return value, which micro-flow puts in `results` and in event payloads, is only a small summary such as `{ node: 'Fetch', output_type: 'object' }`. Every micro-flow event payload embeds step results, so returning large outputs would make every event large.
- Control steps (If, Switch, Filter, Skip Next If, Wait) read their input lazily, so their subjects and values are evaluated when micro-flow checks them.
- Control steps run no code of the editor's, so they are recorded from micro-flow's own events by `server/engine/observe.js`: `step_complete` (with the branch taken from `conditional_true_branch_executed`, `conditional_false_branch_executed` and the `Case` that ran), `step_failed`, `step_retrying`, `workflow_step_skipped` and `workflow_break_executed`. The server and the runtime both use it.
- The context also holds `$item`, `$trigger`, `$node` outputs, the Respond node's reply and the run's stop flag.

## Sessions: One per Nested Workflow

micro-flow keeps a snapshot of every past run of a `Workflow` in its `sessions`, and every snapshot of a `Workflow` embeds all of them. A loop body `Workflow` runs once per pass, so without care each event payload would grow with every pass. The compiler patches `startNewSession()` on every `Workflow` it creates to clear `sessions` first, so each one only ever holds its current session.

## Stopping a Run

Stopping a run sets a flag on the context and aborts its `AbortController`:

- in-flight HTTP requests, Chaos Monkey delays and Wait nodes end at once;
- every action step and every loop pass checks the flag before it starts, and throws a `StopError` if it is set.

The run ends with the status `stopped` and the error `stopped by user`.

## A Worked Example

The canvas:

```text
Manual "Start" → If "Big?" (value > 10)
                   ├─ true  → Log "Say big" → Output Card "Card"
                   └─ false → Log "Say small"
```

compiles to:

```text
Workflow "Example"
├── Step "Start"
└── ConditionalStep "Big?"
      true  → Workflow "Big? › true"
                ├── Step "Say big"
                └── Step "Card"
      false → Workflow "Big? › false"
                └── Step "Say small"
```

Open the drawer's **micro-flow** tab to see this tree for any flow, or its `serialize()` output. In code, `compileFlow(flow).tree` returns the same description (see [Runtime](runtime.md#the-tree)).
