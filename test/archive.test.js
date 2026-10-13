// Archiving: the flow leaves the flows table with only its latest snapshot
// kept; unarchiving recreates it from that snapshot.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../lib/index.js';
import { client } from './auth-helpers.js';

let editor;
let api;
let base;

before(async () => {
  editor = await startServer({ port: 0, database_url: 'sqlite::memory:' });
  base = `http://127.0.0.1:${editor.server.address().port}`;
  api = client(base);
});
after(() => editor.close());

const { Flow, Snapshot, Execution, ArchivedFlow } = await import('../server/db.js');

const graphOf = (name, type = 'manual', config = {}) => ({
  nodes: [{ id: 't', type, name, x: 0, y: 0, config, settings: {} }],
  edges: [],
});
const draft = (graph, name) => ({ name, description: 'about it', graph, options: { exit_on_error: true } });
const put = (id, body) => fetch(`${base}/api/flows/${id}`, {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json());

test('archiving keeps only the latest snapshot and removes the flow', async () => {
  const { data: flow } = await api.post('/api/flows', { name: 'old flow' });
  for (const v of ['v1', 'v2', 'v3']) {
    await api.post(`/api/flows/${flow.id}/draft`, draft(graphOf(v), 'old flow'));
    await api.post(`/api/flows/${flow.id}/snapshots`, { label: v });
  }
  const { data: snaps } = await api.get(`/api/flows/${flow.id}/snapshots`);
  await api.post(`/api/flows/${flow.id}/run`, {});
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(await Execution.count({ where: { flow_id: flow.id } }) > 0);

  const r = await api.post(`/api/flows/${flow.id}/archive`);
  assert.equal(r.status, 200);
  assert.equal(r.data.snapshot.id, snaps[0].id, 'the most recent snapshot is the one kept');
  assert.equal(r.data.snapshot.label, 'v3');

  assert.equal(await Flow.findByPk(flow.id), null, 'gone from the flows table');
  assert.equal(await Snapshot.count({ where: { flow_id: flow.id } }), 0);
  assert.equal(await Execution.count({ where: { flow_id: flow.id } }), 0);
  assert.equal((await api.get(`/api/flows/${flow.id}`)).status, 404);
  assert.ok(!(await api.get('/api/flows')).data.some((f) => f.id === flow.id), 'not in the flow list');

  const { data: list } = await api.get('/api/archive');
  assert.deepEqual(list.map((a) => a.name), ['old flow']);
  const { data: one } = await api.get(`/api/archive/${flow.id}`);
  assert.equal(one.graph.nodes[0].name, 'v3');
  assert.equal((await api.get(`/api/archive/${flow.id}/export`)).data.format, 'micro-flow-editor');
});

test('edits not in a snapshot are saved as one before archiving', async () => {
  const { data: flow } = await api.post('/api/flows', { name: 'busy' });
  await api.post(`/api/flows/${flow.id}/snapshots`, { label: 'early' });
  await api.post(`/api/flows/${flow.id}/draft`, draft(graphOf('latest edit'), 'busy'));
  const r = await api.post(`/api/flows/${flow.id}/archive`);
  assert.equal(r.data.snapshot.label, 'Archived');
  assert.equal((await ArchivedFlow.findByPk(flow.id)).graph.nodes[0].name, 'latest edit');
});

test('unarchive recreates the flow from the snapshot', async () => {
  const hook = graphOf('In', 'webhook', { path: 'archived-hook', method: 'POST', sample: '{}' });
  const { data: flow } = await api.post('/api/flows', { name: 'hooked', graph: hook });
  await put(flow.id, { active: true });
  assert.equal((await fetch(`${base}/webhook/archived-hook`, { method: 'POST' })).status, 200);
  const { data: archived } = await api.post(`/api/flows/${flow.id}/archive`);
  assert.equal((await fetch(`${base}/webhook/archived-hook`, { method: 'POST' })).status, 404, 'triggers stopped');

  const r = await api.post(`/api/archive/${flow.id}/unarchive`);
  assert.equal(r.status, 200);
  assert.equal(r.data.id, flow.id, 'same id, so old links work');
  assert.equal(r.data.name, 'hooked');
  assert.equal(r.data.active, false, 'comes back switched off');
  assert.equal(r.data.graph.nodes[0].config.path, 'archived-hook');
  assert.equal(r.data.snapshot.latest.id, archived.snapshot.id, 'the kept snapshot is its snapshot again');
  assert.equal(r.data.snapshot.changed_since, false);
  assert.equal(new Date(r.data.created_at).getTime(), new Date(flow.created_at).getTime(), 'original creation time');
  assert.equal(new Date(r.data.snapshot.latest.created_at).getTime(), new Date(archived.snapshot.created_at).getTime());
  assert.equal(await ArchivedFlow.findByPk(flow.id), null, 'no longer archived');
  assert.equal((await api.post(`/api/archive/${flow.id}/unarchive`)).status, 404);
});

test('archived flows can be deleted for good', async () => {
  const { data: flow } = await api.post('/api/flows', { name: 'bin it' });
  await api.post(`/api/flows/${flow.id}/archive`);
  assert.equal((await api.del(`/api/archive/${flow.id}`)).status, 204);
  assert.equal((await api.get(`/api/archive/${flow.id}`)).status, 404);
});
