# Triggers

Every logic flow starts at a trigger node. There are three: Manual, Schedule and Webhook. The node fields are listed in [Node Reference: Triggers](nodes.md#triggers). This page covers when each one fires. The code lives in `server/engine/triggers.js` and `server/api/webhooks.js`.

## Table of Contents
- [Choosing the Trigger for a Run](#choosing-the-trigger-for-a-run)
- [Active Flows](#active-flows)
- [Manual Trigger](#manual-trigger)
- [Schedule Trigger](#schedule-trigger)
- [Webhook Trigger](#webhook-trigger)
- [Webhook Responses](#webhook-responses)
- [Webhook Conflicts](#webhook-conflicts)

## Choosing the Trigger for a Run

A flow may have any number of triggers. Each run starts from exactly one of them, and only the nodes reachable from it run.

- **Run in the editor:** the selected trigger if a trigger is selected, else the first Manual Trigger, else the first trigger. The **▶** button on a trigger node runs from that trigger.
- **Schedule:** the Schedule Trigger that fired.
- **Webhook:** the Webhook Trigger whose path and method match the request.
- **[Runtime](runtime.md):** the `trigger_id` option, or the same default as the editor.

## Active Flows

Schedule and Webhook triggers only listen while the flow is **active**. Turn it on with the **Active** switch in the editor's top bar (in the **⋯** menu on a phone) or on the flow's card on the flows page. The switch is disabled until the flow has a Schedule or Webhook trigger.

**Active flows run their latest snapshot.** The editor [autosaves](editor.md#autosave) every change, but webhooks and schedules don't use the autosaved canvas: they run the flow's latest [snapshot](editor.md#snapshots), the version you last saved with **Save** (Ctrl/⌘ + S). Half-finished edits never go live; press Save when they are ready.

- Activating writes any pending edits, then saves an **Activated** snapshot if the flow differs from its latest snapshot (name, description, graph or options), and registers the triggers of the latest snapshot.
- Saving a snapshot of an active flow re-registers its triggers from it, so changes to a schedule or a webhook path apply as soon as you press Save. Autosaved edits don't touch the triggers.
- Deleting a snapshot of an active flow re-registers its triggers from whichever snapshot is now the latest.
- `PUT /api/flows/:id` with a `graph` saves a **Saved through the API** snapshot and re-registers from it (see [REST API](api.md#put-apiflowsid)).
- A flow with no snapshot at all (one that was active before snapshots existed) runs its autosaved row instead. An active flow's only snapshot can't be deleted, so this can't happen by deleting snapshots.
- If registration fails (a bad cron expression, a webhook path with invalid characters or one that another active flow already uses), the flow is **switched to inactive** and the error says why. The edits and the snapshot are kept.
- **▶ Run** in the editor runs the canvas as it is, snapshot or not.
- When the server starts, it registers the triggers of every active flow from its latest snapshot. A flow whose triggers fail to register is logged and skipped.
- New flows, duplicated flows and imported flows start inactive.
- [Archiving](editor.md#archived-flows) a flow drops its triggers and stops its running executions, so its webhook paths answer `404` and its schedules stop firing. An unarchived flow comes back **inactive**; turn it on again to register its triggers.

Manual Triggers don't care whether the flow is active.

## Manual Trigger

Fires when you press Run. Its output is its **Output JSON**. Executions started this way have the mode `manual`. With the [runtime](runtime.md), a `trigger_payload` replaces the Output JSON.

## Schedule Trigger

While the flow is active, fires on one of two kinds of schedule:

- **Every N minutes** (`interval`) - a timer that fires every N minutes (at least 1), counted from when the flow's triggers were last registered: when it was activated, a snapshot was saved or deleted, or the server started. It doesn't fire straight away.
- **Cron** (`cron`) - a cron expression handled by [node-schedule](https://www.npmjs.com/package/node-schedule), the scheduler micro-flow's `DelayStep` uses. The standard five fields are `minute hour day-of-month month day-of-week`, e.g. `*/15 * * * *` or `0 9 * * 1-5`. node-schedule also accepts an optional leading seconds field. Times use the server's time zone.

Each time it fires, the server re-reads the flow from the database. If the flow has been deactivated in the meantime it does nothing, and otherwise it runs the flow's latest snapshot (or the flow row, if it has no snapshot). The trigger outputs `{ timestamp }`. Executions have the mode `schedule`.

If the server is already running `MAX_CONCURRENT_RUNS` flows, the scheduled run is skipped and an error is logged to the server console.

## Webhook Trigger

While the flow is active, the server listens on:

```text
<METHOD> /webhook/<path>
```

- **Path** - letters, numbers, `-`, `_`, `.` and `/`. Slashes at either end are ignored, so `/orders/new/` and `orders/new` are the same. Nested paths like `orders/new` work.
- **Method** - one of `POST`, `GET`, `PUT`, `PATCH`, `DELETE`, or `ANY`. A request is matched on its exact method first, then on `ANY`.
- **Body** - JSON, URL-encoded form and `text/plain` bodies are parsed, up to 1 MB each.
- **No sign-in** - webhook URLs are public, even when the editor's [sign-in](server.md#sign-in) is on. Check a secret header with an If node if callers must prove who they are.

The trigger outputs:

```json
{
  "method": "POST",
  "path": "greet",
  "query": { "page": "2" },
  "headers": { "content-type": "application/json", "...": "..." },
  "body": { "name": "Ada" }
}
```

Executions have the mode `webhook`.

When you press Run in the editor, the trigger uses its **Test body** instead, with empty `query` and `headers`. The inspector shows the full webhook URL for the node.

```bash
curl -X POST http://localhost:8090/webhook/greet \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ada"}'
```

## Webhook Responses

The server waits for the **whole flow to finish** before it replies. Then:

| Situation | Reply |
|-----------|-------|
| A [Respond to Webhook](nodes.md#respond-to-webhook) node ran | Its status, content type and body. This holds even if the flow failed later. |
| No Respond node ran, the run succeeded | `200` with the flow's last output as JSON (`null` if there is none). |
| No Respond node ran, the run failed or was stopped | `500` with `{ "error": "...", "execution_id": "..." }`. |
| No active flow listens on that method and path | `404` with `{ "error": "no active flow listens on POST /webhook/…" }`. |
| The matching flow is no longer active in the database | `404` with `{ "error": "that flow is not active" }`. |
| The server is already running `MAX_CONCURRENT_RUNS` flows | `429` with `{ "error": "..." }`. |
| The latest snapshot's graph can't be compiled | `422` with `{ "error": "..." }`. |

The "last output" is the output of the last action node that ran anywhere in the flow. With a Wait in the flow, the caller waits too. There is no separate request timeout.

## Webhook Conflicts

Only one active flow may listen on a given path and method. Activating a flow (or saving a snapshot of an active one) fails with "Another active flow already listens on /webhook/<path>." when:

- another active flow uses the same path and the same method, or
- either of them uses `ANY` on that path.

Two Webhook Triggers in the **same** flow may share a path. When they do, the one registered last wins.
