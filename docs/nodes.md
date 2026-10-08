# Node Reference

Every node type in the editor's catalogue (`shared/nodes.js`). For each node: what it does, its fields, its output ports and the micro-flow class it compiles to. What action nodes do when they run lives in `server/engine/actions.js`.

Fields marked *templated* accept [expressions](expressions.md) such as `{{ name }}` or `{{ $item.id }}`.

## Table of Contents
- [How Data Moves](#how-data-moves)
- [Settings (Every Node)](#settings-every-node)
- [Triggers](#triggers): [Manual Trigger](#manual-trigger), [Schedule Trigger](#schedule-trigger), [Webhook Trigger](#webhook-trigger)
- [Data](#data): [HTTP Request](#http-request), [Edit Fields](#edit-fields), [Transform](#transform), [Random Number](#random-number)
- [Logic](#logic): [If](#if), [Switch](#switch), [Filter (Stop If)](#filter-stop-if), [Skip Next If](#skip-next-if)
- [Flow](#flow): [Loop Over Items](#loop-over-items), [Repeat](#repeat), [Repeat While](#repeat-while), [Wait](#wait), [Chaos Monkey](#chaos-monkey)
- [Output](#output): [Output Card](#output-card), [Log](#log), [Respond to Webhook](#respond-to-webhook)
- [Conditions and Operators](#conditions-and-operators)

## How Data Moves

- Each node's **input** is the **output** of the node wired into it. Triggers have no input.
- Action nodes produce a new output. Logic and flow-control nodes (If, Switch, Filter, Skip Next If, Wait) pass their input through unchanged.
- Loop nodes send each item (or pass) down `each`, and a **list of results** down `done`.
- If a node fails and the run carries on (Stop on first error off), the nodes after it in the same branch are marked `skipped` with the note "no input: an earlier node failed".
- A node that two different paths lead to runs once for each path. There is no merge node. See [Compilation](compilation.md#a-node-reached-by-several-paths).

## Settings (Every Node)

The inspector's **Settings** tab sets these on every node except Wait:

| Setting | micro-flow option | Range | Default |
|---------|-------------------|-------|---------|
| Retries | `max_retries` | 0–10 | `0` |
| Timeout ms | `max_timeout_ms` | 0–86 400 000 | blank: `30000` for ordinary nodes, no timeout for If, Switch and the loop nodes |
| Notes | none | free text | blank |

## Triggers

Every flow starts at a trigger. A flow may have several (for example a Manual Trigger for testing and a Webhook Trigger for real calls). Triggers have no input port and one output. Each compiles to a **`Step`**, the first step of the root `Workflow`. See [Triggers](triggers.md) for when they fire.

### Manual Trigger

Starts the flow when you press **Run**. Its output is the JSON you enter. When the flow is run with the [runtime](runtime.md) and a `trigger_payload` is given, it outputs that payload instead.

| Field | Description |
|-------|-------------|
| Output JSON | Any JSON value. Default `{}`. Invalid JSON fails the node. |

### Schedule Trigger

Runs the flow on a schedule while the flow is [active](triggers.md#active-flows).

| Field | Description |
|-------|-------------|
| Mode | `every N minutes` (`interval`) or `cron expression` (`cron`). |
| Minutes | For interval mode. At least 1. Default `5`. |
| Cron | For cron mode. Default `0 9 * * 1-5` (09:00 on weekdays). |

Output: `{ timestamp }` (ISO time).

### Webhook Trigger

Runs the flow when a request arrives at `/webhook/<path>` while the flow is active.

| Field | Description |
|-------|-------------|
| Path | Letters, numbers, `-`, `_`, `.` and `/`. Leading and trailing slashes are ignored. Default `my-hook`. |
| Method | `POST` (default), `GET`, `PUT`, `PATCH`, `DELETE` or `ANY`. |
| Test body | JSON used as `body` when you press Run in the editor. |

Output: `{ method, path, query, headers, body }`. When run from the editor, `query` and `headers` are empty, `body` is the test body, and `method` is the configured method (`POST` for `ANY`). The caller receives what a [Respond to Webhook](#respond-to-webhook) node sets, or else the flow's last output.

## Data

### HTTP Request

Calls a URL from the server and outputs the response. **Compiles to:** `Step`.

| Field | Description |
|-------|-------------|
| Method | `GET` (default), `POST`, `PUT`, `PATCH`, `DELETE`. |
| URL | *Templated.* Must start with `http://` or `https://`. |
| Headers | One `Name: value` per line. Values are *templated*. |
| Body | Shown for POST, PUT and PATCH. *Templated.* A value that resolves to text is sent as-is. Anything else is sent as JSON. |
| Output | `body (JSON if possible)` (`auto`, default) or `{ status, headers, body }` (`full`). |

- Without a `Content-Type` header, the body is sent as `application/json`, or as `text/plain` when it is text that doesn't start with `{` or `[`.
- The response body is parsed as JSON when the response's content type mentions JSON or the text starts with `{` or `[`. Otherwise it stays text.
- In `auto` mode a non-2xx status fails the node (`HTTP 404 Not Found from …`). In `full` mode every status is output and nothing fails.
- The request is aborted when the step's timeout passes (30 s by default) or when the run is stopped.
- Responses larger than 5 MB fail the node.
- With `BLOCK_PRIVATE_NETWORKS` on, requests to private, loopback, link-local, CGNAT and multicast addresses fail, and redirects are followed by hand (at most 5) so each hop is checked. See [Server: SSRF Guard](server.md#ssrf-guard).

### Edit Fields

Sets fields on the input. **Compiles to:** `Step`.

| Field | Description |
|-------|-------------|
| Fields | One `key = value` per line. Keys can be paths (`user.name`, `tags[0]`). Values are *templated* and [auto-typed](expressions.md#auto-typing). |
| Mode | `merge into input` (`merge`, default) or `keep only these` (`replace`). |

In merge mode, an input that isn't a plain object is wrapped as `{ value: input }` first. Missing parents in a key path are created (an array when the next part is a number).

### Transform

Reshapes data. **Compiles to:** `Step`.

| Field | Description |
|-------|-------------|
| Operation | See the table below. |
| Source path | Path to read from. Blank means the whole input. |
| Field / Regex / Separator | Shown for the operations that use it. |
| N | For `add`, `first` and `last`. |
| Write into field | Blank: the result replaces the input. Otherwise the result is written into this field (a path) of a copy of the input. |

"List" below means: an array as-is, an object's values, nothing (`null`/missing) as `[]`, or any other value as a one-item list.

| Operation | Result |
|-----------|--------|
| `get` | The value at the source path. |
| `add` | Source as a number plus N. |
| `pluck` | `field` from each item of the list. |
| `length` | Length of a string, or of the list. |
| `first` / `last` | The first / last N items (`last` with N = 0 gives `[]`). |
| `sum` | Sum of the items (or of `field` in each item), non-numbers counting as 0. |
| `sort` | The list sorted ascending (by `field` if given). |
| `reverse` | The list reversed. |
| `unique` | Items with duplicates removed (compared by `field` if given). |
| `random` | One random item. |
| `shuffle` | The list in random order. |
| `keys` / `values` | `Object.keys` / `Object.values` of the source. |
| `join` | The list joined into text with the separator (default `,`). Objects are JSON-encoded. |
| `split` | Text split into a list by the separator (default `,`). |
| `upper` / `lower` | Text in upper / lower case. |
| `match` | The first capture group of the regex (or the whole match), or `null`. |
| `parse_json` | Text parsed as JSON. Non-text passes through. |
| `stringify` | `JSON.stringify` of the source. |

### Random Number

Adds a random whole number to the input. **Compiles to:** `Step`.

| Field | Description |
|-------|-------------|
| Field | Path to write to. Default `id`. Blank writes to `value`. |
| Min / Max | Inclusive bounds. Default 1 and 100. The node fails unless both are numbers with min ≤ max. |

A non-object input is wrapped as `{ value: input }` first.

## Logic

Logic nodes pass their input through unchanged.

### If

Runs the `true` or the `false` branch. **Compiles to:** `ConditionalStep`, with each branch as a nested `Workflow` (`true_callable` / `false_callable`). **Ports:** `true`, `false`.

| Field | Description |
|-------|-------------|
| Value at path | Path to the value to test. Blank means the whole input. |
| Operator | Any [operator](#conditions-and-operators). |
| Compare with | The value to compare against. Hidden for operators that take no value. |

The If node has no output of its own: whatever follows must hang off `true` or `false`.

### Switch

Reads one value and runs the first case that matches, or `default`. **Compiles to:** `SwitchStep`, with one `Case` per case. Each case's callable, and the default, is a nested `Workflow`. **Ports:** `case-0`, `case-1`, … then `default`.

| Field | Description |
|-------|-------------|
| Value at path | Path to the value to switch on. A missing value is compared as `''`. |
| Cases | A list of operator + value pairs, checked in order. **+ Add case** adds one. Removing a case removes its wires. |

Port labels on the canvas show each case's operator and value.

### Filter (Stop If)

If the condition is true, stops the rest of the branch it sits in. **Compiles to:** `FlowControlStep` with `flow_control_type: 'break'`. Fields as for [If](#if).

- Directly inside a loop's `each` branch, a Filter **drops the item**: the pass ends before its result is collected, so it is missing from the `done` list.
- Nested deeper (for example inside an If branch within a loop), it only stops that inner branch. The loop pass still finishes and its last output is collected.
- At the top level of a flow, it ends the run (as a success).

### Skip Next If

If the condition is true, the **next node** in this branch doesn't run, and the one after it does. **Compiles to:** `FlowControlStep` with `flow_control_type: 'skip'`. Fields as for [If](#if).

The skipped node is recorded as `skipped`. Its input passes through to the node after it, as if the skipped node weren't there. Skipping an If or Switch skips the whole node and its branches.

Skipping a loop node skips the whole loop. Its `done` branch then receives the loop's input (not a results list), like any skipped node passing its input on (see [Compilation: Flow Control](compilation.md#flow-control-filter-and-skip-next-if)).

## Flow

### Loop Over Items

Runs the `each` branch once per item. **Compiles to:** `LoopStep` with `loop_type: 'for_each'`, whose callable is a nested body `Workflow`. **Ports:** `each`, `done`.

| Field | Description |
|-------|-------------|
| List at path | Path to the list. Blank means the whole input. |

- An array is used as-is. An object becomes a list of `{ key, value }` entries. `null` or a missing value gives no passes. Any other value is a one-item list.
- Inside the branch, each pass's input is the item, also available as `{{ $item }}` anywhere in the branch.
- `done` receives a list with the last output of each pass, in order. Passes that a [Filter](#filter-stop-if) dropped, or where a node failed (with Stop on first error off), are left out. A pass whose node failed and then succeeded on a retry is kept.
- At most `MAX_LOOP_ITERATIONS` items (default 1000) are used.

### Repeat

Runs the `each` branch N times. **Compiles to:** `LoopStep` with `loop_type: 'for'`. **Ports:** `each`, `done`.

| Field | Description |
|-------|-------------|
| Times | Number of passes: a number, or a `{{ path }}` template read from the node's input (e.g. `{{ count }}`). Resolved each time the loop starts. Default 3. Fractions are rounded down, anything that isn't a number gives 0 passes, and the count is capped at `MAX_LOOP_ITERATIONS`. |

Each pass gets the input plus an `index` field (0, 1, 2, …). A non-object input is wrapped as `{ value: input, index }`. `done` gets the list of results, as for Loop Over Items.

### Repeat While

Runs the `each` branch while a condition holds. **Compiles to:** `LoopStep` with `loop_type: 'while'`. **Ports:** `each`, `done`. Fields as for [If](#if).

The condition is checked before each pass. On the first pass it reads the node's input, and after that it reads the **previous pass's output**, which is also that next pass's input. So the branch can move toward the exit, for example by adding 1 to a `count` field each pass. The loop also stops after `MAX_LOOP_ITERATIONS` passes, without an error. `done` gets the list of results.

### Wait

Pauses this branch, then passes the input on. **Compiles to:** `DelayStep` with `delay_type: 'relative'` (a subclass, see [Compilation](compilation.md#wait-and-the-delaystep-subclass)).

| Field | Description |
|-------|-------------|
| Milliseconds | How long to wait. Default 1000. Clamped to 0–24 hours. |

Wait has no retries or timeout settings. Stopping the run ends the wait at once.

### Chaos Monkey

Passes its input through after a delay, but fails some of the time. Use it to watch micro-flow retry or time out a step. **Compiles to:** `Step`.

| Field | Description |
|-------|-------------|
| Failure chance (%) | Default 50. Failures throw `chaos monkey struck`. |
| Latency (ms) | Delay before passing or failing. Default 300. |

## Output

Output nodes pass their input through unchanged.

### Output Card

Adds a card to the execution's **Output** tab. **Compiles to:** `Step`.

| Field | Description |
|-------|-------------|
| Title | *Templated.* Default `{{name}}`. |
| Image URL | *Templated.* Optional. |
| Text | *Templated.* Optional. |
| Colour | `violet` (default), `red`, `blue`, `green`, `amber` or `slate`. |

The server keeps at most 200 cards per execution.

### Log

Writes a message to the execution log. **Compiles to:** `Step`.

| Field | Description |
|-------|-------------|
| Message | *Templated.* Default `got {{$}}`. |
| Level | `info` (default), `warn` or `error`. |

### Respond to Webhook

Sets the HTTP response that a Webhook Trigger sends back. **Compiles to:** `Step`.

| Field | Description |
|-------|-------------|
| Status code | 100–599. Default 200. |
| Body | *Templated.* Default `{{$}}` (the whole input). |
| Content type | `application/json` (default), `text/plain` or `text/html`. |

- The first Respond node that runs wins. Later ones pass their input through and change nothing.
- With JSON, a body that is a single expression keeps its type. A body that resolves to text (for example `{ "greeting": "Hello, {{name}}!" }`) is parsed as JSON if it can be, and otherwise sent as a JSON string.
- With text or HTML, the body is sent as text.
- The response is sent when the whole flow finishes, not when the Respond node runs.
- Without a Respond node, the caller gets the flow's last output as JSON. See [Triggers: Webhook Responses](triggers.md#webhook-responses).

## Conditions and Operators

If, Filter, Skip Next If, Repeat While and Switch cases compare a value with micro-flow's comparison operators. Every micro-flow comparator is offered except `custom_function`, which would need code.

| Operator | Label in the editor |
|----------|---------------------|
| `===`, `!==` | is, is not |
| `==`, `!=` | loose equality |
| `>`, `>=`, `<`, `<=` | numeric / ordered comparison |
| `string_contains`, `string_not_contains` | text contains / does not contain |
| `string_starts_with`, `string_ends_with` | starts with / ends with |
| `array_contains`, `array_not_contains` | list contains / does not contain |
| `in`, `not_in` | is one of / is none of (a, b, c) |
| `regex_match`, `regex_not_match` | matches / does not match regex |
| `empty`, `not_empty` | is empty / is not empty |
| `nullish`, `not_nullish` | is null or missing / exists |
| `is_type`, `is_not_type` | is type / is not type |

How the **Compare with** value is read:

- `empty`, `not_empty`, `nullish` and `not_nullish` take no value.
- A value containing `{{ }}` is an [expression](expressions.md), resolved each time the condition is checked.
- For `in` and `not_in`, the value is split on commas, and each part is [auto-typed](expressions.md#auto-typing).
- For the text operators (`string_*`, `regex_*`, `is_type`, `is_not_type`), the value is used as text.
- Otherwise the value is auto-typed: `10` compares as the number 10, `true` as a boolean.

The **Value at path** field is a [path](expressions.md#paths), not a template: write `status` or `$item.id`, without braces.
