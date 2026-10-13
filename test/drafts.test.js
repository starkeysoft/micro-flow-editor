// Autosave (write-behind cache + background flush worker) and snapshots.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';
import { startServer } from '../lib/index.js';
import { client } from './auth-helpers.js';

let editor;
let api;

before(async () => {
  editor = await startServer({ port: 0, database_url: 'sqlite::memory:', flush_interval_ms: 300, max_snapshots_per_flow: 3 });
  api = client(`http://127.0.0.1:${editor.server.address().port}`);
});
after(() => editor.close());

const { Flow, Snapshot } = await import('../server/db.js');

const graphWith = (name, extra = {}) => ({
  nodes: [{ id: 't', type: 'manual', name, x: 0, y: 0, config: {}, settings: {}, ...extra }],
  edges: [],
});
const draftOf = (graph, name = 'flow') => ({ name, description: '', graph, options: { exit_on_error: true } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await sleep(50);
  }
  return false;
}

test('drafts go to the cache, and the worker updates the same row', async () => {
  const { data: flow } = await api.post('/api/flows', { name: 'autosave' });
  const rows_before = await Flow.count();

  for (const name of ['one', 'two', 'three']) {
    const r = await api.post(`/api/flows/${flow.id}/draft`, draftOf(graphWith(name), 'autosave'));
    assert.equal(r.status, 200);
    assert.equal(r.data.cache, 'memory');
  }
  // Nothing reads the flow: only the background worker can write it.
  const written = await waitFor(async () => (await Flow.findByPk(flow.id)).graph.nodes[0].name === 'three');
  assert.ok(written, 'the worker wrote the latest draft');
  assert.equal(await Flow.count(), rows_before, 'an update, not a new row');
});

test('reads flush first, so they see the latest edit', async () => {
  const { data: flow } = await api.post('/api/flows', { name: 'read-through' });
  await api.post(`/api/flows/${flow.id}/draft`, draftOf(graphWith('fresh'), 'renamed'));
  const r = await api.get(`/api/flows/${flow.id}`);
  assert.equal(r.data.graph.nodes[0].name, 'fresh');
  assert.equal(r.data.name, 'renamed');
  assert.equal(r.data.snapshot.latest, null);
  assert.equal(r.data.snapshot.changed_since, true);
  assert.equal((await api.post('/api/flows/00000000-0000-0000-0000-000000000000/draft', draftOf(graphWith('x')))).status, 404);
});

test('a flow deleted behind the API\'s back refuses drafts', async () => {
  const { data: flow } = await api.post('/api/flows', { name: 'vanishing' });
  assert.equal((await api.post(`/api/flows/${flow.id}/draft`, draftOf(graphWith('a')))).status, 200);
  await Flow.destroy({ where: { id: flow.id } }); // e.g. another instance or a reset database
  assert.equal((await api.post(`/api/flows/${flow.id}/draft`, draftOf(graphWith('b')))).status, 404);
});

