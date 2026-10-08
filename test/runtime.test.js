// The standalone runtime: exported flows run without a server or database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Workflow } from '@ronaldroe/micro-flow';
import { compileFlow, runFlow, TEMPLATES, GraphError } from '../runtime/index.js';

const exported = {
  format: 'micro-flow-editor',
  version: 1,
  name: 'runtime test',
  options: { exit_on_error: true },
  graph: {
    nodes: [
      { id: 't', type: 'webhook', name: 'In', x: 0, y: 0, config: { path: 'x', method: 'POST', sample: '{}' } },
      { id: 'l', type: 'loop', name: 'Each', x: 0, y: 0, config: { path: 'body.items' } },
      { id: 's', type: 'set', name: 'Double', x: 0, y: 0, config: { mode: 'replace', assignments: 'n = {{$item}}\ntag = {{$trigger.body.tag}}' } },
      { id: 'r', type: 'respond', name: 'Reply', x: 0, y: 0, config: { status: 202, body: '{{$}}', content_type: 'application/json' } },
    ],
    edges: [
      { id: 'a', from: 't', port: 'main', to: 'l' },
      { id: 'b', from: 'l', port: 'each', to: 's' },
      { id: 'c', from: 'l', port: 'done', to: 'r' },
    ],
  },
};

test('runFlow runs an export with a trigger payload', async () => {
  const seen = [];
  const result = await runFlow(exported, {
    trigger_payload: { method: 'POST', path: 'x', query: {}, headers: {}, body: { items: [1, 2], tag: 'hi' } },
    onNodeRun: (node, entry) => seen.push(`${node.name}:${entry.status}`),
  });
  assert.equal(result.status, 'success', result.error);
  assert.deepEqual(result.response, { status: 202, content_type: 'application/json', body: [{ n: 1, tag: 'hi' }, { n: 2, tag: 'hi' }] });
  assert.ok(seen.includes('Double:success'));
});

test('compileFlow returns a real micro-flow Workflow', async () => {
  const compiled = compileFlow(exported.graph);
  assert.ok(compiled.workflow instanceof Workflow);
  assert.equal(compiled.tree.steps[0].name, 'In');
});

test('templates compile', () => {
  for (const t of TEMPLATES) assert.ok(compileFlow(t).workflow, t.key);
});

test('broken graphs throw GraphError', () => {
  assert.throws(() => compileFlow({ nodes: [], edges: [] }), GraphError);
});

test('Repeat resolves a templated count at run time', async () => {
  const result = await runFlow({
    nodes: [
      { id: 't', type: 'manual', name: 'Start', x: 0, y: 0, config: { json: '{"n": 3}' } },
      { id: 'r', type: 'repeat', name: 'Times', x: 0, y: 0, config: { times: '{{n}}' } },
      { id: 'x', type: 'transform', name: 'Index', x: 0, y: 0, config: { op: 'get', path: 'index' } },
    ],
    edges: [{ id: 'a', from: 't', port: 'main', to: 'r' }, { id: 'b', from: 'r', port: 'each', to: 'x' }],
  });
  assert.equal(result.status, 'success', result.error);
  assert.deepEqual(result.output, [0, 1, 2]);
});

const n = (id, type, config = {}, settings = {}) => ({ id, type, name: id, x: 0, y: 0, config, settings });
const e = (from, port, to) => ({ id: `${from}.${port}>${to}`, from, port, to });

test('Skip Next If before a loop skips the whole loop', async () => {
  const result = await runFlow({
    nodes: [
      n('start', 'manual', { json: '{"value":0,"items":[1,2]}' }),
      n('skip', 'skip', { path: 'value', op: '===', value: '0' }),
      n('loop', 'loop', { path: 'items' }),
      n('each', 'set', { assignments: 'seen = yes' }),
      n('after', 'set', { assignments: 'after = yes' }),
    ],
    edges: [e('start', 'main', 'skip'), e('skip', 'main', 'loop'), e('loop', 'each', 'each'), e('loop', 'done', 'after')],
  });
  assert.equal(result.status, 'success', result.error);
  assert.equal(result.node_runs.each, undefined, 'the loop body never ran');
  assert.equal(result.node_runs.loop.at(-1).status, 'skipped');
  assert.deepEqual(result.output, { value: 0, items: [1, 2], after: 'yes' }, 'the loop\'s input passes on to done');
});

test('a loop pass that succeeds on retry is kept', async () => {
  const random = Math.random;
  let calls = 0;
  Math.random = () => (calls++ % 2 === 0 ? 0 : 0.99); // fail, then pass
  try {
    const result = await runFlow({
      nodes: [
        n('start', 'manual'),
        n('rep', 'repeat', { times: 4 }),
        n('flaky', 'chaos', { fail_pct: 50, latency_ms: 0 }, { retries: 1 }),
      ],
      edges: [e('start', 'main', 'rep'), e('rep', 'each', 'flaky')],
    });
    assert.equal(result.status, 'success', result.error);
    assert.equal(result.output.length, 4);
  } finally {
    Math.random = random;
  }
});

test('control nodes are recorded, including a Switch default', async () => {
  const result = await runFlow({
    nodes: [
      n('start', 'manual', { json: '{"t":"zzz","v":5}' }),
      n('sw', 'switch', { path: 't', cases: [{ op: '===', value: 'a' }] }),
      n('big', 'if', { path: 'v', op: '>', value: '3' }),
      n('pause', 'wait', { ms: 1 }),
    ],
    edges: [e('start', 'main', 'sw'), e('sw', 'default', 'big'), e('big', 'true', 'pause')],
  });
  assert.equal(result.status, 'success', result.error);
  assert.equal(result.node_runs.sw.at(-1).branch, 'default');
  assert.equal(result.node_runs.big.at(-1).branch, 'true');
  assert.equal(result.node_runs.pause.at(-1).status, 'success');
});

test('trigger_payload replaces a Manual trigger\'s JSON', async () => {
  const result = await runFlow(
    { nodes: [n('start', 'manual', { json: '{"from":"node"}' })], edges: [] },
    { trigger_payload: { from: 'caller' } },
  );
  assert.deepEqual(result.output, { from: 'caller' });
});
