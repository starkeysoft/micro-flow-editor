# Getting Started

This page gets the editor running and walks through a first logic flow.

## Table of Contents
- [Requirements](#requirements)
- [Start the Editor](#start-the-editor)
- [Your First Flow](#your-first-flow)
- [Starting from a Template](#starting-from-a-template)
- [Next Steps](#next-steps)

## Requirements

- **Node.js 24+** (micro-flow's events need a global `CustomEvent`; the `sqlite3` driver needs Node 20+ and glibc 2.38), or
- **Docker** with Compose.

## Start the Editor

### With Docker

```bash
docker compose up -d --build
```

### With npm

```bash
npm install
npm run build
npm start
```

### With the CLI

```bash
npx @ronaldroe/micro-flow-editor
```

The package is not published to npm yet. From a checkout, use `node bin/micro-flow-editor.js` after `npm run build`.

Each of these serves the editor at http://localhost:8090 and stores data in SQLite. See [Server](server.md) for ports, other databases and every setting.

## Your First Flow

1. On the flows page, click **New flow**. The new flow has one node: a Manual Trigger called **Start**.
2. Select **Start**. In the inspector's **Parameters** tab, set **Output JSON** to:

   ```json
   { "items": [3, 12, 7, 20] }
   ```

3. With **Start** still selected, click **Loop Over Items** in the palette. Clicking a palette item adds the node after the selected one and wires it up. Set **List at path** to `items`.
4. Drag a wire from the loop's **each** port and drop it on empty canvas. A node picker opens. Choose **If** and set it to `$item` `>` `10`.
5. From the If's **true** port, add an **Output Card** with the title `Big: {{ $item }}`.
6. Press **▶ Run** (or Ctrl/⌘ + Enter).

The nodes light up as they run, and the drawer's **Output** tab shows two cards: `Big: 12` and `Big: 20`. Click any node to see its input and output in the **Data** tab. Open the drawer's **micro-flow** tab to see what the canvas compiled to: a root `Workflow` with a `LoopStep`, whose body `Workflow` holds a `ConditionalStep` with a nested `Workflow` for each branch.

Press **Save** (Ctrl/⌘ + S) to keep the flow. Running does not need a save: Run sends the canvas as it is.

## Starting from a Template

The flows page offers five starter flows. They call public APIs that need no key. See [Bundled Templates](examples/templates.md) for a walk-through of each.

## Next Steps

- [Using the Editor](editor.md) - everything the canvas can do.
- [Node Reference](nodes.md) - every node type.
- [Triggers](triggers.md) - run flows on a schedule or from a webhook.
- [Runtime](runtime.md) - run an exported flow in your own app.
