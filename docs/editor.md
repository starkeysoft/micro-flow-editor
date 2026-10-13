# Using the Editor

The editor has two pages: the **flows page** (`/`) lists your flows, and the **canvas** (`/flows/<id>`) edits one flow. When [sign-in](#signing-in) is on, a **login page** (`/login`) comes first.

## Table of Contents
- [The Flows Page](#the-flows-page)
- [Archived Flows](#archived-flows)
- [The Canvas](#the-canvas)
- [Adding Nodes](#adding-nodes)
- [Connecting Nodes](#connecting-nodes)
- [The Inspector](#the-inspector)
- [Running a Flow](#running-a-flow)
- [The Drawer](#the-drawer)
- [Viewing Past Executions](#viewing-past-executions)
- [Saving and Snapshots](#saving-and-snapshots)
- [Undo and Redo](#undo-and-redo)
- [Copy, Paste and Duplicate](#copy-paste-and-duplicate)
- [Layout Tools](#layout-tools)
- [The ⋯ Menu](#the--menu)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [On a Phone](#on-a-phone)
- [Signing In](#signing-in)
- [Settings](#settings)

## The Flows Page

- **New flow** creates a flow with a single Manual Trigger called **Start**.
- **Import** loads a JSON file made by **Export JSON** (see [Data Model: Export Format](data-model.md#export-format)). Imported flows start inactive.
- **Start from a template** creates a flow from one of the [bundled templates](examples/templates.md).
- Each flow card shows its triggers, node count ("1 node", "5 nodes") and last execution. Its footer has the **Active** switch (see [Triggers](triggers.md#active-flows)), **Duplicate**, **Export JSON**, **Archive** (box icon, see [Archived Flows](#archived-flows)) and **Delete**. The switch is disabled until the flow has a Schedule or Webhook trigger.
- A search box appears once there are more than four flows.
- The collapsed **Archived** section at the bottom of the page, below the templates, lists [archived flows](#archived-flows).
- The footer shows which database the server uses.
- The first button in the header opens [Settings](#settings). It shows your username when you are signed in, and **Settings** otherwise.

## Archived Flows

Archiving takes a flow out of the flow list without losing it. Archive a flow with the box icon on its card or **⋯ → Archive flow…** in the editor; both ask for confirmation first. Archiving:

- stops the flow's triggers and any of its executions that are running;
- keeps only its most recent snapshot. If the flow has no snapshot, or has changes that aren't in its latest one (name, description, graph or options), they are saved as an **Archived** snapshot first;
- deletes its other snapshots and its execution history.

From the editor, pending autosave edits are sent first, and the editor returns to the flows page afterwards.

Archived flows are listed in the **Archived** section at the bottom of the flows page (after the templates). It is collapsed by default and its heading shows how many there are. Each entry shows the flow's name, description, trigger badges, node count and **archived *time* by *user*** (the user only when sign-in was on). Its buttons:

- **Unarchive** brings the flow back as a card, with the same id (so old links to it work again), **switched off**, and with the kept snapshot as its only snapshot. Its execution history doesn't come back. Turn it on again to re-register its triggers.
- **⇩** downloads the kept snapshot as JSON, in the same [export format](data-model.md#export-format) as **Export JSON**, so it can be imported as a new flow.
- **✕** deletes the archived flow permanently, after confirmation.

Opening an archived flow's URL shows **"*name*" is archived. Unarchive it from the Archived section of the flows page.**

## The Canvas

The canvas is built on [Vue Flow](https://vueflow.dev/). Nodes snap to a 20px grid. Zoom ranges from 0.2× to 2×. A minimap appears in the bottom-right corner once a flow has more than six nodes, and zoom controls sit in the bottom-left corner.

Each node shows its icon, name, type and a one-line summary of its settings. Badges show its retries (`↻2`) and timeout (`⏲10000ms`) when they are set. Trigger nodes have a **▶** button that runs the flow from that trigger.

**Opening a flow.** If the server can't be reached at all (no HTTP answer, for example while it restarts), the canvas shows **Reconnecting to the server…** and tries again, up to 8 attempts in all, waiting 0.5 s, 1 s, 1.5 s … 3.5 s between them (about 14 seconds). After that, or for any HTTP error, it shows **Could not load the flow: …**. A flow that doesn't exist shows **This flow does not exist (it may have been deleted).**, and an archived one says so instead (see [Archived Flows](#archived-flows)).

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

Press **▶ Run** in the top bar (or Ctrl/⌘ + Enter). Run sends the canvas as it is now, whether or not it is in a snapshot. (Webhook and scheduled runs of an active flow use the latest snapshot instead; see [Saving and Snapshots](#saving-and-snapshots).)

When a flow has several triggers, Run starts from the selected trigger if one is selected. Otherwise it starts from the first Manual Trigger, or else the first trigger. The **▶** button on a trigger node runs from that trigger. Running a Webhook Trigger by hand uses its **Test body**. Running a Schedule Trigger by hand outputs `{ timestamp }`.

While a run is in progress:

- the running node pulses, and finished nodes show `✓`, `✕`, `↻` (retrying) or `–` (skipped);
- a `×N` badge shows how many times a node ran (in loops, for example);
- wires the run went along are highlighted, and so is the output port of the branch an If or Switch took;
- **■ Stop** replaces Run. Stop aborts in-flight HTTP requests and waits, and the run ends with the status `stopped`.

If the graph can't be compiled (no trigger, a cycle, two nodes with the same name), the run doesn't start. The error appears as a message, and the node at fault is selected.

The canvas follows every new run of the flow, including webhook and scheduled runs started by someone else, unless you are viewing a past execution.

## The Drawer

The drawer at the bottom has five tabs. Click a tab to open it, and click ▾ / ▴ to collapse or expand it.

- **Output** - cards from [Output Card](nodes.md#output-card) nodes.
- **Log** - the execution log: every node that finishes, retries, is skipped or fails, plus Log node messages and run start/end. Click an entry to select its node.
- **Executions** - every saved run of this flow (manual, webhook and schedule), newest first, with status, mode, start time, duration and error. **Clear finished** deletes every finished execution.
- **Snapshots** - the flow's saved versions, newest first. See [Snapshots](#snapshots).
- **micro-flow** - what the canvas compiles to. **Tree** shows the root `Workflow`, its steps with their micro-flow classes, and nested `Workflow`s for every branch. Helper steps the compiler adds are dimmed (see [Compilation](compilation.md#hidden-steps)). Click a step to select its node. **serialize()** shows the root workflow's `prepareForSerialization()` output. The tab refreshes as you edit while it is open.

## Viewing Past Executions

Click an execution in the **Executions** tab. Its node data, log and output cards load onto the canvas, and a **viewing … run** badge appears in the drawer bar. New runs don't replace what you are viewing. Click **✕** on the badge to go back to the live view.

Execution data is shown on the canvas as it is now. If nodes have been removed since that run, a message says how many are missing.

## Saving and Snapshots

### Autosave

Every change is saved automatically: about 400 ms after you change the graph, the name, the description or **Stop on first error**, the editor sends the whole flow (with the current viewport) to the server. Only one request is in flight at a time, and the newest state wins. The server keeps it in its autosave cache and writes it to the database within `FLUSH_INTERVAL_MS` (see [Server: Autosave](server.md#autosave)). Panning or zooming on its own doesn't trigger a save; the viewport goes along with the next one.

The top bar shows the state:

- **Saved** - the server has everything.
- **Saving…** - a change is waiting to be sent, or being sent.
- **Offline – retrying** - the server can't be reached. Your edits stay in the page and are sent again every 3 seconds until it answers.

On a phone only **Offline – retrying** is shown.

**Leaving the page** doesn't ask about unsaved changes any more:

- Going to another page of the editor (the flows page, for example) waits for the pending save. If it fails, the editor asks "Your latest edits couldn't be saved. Leave anyway?".
- Closing or reloading the tab sends the pending edits with a `keepalive` request (on `beforeunload` and `pagehide`), which the browser delivers even as the page goes away. Browsers cap these requests at 64 KB, so for a flow over about 60 KB the browser asks you to confirm leaving instead.
- Hiding the tab (switching tabs or apps, locking a phone) sends pending edits straight away.
- **Duplicate flow**, the **Active** switch and **Sign out** send pending edits first.

### Snapshots

**Save** (Ctrl/⌘ + S, or the **Save** button in the top bar) creates a **snapshot**: a copy of the flow's graph, name, description and options at that moment. Pending edits are sent first. The Save button has an amber dot when the canvas has changes that aren't in the latest snapshot, and it is disabled when nothing has changed since then (a flow with no snapshot can always be saved).

**Save is what goes live.** While a flow is [active](triggers.md#active-flows), its webhooks and schedules run the **latest snapshot**, not the autosaved canvas, so half-finished edits never answer a request. Saving a snapshot of an active flow switches its triggers to it straight away; the message says "Snapshot saved. The flow's triggers now run it." Turning a flow on also saves an **Activated** snapshot if the canvas has changes that aren't in one. **▶ Run** always runs the canvas as it is.

If an active flow's triggers are invalid (a bad cron expression, a webhook path another flow already uses), saving still keeps the snapshot, but the flow is switched to inactive and a message explains why.

The **Snapshots** tab in the drawer lists them, newest first:

- At the top, an optional **Label** (up to 200 characters) and a **Save snapshot** button.
- Each snapshot shows its label (or **Snapshot**), when it was saved, its node count and who saved it (when [sign-in](#signing-in) is on). The newest one has a **live** badge when the flow is active, and **latest** otherwise. Snapshots saved by other means are labelled **Activated** or **Saved through the API**.
- A note appears when the canvas has changes that aren't in a snapshot.
- **Restore** loads the snapshot onto the canvas (graph, name, description and Stop on first error) after asking. It doesn't change any snapshot: it is an ordinary edit, autosaved like any other, and **Ctrl/⌘ + Z** undoes the graph part of it. For an active flow, press Save afterwards to make it live.
- **⇩** downloads the snapshot as JSON, in the same [export format](data-model.md#export-format) as **Export JSON**, so it can be imported as a new flow.
- **✕** deletes the snapshot after asking. Deleting the newest snapshot of an active flow makes the one before it live; with no snapshots left, the triggers run the autosaved flow.

The server keeps up to `MAX_SNAPSHOTS_PER_FLOW` snapshots per flow (100 by default) and deletes the oldest when there are more. Deleting a flow deletes its snapshots.

## Undo and Redo

**Undo** (Ctrl/⌘ + Z) and **Redo** (Ctrl/⌘ + Shift + Z or Ctrl + Y) cover the graph: nodes, wires, positions and node settings. History keeps the last 100 states. The flow name, description and Stop on first error are not part of undo history. Undo and redo are edits like any other, so they are autosaved too.

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
- **Export JSON** - downloads the flow as the server has it: the autosaved working copy, not a snapshot. Edits from the last moment may still be on their way. To download a snapshot, use **⇩** in the [Snapshots](#snapshots) tab. See [Data Model: Export Format](data-model.md#export-format).
- **Duplicate flow** - sends pending edits first, then opens the copy. Copies start inactive and without snapshots.
- **Description…** - edit the flow's description.
- **Keyboard shortcuts**
- **Settings…** - opens [Settings](#settings).
- **Sign out (name)** - shown when you are signed in. Sends pending edits first, and asks before signing out if they couldn't be saved.
- **Archive flow…** - asks for confirmation, sends pending edits, archives the flow and returns to the flows page. See [Archived Flows](#archived-flows).
- **Delete flow** - deletes the flow, its executions and its snapshots.

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

Save, Run and Esc work everywhere. The other shortcuts are ignored while you type in a field.

## On a Phone

On screens 760px wide or less:

- The palette and the inspector open as **bottom sheets**. Tap the floating **+** button to add a node, and tap a node to edit it.
- To connect nodes, **tap an output port, then tap an input port**. Dropping a wire on empty canvas opens the palette sheet.
- **Pinch** to zoom and drag to pan.
- Select a wire to show its **+** and **✕** buttons.
- **Save snapshot**, **Undo**, **Redo** and the **Active** switch move into the **⋯** menu.
- The save indicator only shows when the editor is offline (**Offline – retrying**).
- The drawer starts collapsed, the status panel starts folded (tap it to open), and the minimap and zoom controls are hidden.

## Signing In

Sign-in is optional and **off by default**. Turn it on in [Settings](#settings), or have the server force it with `AUTH_ENABLED` (see [Server: Sign-in](server.md#sign-in)). While it is on, every page needs an account; webhook URLs (`/webhook/…`) stay open.

- Opening any page while signed out goes to `/login`, remembering where you were going (`/login?next=/flows/<id>`). After signing in you land there.
- When sign-in is on and the server has no accounts yet, the login page reads **Create the first account** and asks for the password twice. That account can add others.
- After 10 wrong passwords from one address in 15 minutes, the server refuses sign-ins for a while (`Too many failed sign-ins…`).
- Opening `/login` while signed in (or with sign-in off) goes to the flows page.

**When a session ends** (it expired, someone deleted your account or changed your password elsewhere, or sign-in was just turned on), the next request to the server answers `401` and the editor sends you to the login page, then back to the same page. On the canvas, the editor first tries to send pending edits; if that fails (it will, once the session has ended), it asks "Your latest edits couldn't be saved. Leave anyway?". The canvas's live connection also stops instead of retrying once the server says you are signed out. Sessions in use are renewed, so a session only ends after `SESSION_TTL_HOURS` (7 days by default) without any requests.

## Settings

The **Settings** dialog opens from the flows page header or from **⋯ → Settings…** on the canvas.

- **Sign-in** switch. Turning it on asks for a username and password in the same step, so nobody gets locked out: if there are no accounts yet, you create the first one (password asked twice, at least 8 characters); otherwise you must sign in with an existing account. You are then signed in. Turning it off asks for confirmation; accounts are kept. When the server sets `AUTH_ENABLED`, the switch is disabled with a 🔒 note explaining why.

While sign-in is on and you are signed in, the dialog also shows:

- **Your account** - your username, **Sign out**, and **Change password** (current password, then the new one twice). Changing it signs out your other sessions.
- **Users** - every account with when it last signed in. Add one with a username and password (8+ characters), or delete one with **✕** (it is signed out at once). You can't delete yourself. Every user can see and edit every flow; there are no roles.

A forgotten password can't be reset from the editor. Use the `micro-flow-editor user passwd <name>` command on the server (see [Server: Recovery](server.md#recovery)).
