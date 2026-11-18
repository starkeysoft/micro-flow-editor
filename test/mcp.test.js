// The MCP endpoint (/mcp), driven by the official MCP client over Streamable
// HTTP: tools, the flow_changed event, webhooks after set_flow_active, and
// API tokens once sign-in is on.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startServer } from '../lib/index.js';
import { client } from './auth-helpers.js';

delete process.env.AUTH_ENABLED;
let editor;
let base;

before(async () => {
  editor = await startServer({ port: 0, database_url: 'sqlite::memory:' });
  base = `http://127.0.0.1:${editor.server.address().port}`;
});
after(() => editor.close());

const { bus } = await import('../server/engine/runner.js');

async function connect(headers = {}) {
  const mcp = new Client({ name: 'test', version: '1.0.0' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }));
  return mcp;
}

// Calls a tool and parses its JSON text; tool errors throw.
async function call(mcp, name, args = {}) {
  const result = await mcp.callTool({ name, arguments: args });
  const text = result.content[0].text;
  if (result.isError) throw Object.assign(new Error(text), { tool_error: true });
  return JSON.parse(text);
}

const graph = {
  nodes: [
    { id: 't', type: 'manual', name: 'Start', x: 0, y: 0, config: { json: '{ "n": 2 }' } },
    { id: 's', type: 'set', name: 'Double', x: 260, y: 0, config: { assignments: 'twice = {{n}}{{n}}' } },
    { id: 'o', type: 'output', name: 'Card', x: 520, y: 0, config: { title: 'got {{twice}}' } },
  ],
  edges: [{ from: 't', port: 'main', to: 's' }, { from: 's', port: 'main', to: 'o' }],
};

test('lists tools and describes the node catalogue', async () => {
  const mcp = await connect();
  const { tools } = await mcp.listTools();
  const names = tools.map((t) => t.name);
  for (const name of ['get_node_types', 'list_flows', 'get_flow', 'check_flow', 'create_flow', 'update_flow', 'set_flow_active', 'run_flow', 'get_execution', 'list_executions', 'stop_execution', 'archive_flow', 'list_templates']) {
    assert.ok(names.includes(name), name);
  }
  assert.equal(tools.find((t) => t.name === 'archive_flow').annotations.destructiveHint, true);

  const types = await call(mcp, 'get_node_types');
  assert.match(types.guide, /\$node\["Name"\]/);
  const sw = types.node_types.find((t) => t.type === 'switch');
  assert.deepEqual(sw.outputs, { depends_on_config: true, with_defaults: ['case-0', 'case-1', 'default'] });
  const schedule = types.node_types.find((t) => t.type === 'schedule');
  assert.equal(schedule.has_input, false);
  assert.match(schedule.fields.find((f) => f.key === 'cron').only_when, /cron/);
  assert.ok(types.operators.some((o) => o.value === 'string_contains'));
  await mcp.close();
});

test('creates, checks, runs, updates and archives a flow', async () => {
  const mcp = await connect();
  const flow = await call(mcp, 'create_flow', { name: 'From MCP', graph });
  assert.equal(flow.active, false);
  assert.equal(flow.check.ok, true);
  assert.deepEqual(flow.check.warnings, []);
  assert.ok((await call(mcp, 'list_flows')).some((f) => f.id === flow.id));

  // check_flow: a broken graph reports the node, a sloppy one gets warnings.
  let checked = await call(mcp, 'check_flow', { graph: { nodes: [graph.nodes[1]], edges: [] } });
  assert.equal(checked.ok, false);
  assert.match(checked.error, /trigger/);
  checked = await call(mcp, 'check_flow', {
    graph: JSON.stringify({ ...graph, edges: [{ from: 't', port: 'yes', to: 's' }] }),
  });
  assert.equal(checked.ok, true);
  assert.ok(checked.warnings.some((w) => /port "yes"/.test(w)));
  assert.ok(checked.warnings.some((w) => /"Card".*never runs/.test(w)));
  await assert.rejects(call(mcp, 'check_flow', {}), /graph or a flow_id/);

  // run_flow waits and returns each node's output, cards and the log.
  let run = await call(mcp, 'run_flow', { flow_id: flow.id });
  assert.equal(run.status, 'success');
  assert.equal(run.nodes.find((n) => n.name === 'Double').output.twice, '22');
  assert.equal(run.outputs[0].title, 'got 22');
  assert.ok(run.log.some((line) => /Run finished/.test(line)));
  run = await call(mcp, 'run_flow', { flow_id: flow.id, input: { n: 5 } });
  assert.equal(run.outputs[0].title, 'got 55', 'input replaces the trigger output');

  const execution = await call(mcp, 'get_execution', { execution_id: run.id, all_runs_of: 's' });
  assert.equal(execution.status, 'success');
  assert.equal(execution.runs_of_node[0].input.n, 5);
  assert.equal((await call(mcp, 'list_executions', { flow_id: flow.id })).length, 2);

  // A long run comes back as "running" and can be stopped.
  const slow = await call(mcp, 'run_flow', {
    flow_id: flow.id,
    graph: { nodes: [graph.nodes[0], { id: 'w', type: 'wait', name: 'Wait', x: 260, y: 0, config: { ms: 5000 } }], edges: [{ from: 't', port: 'main', to: 'w' }] },
    wait_ms: 50,
  });
  assert.equal(slow.status, 'running');
  assert.deepEqual(await call(mcp, 'stop_execution', { execution_id: slow.execution_id }), { stopping: true });

  // update_flow saves a snapshot and tells open editors.
  const events = [];
  const listen = (m) => events.push(m);
  bus.on(`flow:${flow.id}`, listen);
  const updated = await call(mcp, 'update_flow', { flow_id: flow.id, name: 'Renamed', graph: { ...graph, nodes: graph.nodes.slice(0, 2), edges: graph.edges.slice(0, 1) } });
  bus.off(`flow:${flow.id}`, listen);
  assert.equal(updated.name, 'Renamed');
  assert.equal(updated.graph.nodes.length, 2);
  assert.equal(updated.snapshot.latest.label, 'Saved through MCP');
  assert.deepEqual(events.filter((e) => e.type === 'flow_changed'), [{ type: 'flow_changed', content: true, source: 'mcp' }]);

  const archived = await call(mcp, 'archive_flow', { flow_id: flow.id });
  assert.equal(archived.name, 'Renamed');
  await assert.rejects(call(mcp, 'get_flow', { flow_id: flow.id }), /not found/);
  await mcp.close();
});

