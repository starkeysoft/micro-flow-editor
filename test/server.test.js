// startServer(): the programmatic server API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../lib/index.js';

test('startServer picks a free port with port 0, serves the API and closes', async () => {
  const editor = await startServer({ port: 0, database_url: 'sqlite::memory:' });
  const { port } = editor.server.address();
  assert.notEqual(port, 8090);
  const base = `http://127.0.0.1:${port}`;

  const created = await (await fetch(`${base}/api/flows`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"t"}' })).json();
  assert.equal(created.name, 't');
  assert.equal(created.last_execution, null);

  const { execution_id } = await (await fetch(`${base}/api/flows/${created.id}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
  await new Promise((r) => setTimeout(r, 300));
  const flow = await (await fetch(`${base}/api/flows/${created.id}`)).json();
  assert.equal(flow.last_execution.id, execution_id);

  await editor.close();
  await assert.rejects(startServer(), /closed/);
});
