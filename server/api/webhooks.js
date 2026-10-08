// /webhook/<path>: starts an active flow whose Webhook trigger matches the
// path and method, waits for it to finish, and replies with what a Respond
// node set (or the flow's last output).
import express from 'express';
import { Flow } from '../db.js';
import { runFlow, BusyError } from '../engine/runner.js';
import { findWebhook } from '../engine/triggers.js';
import { GraphError } from '../engine/compile.js';

export const router = express.Router();

router.all('/webhook/*path', async (req, res) => {
  const path = [].concat(req.params.path).join('/');
  const hook = findWebhook(req.method, path);
  if (!hook) return res.status(404).json({ error: `no active flow listens on ${req.method} /webhook/${path}` });

  const flow = await Flow.findByPk(hook.flow_id);
  if (!flow?.active) return res.status(404).json({ error: 'that flow is not active' });

  try {
    const { done } = await runFlow({
      flow,
      mode: 'webhook',
      trigger_id: hook.trigger_id,
      trigger_payload: {
        method: req.method,
        path,
        query: req.query,
        headers: req.headers,
        body: req.body ?? null,
      },
    });
    const result = await done;
    if (result.response) {
      const { status, content_type, body } = result.response;
      res.status(status).type(content_type);
      return content_type === 'application/json' ? res.json(body) : res.send(String(body ?? ''));
    }
    if (result.status !== 'success') {
      return res.status(500).json({ error: result.error, execution_id: result.id });
    }
    return res.json(result.last ?? null);
  } catch (error) {
    const status = error instanceof BusyError ? 429 : error instanceof GraphError ? 422 : 500;
    return res.status(status).json({ error: error.message });
  }
});
