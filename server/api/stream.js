// Server-Sent Events: GET /api/flows/:id/stream forwards every update the
// runner publishes for that flow (manual, webhook and scheduled runs alike).
import express from 'express';
import { bus } from '../engine/runner.js';

export const router = express.Router();

router.get('/flows/:id/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');

  const channel = `flow:${req.params.id}`;
  const send = (message) => res.write(`data: ${JSON.stringify(message)}\n\n`);
  bus.on(channel, send);
  send({ type: 'hello' });

  // Comments keep proxies from closing an idle stream.
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    bus.off(channel, send);
  });
});