test('active webhooks run the latest snapshot, not the draft', async () => {
  const hook = (p) => graphWith('In', { type: 'webhook', config: { path: p, method: 'POST', sample: '{}' } });
  const { data: flow } = await api.post('/api/flows', { name: 'live', graph: hook('v1') });

  // Turning it on snapshots the unsaved state.
  let r = await (await fetch(`${api_base()}/api/flows/${flow.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"active":true}' })).json();
  assert.equal(r.active, true);
  assert.equal(r.snapshot.latest.label, 'Activated');
  assert.equal((await fetch(`${api_base()}/webhook/v1`, { method: 'POST' })).status, 200);

  // An autosaved edit doesn't go live...
  await api.post(`/api/flows/${flow.id}/draft`, draftOf(hook('v2'), 'live'));
  r = await api.get(`/api/flows/${flow.id}`);
  assert.equal(r.data.snapshot.changed_since, true);
  assert.equal((await fetch(`${api_base()}/webhook/v1`, { method: 'POST' })).status, 200, 'still the snapshot');
  assert.equal((await fetch(`${api_base()}/webhook/v2`, { method: 'POST' })).status, 404);

  // ...until it's saved as a snapshot.
  r = await api.post(`/api/flows/${flow.id}/snapshots`, { label: 'v2 please' });
  assert.equal(r.status, 201);
  assert.equal(r.data.live, true);
  assert.equal((await fetch(`${api_base()}/webhook/v2`, { method: 'POST' })).status, 200);
  assert.equal((await fetch(`${api_base()}/webhook/v1`, { method: 'POST' })).status, 404);

  // Deleting the latest snapshot falls back to the one before.
  await api.del(`/api/snapshots/${r.data.id}`);
  assert.equal((await fetch(`${api_base()}/webhook/v1`, { method: 'POST' })).status, 200);
});

test('renames count as changes; the live snapshot of an active flow is kept', async () => {
  const { data: flow } = await api.post('/api/flows', { name: 'naming' });
  await api.post(`/api/flows/${flow.id}/snapshots`, {});
  let r = await api.get(`/api/flows/${flow.id}`);
  assert.equal(r.data.snapshot.changed_since, false);
  await api.post(`/api/flows/${flow.id}/draft`, { ...draftOf(r.data.graph, 'renamed'), options: r.data.options });
  r = await api.get(`/api/flows/${flow.id}`);
  assert.equal(r.data.snapshot.changed_since, true, 'a rename is a change');

  const put = (body) => fetch(`${api_base()}/api/flows/${flow.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((res) => res.json());
  r = await put({ active: true });
  const { data: snaps } = await api.get(`/api/flows/${flow.id}/snapshots`);
  assert.equal(snaps.length, 2, 'activating snapshotted the rename');
  await api.del(`/api/snapshots/${snaps[1].id}`);
  const only = await api.del(`/api/snapshots/${snaps[0].id}`);
  assert.equal(only.status, 409, 'the only snapshot of an active flow stays');

  r = await put({ options: { exit_on_error: false } });
  assert.equal(r.snapshot.latest.label, 'Saved through the API', 'options sent through PUT are saved as a snapshot');
  assert.equal(r.snapshot.changed_since, false);
  await put({ active: false });
});

test('snapshots: list, read, export, prune', async () => {
  const { data: flow } = await api.post('/api/flows', { name: 'history' });
  for (let i = 1; i <= 5; i++) {
    await api.post(`/api/flows/${flow.id}/draft`, draftOf(graphWith(`v${i}`), 'history'));
    await api.post(`/api/flows/${flow.id}/snapshots`, { label: `save ${i}` });
  }
  const { data: list } = await api.get(`/api/flows/${flow.id}/snapshots`);
  assert.deepEqual(list.map((s) => s.label), ['save 5', 'save 4', 'save 3'], 'kept the newest MAX_SNAPSHOTS_PER_FLOW');
  assert.deepEqual(list.map((s) => s.live), [true, false, false]);
  const { data: one } = await api.get(`/api/snapshots/${list[2].id}`);
  assert.equal(one.graph.nodes[0].name, 'v3');
  const exported = await api.get(`/api/snapshots/${list[0].id}/export`);
  assert.equal(exported.data.format, 'micro-flow-editor');
  assert.equal(exported.data.graph.nodes[0].name, 'v5');

  await api.del(`/api/flows/${flow.id}`);
  assert.equal(await Snapshot.count({ where: { flow_id: flow.id } }), 0, 'deleted with the flow');
});

let base_url;
function api_base() {
  base_url ??= `http://127.0.0.1:${editor.server.address().port}`;
  return base_url;
}

test('shutting down writes pending drafts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfe-drafts-'));
  const db = path.join(dir, 'flows.sqlite');
  const child = spawn(process.execPath, ['bin/micro-flow-editor.js', '--port', '0', '--sqlite', db], {
    env: { ...process.env, DATABASE_URL: '', FLUSH_INTERVAL_MS: '600000' },
  });
  const base = await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      const m = String(chunk).match(/http:\/\/localhost:(\d+)/);
      if (m) resolve(`http://127.0.0.1:${m[1]}`);
    });
    child.on('exit', () => reject(new Error('server exited')));
  });
  const flow = await (await fetch(`${base}/api/flows`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"bye"}' })).json();
  await fetch(`${base}/api/flows/${flow.id}/draft`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draftOf(graphWith('kept'), 'bye')) });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  child.kill('SIGTERM');
  await exited;

  const conn = new sqlite3.Database(db);
  const row = await new Promise((resolve, reject) => conn.get('SELECT graph FROM flows WHERE id = ?', [flow.id], (e, r) => (e ? reject(e) : resolve(r))));
  conn.close();
  assert.equal(JSON.parse(row.graph).nodes[0].name, 'kept');
  fs.rmSync(dir, { recursive: true, force: true });
});
