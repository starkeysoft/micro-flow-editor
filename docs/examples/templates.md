# Bundled Templates

The flows page offers five starter flows (`shared/templates.js`). Each shows off part of micro-flow, and every API they call is public and needs no key. Pick one under **Start from a template**, press **▶ Run**, then open the drawer's **micro-flow** tab to see what it compiled to.

The templates are also exported by the runtime as `TEMPLATES`, so each one can be run from code:

```javascript
import { TEMPLATES, runFlow } from '@ronaldroe/micro-flow-editor/runtime';
const weather = TEMPLATES.find((t) => t.key === 'weather');
const result = await runFlow(weather, { onOutput: (card) => console.log(card.title, card.text) });
```

## Table of Contents
- [Pokémon Type Sorter](#pokémon-type-sorter)
- [Weather Board](#weather-board)
- [Dog Gallery](#dog-gallery)
- [Flaky API (Retries + Filter)](#flaky-api-retries--filter)
- [Webhook Echo API](#webhook-echo-api)

## Pokémon Type Sorter

**Shows:** a `for` `LoopStep`, retries, and `SwitchStep` / `Case`.

```text
Start → Draw 6 (Repeat ×6)
          each → Pick a number → Fetch Pokémon → Keep the basics → By type (Switch)
                                                                    ├─ case-0 (=== fire)          → Fire card
                                                                    ├─ case-1 (=== water)         → Water card
                                                                    ├─ case-2 (in grass, bug)     → Leafy card
                                                                    └─ default                    → Other card
          done → Total HP (Transform: sum of hp) → Summary
```

- **Draw 6** runs its `each` branch six times. Each pass's input is `{ party: 'random', index }`.
- **Pick a number** adds a random `id` from 1 to 1025.
- **Fetch Pokémon** calls `https://pokeapi.co/api/v2/pokemon/{{id}}` with 2 retries and a 10 s timeout.
- **Keep the basics** (Edit Fields, keep only these) reduces the response to `name`, `type` (`{{types[0].type.name}}`), `sprite`, `hp` and `slot` (`{{$item.index}}`).
- **By type** switches on `type`. The third case uses the `in` operator with the list `grass, bug`.
- **done** receives the six pass results. The last output of each pass is that Pokémon's basics, because Output Card passes its input on. **Total HP** sums their `hp`.

## Weather Board

**Shows:** a `for_each` `LoopStep` and a `ConditionalStep`.

```text
Cities (Manual: five cities with lat/lon) → Each city (Loop Over Items: cities)
          each → Open-Meteo → Shape → Warm? (If temp > 18)
                                        ├─ true  → Warm card
                                        └─ false → Cool card
          done → Warmest last (sort by temp) → Pick last (last 1) → Winner
```

- **Open-Meteo** builds its URL from the item: `…?latitude={{lat}}&longitude={{lon}}&current=temperature_2m,wind_speed_10m`.
- **Shape** reads the city name from the loop item, because its input is the API response: `city = {{$item.name}}`.
- **Warm?** compares `temp` with `18`. The value is auto-typed to a number.
- **Winner** reads from a one-item list: `{{[0].city}}`.

## Dog Gallery

**Shows:** a relative `DelayStep`, and Transform's regex match.

```text
Start → Six dogs (HTTP: dog.ceo random/6) → Each photo (Loop Over Items: message)
          each → Wrap URL → Breed from URL → Suspense (Wait 400 ms) → Photo
          done → Count (length) → Done
```

- The API returns `{ message: [url, …] }`, so the loop reads `message`, and each item is a URL string.
- **Wrap URL** turns the string into an object: `url = {{$}}` (keep only these).
- **Breed from URL** runs the regex `breeds/([^/]+)/` on `url` and writes the first group into `breed`.
- **Suspense** waits 400 ms before each card.

## Flaky API (Retries + Filter)

**Shows:** `max_retries`, a `break` `FlowControlStep` and `exit_on_error: false`.

```text
Start → Eight calls (Repeat ×8)
          each → Unreliable API (Chaos 45%, 2 retries) → Score (Random 1–10) → Drop low scores (Filter: score < 4) → Result
          done → Count kept (length) → Summary
```

- **Unreliable API** fails 45% of the time and has 2 retries. Watch `↻` appear on the node and `step_retrying` in the log.
- A call that succeeds on a retry is kept. The flow has **Stop on first error** off, so a call that fails all three attempts doesn't end the run. The nodes after it in that pass are marked skipped, and the pass is left out of the results.
- **Drop low scores** is a Filter directly in the loop's branch, so a score under 4 drops the pass.
- **Summary** reports how many of the eight passes were kept.

## Webhook Echo API

**Shows:** a Webhook Trigger, Respond to Webhook and a `ConditionalStep`.

```text
Incoming (Webhook: POST /webhook/greet) → Has a name? (If body.name is not empty)
                                            ├─ true  → Greet (Respond 200 JSON) → Note it (Log)
                                            └─ false → Complain (Respond 400 text)
```

1. Turn on **Active** in the top bar (this saves the flow).
2. Call it:

   ```bash
   curl -X POST http://localhost:8090/webhook/greet -H 'Content-Type: application/json' -d '{"name":"Ada"}'
   # {"greeting":"Hello, Ada!"}

   curl -X POST http://localhost:8090/webhook/greet -H 'Content-Type: application/json' -d '{}'
   # Send JSON with a "name" field.   (HTTP 400)
   ```

- **Greet**'s body is `{ "greeting": "Hello, {{body.name}}!" }`. That resolves to text, which is then parsed as JSON because the content type is JSON.
- **Note it** runs after **Greet**. The reply is still Greet's, because the response is sent when the whole flow finishes.
- With the editor open, each call shows up live on the canvas and in the **Executions** tab.
- Press **▶ Run** to try it without curl. The trigger then uses its test body, `{ "name": "Ada" }`.

To serve this flow from your own app, see [A Webhook Flow in Your Own Express App](webhook-in-express.md).