test('templates, and webhooks once a flow is active', async () => {
  const mcp = await connect();
  const templates = await call(mcp, 'list_templates');
  assert.ok(templates.length > 0);
  const copy = await call(mcp, 'create_flow', { name: 'Copy', template: templates[0].key });
  assert.equal(copy.description, templates[0].description);
  assert.ok(copy.graph.nodes.length > 1);
  await assert.rejects(call(mcp, 'create_flow', { name: 'x', template: 'nope' }), /no template/);

  const hook = await call(mcp, 'create_flow', {
    name: 'Hook',
    graph: {
      nodes: [
        { id: 'h', type: 'webhook', name: 'Hook', x: 0, y: 0, config: { path: 'mcp-hook', method: 'POST' } },
        { id: 'r', type: 'respond', name: 'Reply', x: 260, y: 0, config: { body: '{{body}}' } },
      ],
      edges: [{ from: 'h', port: 'main', to: 'r' }],
    },
  });
  const on = await call(mcp, 'set_flow_active', { flow_id: hook.id, active: true });
  assert.equal(on.active, true);
  assert.equal(on.snapshot.latest.label, 'Activated');
  const res = await fetch(`${base}/webhook/mcp-hook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"ok":1}' });
  assert.deepEqual(await res.json(), { ok: 1 });
  assert.equal((await call(mcp, 'set_flow_active', { flow_id: hook.id, active: false })).active, false);
  await mcp.close();
});

test('refuses cross-site requests and GET', async () => {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', origin: 'http://evil.example' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(res.status, 403);
  assert.equal((await fetch(`${base}/mcp`)).status, 405);
});

test('with sign-in on, MCP needs an API token', async () => {
  const ada = client(base);
  assert.equal((await ada.post('/api/auth/enable', { username: 'ada', password: 'correct horse' })).status, 200);

  await assert.rejects(connect(), /401|sign in/i);

  let r = await ada.post('/api/auth/tokens', { name: '' });
  assert.equal(r.status, 400);
  r = await ada.post('/api/auth/tokens', { name: 'Claude Code' });
  assert.equal(r.status, 201);
  const { token, id } = r.data;
  assert.match(token, /^mfe_/);
  assert.equal(r.data.hint, token.slice(0, 10));

  const mcp = await connect({ authorization: `Bearer ${token}` });
  const flow = await call(mcp, 'create_flow', { name: 'Signed', graph });
  const run = await call(mcp, 'update_flow', { flow_id: flow.id, description: 'x', graph });
  assert.equal(run.snapshot.latest.created_by, 'ada');
  await mcp.close();

  // Tokens work for the REST API too, skip the Origin check (no cookies) and
  // can't make more tokens.
  const bearer = { authorization: `Bearer ${token}` };
  assert.equal((await fetch(`${base}/api/flows`, { headers: bearer })).status, 200);
  assert.equal((await fetch(`${base}/api/auth/tokens`, { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' }, body: '{"name":"more"}' })).status, 401);
  assert.equal((await fetch(`${base}/api/flows`, { headers: { authorization: 'Bearer mfe_wrong' } })).status, 401);

  const list = (await ada.get('/api/auth/tokens')).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].token, undefined, 'the token itself is never listed');
  assert.ok(list[0].last_used_at);

  assert.equal((await ada.del(`/api/auth/tokens/${id}`)).status, 204);
  assert.equal((await fetch(`${base}/api/flows`, { headers: bearer })).status, 401, 'revoked');
  assert.equal((await ada.del(`/api/auth/tokens/${id}`)).status, 404);
});
