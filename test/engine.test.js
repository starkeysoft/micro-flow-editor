// Runs graphs through the real compiler and runner against in-memory SQLite.
process.env.DATABASE_URL = 'sqlite::memory:';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { initDatabase, sequelize, Flow, Execution } = await import('../server/db.js');
const { runFlow, preview } = await import('../server/engine/runner.js');
const { cleanGraph } = await import('../server/api/flows.js');

const node = (id, type, config = {}, settings = {}) => ({ id, type, name: id, x: 0, y: 0, config, settings });
const edge = (from, port, to) => ({ id: `${from}.${port}>${to}`, from, port, to });

async function run(nodes, edges, options = { exit_on_error: true }) {
  const graph = cleanGraph({ nodes, edges });
  const flow = await Flow.create({ name: 'test', graph, options });
  const { execution_id, done } = await runFlow({ flow });
  const result = await done;
  const execution = await Execution.findByPk(execution_id);
  return { result, execution };
}

const last = (execution, id) => execution.node_runs[id]?.at(-1);

before(async () => { await initDatabase(); });
after(async () => { await sequelize.close(); });

test('loop, if, switch, filter and output', async () => {
  const { result, execution } = await run([
    node('start', 'manual', { json: '{"items":[{"n":1,"t":"a"},{"n":7,"t":"b"},{"n":12,"t":"c"}]}' }),
    node('each', 'loop', { path: 'items' }),
    node('drop small', 'stop', { path: 'n', op: '<', value: '2' }),
    node('big?', 'if', { path: 'n', op: '>', value: '10' }),
    node('mark big', 'set', { assignments: 'size = big' }),
    node('mark small', 'set', { assignments: 'size = small\nitem_t = {{$item.t}}' }),
    node('by type', 'switch', { path: 't', cases: [{ op: '===', value: 'b' }] }),
    node('card', 'output', { title: '{{t}}' }),
    node('count', 'transform', { op: 'length' }),
  ], [
    edge('start', 'main', 'each'), edge('each', 'each', 'drop small'), edge('drop small', 'main', 'big?'),
    edge('big?', 'true', 'mark big'), edge('big?', 'false', 'mark small'), edge('mark small', 'main', 'by type'),
    edge('by type', 'case-0', 'card'), edge('each', 'done', 'count'),
  ]);
  assert.equal(result.status, 'success', result.error);
  assert.equal(last(execution, 'count').output, 2, 'the filter drops n=1');
  assert.deepEqual(last(execution, 'mark small').output, { n: 7, t: 'b', size: 'small', item_t: 'b' });
  assert.equal(last(execution, 'big?').branch, 'true');
  assert.equal(execution.outputs.length, 1);
  assert.equal(execution.outputs[0].title, 'b');
});

test('repeat, wait and skip', async () => {
  const { result, execution } = await run([
    node('start', 'manual', { json: '{"count":0}' }),
    node('three', 'repeat', { times: 3 }),
    node('skip first', 'skip', { path: 'index', op: '===', value: '0' }),
    node('skipped', 'set', { assignments: 'touched = yes' }),
    node('pause', 'wait', { ms: 20 }),
  ], [
    edge('start', 'main', 'three'), edge('three', 'each', 'skip first'), edge('skip first', 'main', 'skipped'),
    edge('skipped', 'main', 'pause'),
  ]);
  assert.equal(result.status, 'success', result.error);
  const three = last(execution, 'three').output;
  assert.equal(three.length, 3);
  assert.equal(three[0].touched, undefined, 'index 0 skipped the set node');
  assert.equal(three[1].touched, 'yes');
  assert.ok(execution.node_runs.skipped.some((r) => r.status === 'skipped'));
});

test('while loop reads the previous pass', async () => {
  const { result, execution } = await run([
    node('start', 'manual', { json: '{"count":0}' }),
    node('w', 'while', { path: 'count', op: '<', value: '4' }),
    node('plus one', 'transform', { op: 'add', path: 'count', n: 1, into: 'count' }),
  ], [edge('start', 'main', 'w'), edge('w', 'each', 'plus one')]);
  assert.equal(result.status, 'success', result.error);
  assert.deepEqual(last(execution, 'w').output.map((o) => o.count), [1, 2, 3, 4]);
});

test('retries and errors', async () => {
  const { result, execution } = await run([
    node('start', 'manual'),
    node('boom', 'chaos', { fail_pct: 100, latency_ms: 0 }, { retries: 2 }),
    node('after', 'set', {}),
  ], [edge('start', 'main', 'boom'), edge('boom', 'main', 'after')]);
  assert.equal(result.status, 'error');
  assert.match(result.error, /chaos/);
  assert.equal(execution.node_runs.boom.length, 3);
  assert.equal(execution.node_runs.after, undefined);
});

test('exit_on_error off marks later nodes skipped', async () => {
  const { result, execution } = await run([
    node('start', 'manual'),
    node('boom', 'chaos', { fail_pct: 100, latency_ms: 0 }),
    node('after', 'set', {}),
  ], [edge('start', 'main', 'boom'), edge('boom', 'main', 'after')], { exit_on_error: false });
  assert.equal(result.status, 'success');
  assert.equal(last(execution, 'after').status, 'skipped');
});

test('respond node and preview', async () => {
  const nodes = [node('start', 'manual', { json: '{"x":2}' }), node('reply', 'respond', { status: 201, body: '{{x}}' })];
  const edges = [edge('start', 'main', 'reply')];
  const { result } = await run(nodes, edges);
  assert.deepEqual(result.response, { status: 201, content_type: 'application/json', body: 2 });
  const flow = await Flow.create({ name: 'p', graph: cleanGraph({ nodes, edges }) });
  const { tree } = preview(flow, flow.graph);
  assert.equal(tree.steps.length, 2);
});

test('cycles are rejected', async () => {
  const graph = cleanGraph({
    nodes: [node('start', 'manual'), node('a', 'set'), node('b', 'set')],
    edges: [edge('start', 'main', 'a'), edge('a', 'main', 'b'), edge('b', 'main', 'a')],
  });
  const flow = await Flow.create({ name: 'c', graph });
  await assert.rejects(runFlow({ flow }), /cycle/);
});
