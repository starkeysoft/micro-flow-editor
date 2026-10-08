# Using the Editor

The editor has two pages: the **flows page** (`/`) lists your flows, and the **canvas** (`/flows/<id>`) edits one flow.

## Table of Contents
- [The Flows Page](#the-flows-page)
- [The Canvas](#the-canvas)
- [Adding Nodes](#adding-nodes)
- [Connecting Nodes](#connecting-nodes)
- [The Inspector](#the-inspector)
- [Running a Flow](#running-a-flow)
- [The Drawer](#the-drawer)
- [Viewing Past Executions](#viewing-past-executions)
- [Saving, Undo and Redo](#saving-undo-and-redo)
- [Copy, Paste and Duplicate](#copy-paste-and-duplicate)
- [Layout Tools](#layout-tools)
- [The ⋯ Menu](#the--menu)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [On a Phone](#on-a-phone)

## The Flows Page

- **New flow** creates a flow with a single Manual Trigger called **Start**.
- **Import** loads a JSON file made by **Export JSON** (see [Data Model: Export Format](data-model.md#export-format)). Imported flows start inactive.
- **Start from a template** creates a flow from one of the [bundled templates](examples/templates.md).
- Each flow card shows its triggers, node count and last execution. Its footer has the **Active** switch (see [Triggers](triggers.md#active-flows)), **Duplicate**, **Export JSON** and **Delete**. The switch is disabled until the flow has a Schedule or Webhook trigger.
- A search box appears once there are more than four flows.
- The footer shows which database the server uses.

## The Canvas

The canvas is built on [Vue Flow](https://vueflow.dev/). Nodes snap to a 20px grid. Zoom ranges from 0.2× to 2×. A minimap appears in the bottom-right corner once a flow has more than six nodes, and zoom controls sit in the bottom-left corner.

Each node shows its icon, name, type and a one-line summary of its settings. Badges show its retries (`↻2`) and timeout (`⏲10000ms`) when they are set. Trigger nodes have a **▶** button that runs the flow from that trigger.

The **Workflow Status** panel in the top-right corner shows the micro-flow class of the step that is running, its node name and status, and counters for runs and steps run.

## Adding Nodes

- **Drag** a node from the palette on the left onto the canvas.
- **Click** a node in the palette. If a node is selected, the new node goes to its right and is wired from the selected node's first output. Otherwise it goes in the middle of the view. Triggers are never wired this way.
- **Drop a wire on empty canvas.** Drag from an output port and let go over empty space: a node picker opens, and the node you pick is placed there and connected. Triggers are hidden in this picker, because they have no input.
- **Insert on a wire.** Select a wire and click its **+** button. The new node goes between the two nodes: the old wire is replaced by one into the new node and one from its first output to the old target.
- Search the palette with the box at the top (press **N** to focus it). **Enter** adds the first match.

New nodes get the type's title as their name, with a number added if that name is taken (`HTTP Request 2`). Node names must be unique in a flow, because [expressions](expressions.md) refer to nodes by name.

## Connecting Nodes

Wires always go from an output port (right side) to the input port (left side). Triggers have no input. Some nodes have several outputs:

| Node | Output ports |
|------|--------------|
| If | `true`, `false` |
| Switch | one per case (`case-0`, `case-1`, …), then `default` |
| Loop Over Items, Repeat, Repeat While | `each`, `done` |
| Everything else | one unnamed output (`main`) |

The editor refuses a wire that would connect a node to itself or create a cycle. Use a Loop, Repeat or Repeat While node to run things more than once.

One output can feed several nodes. Those branches run one after another (see [Compilation: Fan-Out](compilation.md#fan-out)).

To delete a wire, select it and click **✕**, or press Delete. Removing a Switch case also removes the wires from its port.

## The Inspector

Click a node to open the inspector on the right. You can rename the node in its header, which also shows the micro-flow class the node compiles to. The inspector has three tabs.

### Parameters

The node's own fields, with a short description at the top. Fields that hold JSON are checked as you type. A Webhook Trigger shows its full URL here. The **Expressions** box lists the expression roots you can use. See [Node Reference](nodes.md) for every field.

### Settings

- **Retries (max_retries)** - 0 to 10. micro-flow runs the step again this many times if it fails.
- **Timeout ms (max_timeout_ms)** - applies to each attempt. Blank means 30000 ms (micro-flow's default) for ordinary nodes, and no timeout for nodes that contain branches (If, Switch, Loop Over Items, Repeat, Repeat While).
- **Notes** - free text for yourself.
- **Duplicate** and **Delete node** buttons.

The Wait node has no retries or timeout settings, only notes.

### Data

After a run, the Data tab shows what the node did on each pass: **Run N of M** with arrows to step through passes, the status (`success`, `error`, `retrying`, `skipped`), the time it took, the attempt number, the branch taken (for If and Switch), any error, and the node's **Input** and **Output** as JSON. Clicking a node that has run data opens this tab directly.

## Running a Flow

Press **▶ Run** in the top bar (or Ctrl/⌘ + Enter). Run sends the canvas as it is now, saved or not.

When a flow has several triggers, Run starts from the selected trigger if one is selected. Otherwise it starts from the first Manual Trigger, or else the first trigger. The **▶** button on a trigger node runs from that trigger. Running a Webhook Trigger by hand uses its **Test body**. Running a Schedule Trigger by hand outputs `{ timestamp }`.

While a run is in progress:

- the running node pulses, and finished nodes show `✓`, `✕`, `↻` (retrying) or `–` (skipped);
- a `×N` badge shows how many times a node ran (in loops, for example);
- wires the run went along are highlighted, and so is the output port of the branch an If or Switch took;
- **■ Stop** replaces Run. Stop aborts in-flight HTTP requests and waits, and the run ends with the status `stopped`.

If the graph can't be compiled (no trigger, a cycle, two nodes with the same name), the run doesn't start. The error appears as a message, and the node at fault is selected.

The canvas follows every new run of the flow, including webhook and scheduled runs started by someone else, unless you are viewing a past execution.

## The Drawer

The drawer at the bottom has four tabs. Click a tab to open it, and click ▾ / ▴ to collapse or expand it.

- **Output** - cards from [Output Card](nodes.md#output-card) nodes.
- **Log** - the execution log: every node that finishes, retries, is skipped or fails, plus Log node messages and run start/end. Click an entry to select its node.
- **Executions** - every saved run of this flow (manual, webhook and schedule), newest first, with status, mode, start time, duration and error. **Clear finished** deletes every finished execution.
- **micro-flow** - what the canvas compiles to. **Tree** shows the root `Workflow`, its steps with their micro-flow classes, and nested `Workflow`s for every branch. Helper steps the compiler adds are dimmed (see [Compilation](compilation.md#hidden-steps)). Click a step to select its node. **serialize()** shows the root workflow's `prepareForSerialization()` output. The tab refreshes as you edit while it is open.

## Viewing Past Executions

Click an execution in the **Executions** tab. Its node data, log and output cards load onto the canvas, and a **viewing … run** badge appears in the drawer bar. New runs don't replace what you are viewing. Click **✕** on the badge to go back to the live view.

Execution data is shown on the canvas as it is now. If nodes have been removed since that run, a message says how many are missing.

## Saving, Undo and Redo

- **Save** (Ctrl/⌘ + S) stores the graph, the name, the description, **Stop on first error** and the current viewport. The top bar shows **Saved** or **Unsaved**. Leaving the page with unsaved changes asks first.
- Saving also re-registers the flow's triggers. If an active flow's triggers are invalid (a bad cron expression, a webhook path another flow already uses), the save goes through but the flow is switched to inactive, and a message explains why.
- **Undo** (Ctrl/⌘ + Z) and **Redo** (Ctrl/⌘ + Shift + Z or Ctrl + Y) cover the graph: nodes, wires, positions and node settings. History keeps the last 100 states. The flow name, description and Stop on first error are not part of undo history.

## Copy, Paste and Duplicate

- **Ctrl/⌘ + C** copies the selected nodes and the wires between them, to the editor and to the system clipboard.
- **Ctrl/⌘ + V** pastes them 40px down and to the right, with new ids. Names get a number if they are taken.
- Pasting from the system clipboard also works with nodes copied in another browser tab (`{ "nodes": [...], "edges": [...] }`) and with the contents of an exported flow file (`{ "graph": { "nodes": [...], "edges": [...] } }`). The nodes are added to the current flow.
- **Ctrl/⌘ + D** duplicates the selection. The inspector's **Duplicate** button duplicates one node.
- **Shift + drag** draws a selection box. **Ctrl/⌘ + A** selects every node.

## Layout Tools

- **Fit view** (key **1**) zooms to show the whole flow.
- **Tidy layout** (in the ⋯ menu) arranges nodes in columns from left to right by their distance from the triggers.

## The ⋯ Menu

- **Stop on first error (exit_on_error)** - on (the default), the first node that fails after its retries ends the run with an error. Off, the run carries on: the nodes after the failed one in that branch are marked skipped, and the run can still finish with `success`. See [Compilation: Errors](compilation.md#errors-and-exit_on_error).
- **Fit view**, **Tidy layout**
- **Export JSON** - downloads the saved flow (not unsaved changes). See [Data Model: Export Format](data-model.md#export-format).
- **Duplicate flow** - saves first if needed, then opens the copy. Copies start inactive.
- **Description…** - edit the flow's description.
- **Keyboard shortcuts**
- **Delete flow** - deletes the flow and all of its executions.

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

Save, Run and Esc work everywhere. The other shortcuts are ignored while you type in a field.

## On a Phone

On screens 760px wide or less:

- The palette and the inspector open as **bottom sheets**. Tap the floating **+** button to add a node, and tap a node to edit it.
- To connect nodes, **tap an output port, then tap an input port**. Dropping a wire on empty canvas opens the palette sheet.
- **Pinch** to zoom and drag to pan.
- Select a wire to show its **+** and **✕** buttons.
- **Save**, **Undo**, **Redo** and the **Active** switch move into the **⋯** menu.
- The drawer starts collapsed, the status panel starts folded (tap it to open), and the minimap and zoom controls are hidden.
