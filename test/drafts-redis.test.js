// The Redis autosave store. Needs a Redis server: TEST_REDIS_URL=redis://… npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

const url = process.env.TEST_REDIS_URL;

test('drafts go through Redis and the worker writes them', { skip: !url && 'set TEST_REDIS_URL to run' }, async () => {
  const { startServer } = await import('../lib/index.js');
  const editor = await startServer({ port: 0, database_url: 'sqlite::memory:', redis_url: url, flush_interval_ms: 300 });
  const base = `http://127.0.0.1:${editor.server.address().port}`;
  const { Flow } = await import('../server/db.js');
  const { createClient } = await import('redis');
  const redis = createClient({ url });
  await redis.connect();
  try {
    const flow = await (await fetch(`${base}/api/flows`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"r"}' })).json();
    const graph = { nodes: [{ id: 't', type: 'manual', name: 'via redis', x: 0, y: 0, config: {}, settings: {} }], edges: [] };
    const saved = await (await fetch(`${base}/api/flows/${flow.id}/draft`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'r', graph }),
    })).json();
    assert.equal(saved.cache, 'redis');
    assert.ok(await redis.sIsMember('micro-flow-editor:dirty', flow.id), 'marked dirty in Redis');

    const end = Date.now() + 3000;
    while (Date.now() < end && (await Flow.findByPk(flow.id)).graph.nodes[0].name !== 'via redis') await new Promise((r) => setTimeout(r, 50));
    assert.equal((await Flow.findByPk(flow.id)).graph.nodes[0].name, 'via redis');
    assert.equal(Number(await redis.sIsMember('micro-flow-editor:dirty', flow.id)), 0, 'settled after the write');
    assert.equal(await redis.exists(`micro-flow-editor:draft:${flow.id}`), 0);
  } finally {
    await redis.quit();
    await editor.close();
  }
});
