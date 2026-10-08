# A Webhook Flow in Your Own Express App

Design an HTTP endpoint in the editor with a Webhook Trigger and Respond to Webhook nodes, then serve it from a route in your own Express app with the runtime. Your app doesn't need the editor's server or a database.

## Overview

You will learn:
- Building a webhook-style flow and testing it in the editor
- Passing an Express request to the flow as its trigger payload
- Sending the Respond node's reply, or the flow's last output
- Loading flows once at startup and running them per request
- Stopping slow runs

## Build the Flow

1. In the editor, create a flow from the **Webhook Echo API** template (see [Bundled Templates](templates.md#webhook-echo-api)).
2. Press **▶ Run** to test it with the trigger's test body. The flow doesn't need to be active, because your app will be the one calling it.
3. Choose **⋯ → Export JSON** and save it as `flows/greet.json` in your app.

## Complete Example

```javascript
// server.js
import express from 'express';
import fs from 'node:fs';
import { State } from '@ronaldroe/micro-flow';
import { compileFlow, validate } from '@ronaldroe/micro-flow-editor/runtime';

State.set('log_suppress', true);

// Load and check every flow once, at startup. validate() throws a GraphError
// for a broken export, so a bad file stops the app before it takes traffic.
const flows = {
  greet: JSON.parse(fs.readFileSync('./flows/greet.json', 'utf8')),
};
for (const [key, flow] of Object.entries(flows)) validate(flow.graph);

// Mirrors how the editor's own server answers /webhook/* calls.
function reply(res, result) {
  if (result.response) {
    const { status, content_type, body } = result.response;
    res.status(status).type(content_type);
    return content_type === 'application/json' ? res.json(body) : res.send(String(body ?? ''));
  }
  if (result.status !== 'success') return res.status(500).json({ error: result.error });
  return res.json(result.output ?? null);
}

function flowRoute(flow, { timeout_ms = 15_000 } = {}) {
  return async (req, res, next) => {
    try {
      // A fresh compile per request: a compiled flow runs once.
      const compiled = compileFlow(flow, {
        trigger_payload: {
          method: req.method,
          path: req.path.replace(/^\//, ''),
          query: req.query,
          headers: req.headers,
          body: req.body ?? null,
        },
        block_private_networks: true,
        onLog: (text, level) => console[level === 'error' ? 'error' : 'log'](`[${req.method} ${req.path}] ${text}`),
      });

      const timer = setTimeout(() => compiled.stop(), timeout_ms);
      const result = await compiled.run();
      clearTimeout(timer);

      if (result.status === 'stopped') return res.status(504).json({ error: 'the flow took too long' });
      return reply(res, result);
    } catch (error) {
      return next(error);
    }
  };
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.post('/api/greet', flowRoute(flows.greet));

app.listen(3000, () => console.log('http://localhost:3000'));
```

## Try It

```bash
curl -X POST http://localhost:3000/api/greet -H 'Content-Type: application/json' -d '{"name":"Ada"}'
# {"greeting":"Hello, Ada!"}

curl -i -X POST http://localhost:3000/api/greet -H 'Content-Type: application/json' -d '{}'
# HTTP/1.1 400 Bad Request
# Send JSON with a "name" field.
```

## Notes

- **The route is yours.** The Webhook Trigger's path and method are ignored by the runtime. The flow only sees the `trigger_payload` you pass, so `$trigger.body`, `$trigger.query` and `$trigger.headers` work as they do in the editor.
- **Compile per request.** `compileFlow()` results can run once, and each run has its own context, so concurrent requests don't share state. Compiling is cheap.
- **Respond is sent at the end.** As on the editor's server, the reply goes out after the whole flow has finished, so keep slow work (Wait nodes, long loops) out of request-handling flows, or use a timeout as above.
- **One micro-flow.** If your app imports `@ronaldroe/micro-flow` (here for `State`), make sure there's one copy: `npm ls @ronaldroe/micro-flow`. See [Runtime: One Copy of micro-flow](../runtime.md#one-copy-of-micro-flow).
- **SSRF.** If callers can influence URLs in HTTP Request nodes, keep `block_private_networks: true`.

## Related

- [Runtime](../runtime.md)
- [Triggers: Webhook Responses](../triggers.md#webhook-responses)
- [Running an Exported Flow in Node.js](run-exported-flow-node.md)
