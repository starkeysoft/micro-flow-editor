# Expressions

Node fields can read data from the flow with `{{ … }}` templates. There is no code node and nothing is passed to `eval`: an expression is always a **path** into some data. The functions behind this, `getPath()` and `resolve()`, live in `shared/nodes.js` and are exported by the [runtime](runtime.md).

## Table of Contents
- [Templates](#templates)
- [Paths](#paths)
- [Roots](#roots)
- [Types](#types)
- [Auto-Typing](#auto-typing)
- [Where Expressions Work](#where-expressions-work)
- [Examples](#examples)

## Templates

Wrap a path in double braces:

```text
https://pokeapi.co/api/v2/pokemon/{{ id }}
Hello, {{ user.name }}!
```

Spaces inside the braces are optional: `{{id}}` and `{{ id }}` are the same.

## Paths

A path reads from the node's **input** by default. It uses JavaScript's dot and bracket syntax:

| Path | Reads |
|------|-------|
| `name` | `input.name` |
| `user.address.city` | `input.user.address.city` |
| `types[0].type.name` | `input.types[0].type.name` |
| `[0].city` | `input[0].city` (when the input is a list) |
| `$` or nothing | the whole input |
| `$.name` | `input.name` |

A path that runs into `null` or `undefined` part-way returns `undefined`. It doesn't throw.

Paths are split on `.`, `[`, `]` and quotes, so keys that contain those characters can't be reached.

## Roots

A path that starts with one of these reads from somewhere other than the input:

| Root | Value |
|------|-------|
| `$item` | The current item of the innermost loop. In a Repeat, that is the input plus `index`. In a Repeat While, it is the pass's input. Outside any loop it is `undefined`. |
| `$trigger` | The output of the trigger the run started from. For a webhook, `{{ $trigger.body.name }}`. |
| `$node["Name"]` | The latest output of the node called `Name`, e.g. `{{ $node["Fetch user"].id }}`. Works for triggers, action nodes, and loop nodes (their list of results). If, Switch, Filter, Skip Next If and Wait have no entry. |
| `$now` | The current time as an ISO string. |
| `$execution` | `{ id, mode }`: the execution id and how it started (`manual`, `webhook` or `schedule`). In the [runtime](runtime.md), `{ id: null, mode: 'runtime' }`. |

Roots take the rest of the path as usual: `{{ $item.name }}`, `{{ $trigger.query.page }}`, `{{ $execution.id }}`.

## Types

**A field that is only one expression keeps the value's type.** `{{ count }}` gives the number `5`, `{{ tags }}` gives the array itself, and `{{ missing }}` gives `undefined`.

**An expression mixed with text produces text.** Each expression is replaced by its value: objects and arrays as JSON, `null` and `undefined` as an empty string.

| Field | Input | Result |
|-------|-------|--------|
| `{{ count }}` | `{ "count": 5 }` | `5` (number) |
| `{{ user }}` | `{ "user": { "id": 1 } }` | `{ "id": 1 }` (object) |
| `n = {{ count }}` | `{ "count": 5 }` | `"n = 5"` |
| `{{ user }}!` | `{ "user": { "id": 1 } }` | `"{\"id\":1}!"` |
| `{{ missing }} x` | `{}` | `" x"` |

Fields that always need text (URL, header values, card fields, log messages, text and HTML Respond bodies) turn a single-expression result into text as well.

## Auto-Typing

A value with **no** `{{ }}` in it is auto-typed:

| Text | Value |
|------|-------|
| `true` / `false` | boolean |
| `null` | `null` |
| `42`, `-3.5`, `1e3` | number |
| anything else | the text as typed |

So in Edit Fields, `count = 5` sets the number 5 and `ok = true` sets a boolean. Auto-typing also applies to condition values (except for the text operators, see [Conditions and Operators](nodes.md#conditions-and-operators)) and to each item of an `in` / `not_in` list.

## Where Expressions Work

| Node | Fields |
|------|--------|
| HTTP Request | URL, header values, body |
| Edit Fields | each value (after `=`) |
| Output Card | title, image URL, text |
| Log | message |
| Respond to Webhook | body |
| Repeat | Times |
| If, Filter, Skip Next If, Repeat While, Switch cases | **Compare with** value |

The **Value at path** / **List at path** / **Source path** fields of If, Switch, Filter, Skip Next If, Repeat While, Loop Over Items and Transform are **paths** themselves. Write `status` or `$item.id` there, without braces. Transform's Field and Edit Fields' keys are paths too.

## Examples

```text
# Edit Fields (mode: keep only these)
name   = {{ name }}
type   = {{ types[0].type.name }}
slot   = {{ $item.index }}
caller = {{ $trigger.headers.user-agent }}
seen   = {{ $now }}
```

```text
# HTTP Request URL using an earlier node's output
https://api.example.com/users/{{ $node["Pick user"].id }}/orders
```

```text
# If: compare with another field of the input
Value at path:  stock
Operator:       <
Compare with:   {{ reorder_level }}
```
