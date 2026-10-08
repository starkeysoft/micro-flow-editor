// Runs flows on the server and records what happened.
//
// runFlow() compiles a graph (compile.js), executes the root micro-flow
// Workflow, and saves an Execution row when it ends. While it runs, every
// update is published on `bus` under `flow:<flow id>`, which the editor's
// SSE stream (api/stream.js) forwards to the browser.
//
// Control nodes, retries and skips are recorded from micro-flow's events by
// observe.js.
//
// Each run's ctx (shared by node actions and compiled steps) comes from
// context.js.
import { EventEmitter } from 'events';
import { Workflow, State } from '@ronaldroe/micro-flow';
import { config } from '../config.js';
import { Execution } from '../db.js';
import { compileGraph, describeTree } from './compile.js';
import { createContext, stopContext, executeRoot } from './context.js';
import { observe } from './observe.js';

// micro-flow logs every event to the console unless this is set. The
// deprecated State singleton's flag is still the only switch.
State.set('log_suppress', true);

export const bus = new EventEmitter();
bus.setMaxListeners(0);

const runs = new Map(); // execution id → run
let starting = 0;       // runs past the limit check but not yet in `runs`

const MAX_LOG = 2000;
const MAX_RUNS_PER_NODE = 50;
const MAX_DATA_CHARS = 64 * 1024;
const MAX_OUTPUTS = 200;

export class BusyError extends Error {}

// Large values are cut down before they are stored or streamed.
export function clip(value) {
  if (value === undefined) return undefined;
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    return { _unserializable: String(value) };
  }
  if (text === undefined) return null;
  if (text.length <= MAX_DATA_CHARS) return JSON.parse(text);
  return { _truncated: true, size: text.length, preview: text.slice(0, 2000) };
}

function publish(run, message) {
  bus.emit(`flow:${run.flow_id}`, { execution_id: run.id, ...message });
}

function addLog(run, entry) {
  const full = { at: new Date().toISOString(), level: 'info', ...entry };
  if (run.log.length < MAX_LOG) run.log.push(full);
  else if (run.log.length === MAX_LOG) run.log.push({ at: full.at, level: 'warn', text: `log capped at ${MAX_LOG} entries` });
  publish(run, { type: 'log', entry: full });
}

const nodeName = (run, node_id) => run.nodes.get(node_id)?.name ?? node_id;


export const activeRuns = () => [...runs.values()].map((run) => ({ id: run.id, flow_id: run.flow_id, mode: run.mode }));

// options: { flow, graph?, mode, trigger_id?, trigger_payload? }
// Returns { execution_id, done } where done resolves to the finished run.
export async function runFlow({ flow, graph = flow.graph, mode = 'manual', trigger_id = null, trigger_payload = null, options = flow.options }) {
  if (runs.size + starting >= config.max_concurrent_runs) {
    throw new BusyError(`The server is already running ${runs.size + starting} flows. Try again in a moment.`);
  }
  // Hold a slot while compiling and creating the row, so simultaneous
  // requests can't all slip past the limit.
  starting++;
  try {
    return await startRun({ flow, graph, mode, trigger_id, trigger_payload, options });
  } finally {
    starting--;
  }
}

async function startRun({ flow, graph, mode, trigger_id, trigger_payload, options }) {

  const run = {
    id: null,
    flow_id: flow.id,
    mode,
    nodes: new Map(graph.nodes.map((n) => [n.id, n])),
    node_runs: {},
    log: [],
    outputs: [],
    started_at: new Date(),
  };

  run.ctx = createContext({
    trigger_payload,
    block_private_networks: config.block_private_networks,
    record(node_id, entry) {
      const list = (run.node_runs[node_id] ??= []);
      const full = { at: new Date().toISOString(), ...entry, input: clip(entry.input), output: clip(entry.output) };
      // Past the cap, the newest entry replaces the last one.
      if (list.length < MAX_RUNS_PER_NODE) list.push(full);
      else list[list.length - 1] = full;
      publish(run, { type: 'node_run', node_id, entry: full, count: list.length });
      const name = nodeName(run, node_id);
      if (entry.status === 'error') addLog(run, { event: 'step_failed', node_id, level: 'error', text: `${name}: ${entry.error}` });
      else if (entry.status === 'retrying') addLog(run, { event: 'step_failed', node_id, level: 'warn', text: `${name}: ${entry.error} (will retry)` });
      else if (entry.status === 'skipped') addLog(run, { event: 'workflow_step_skipped', node_id, text: `${name}: ${entry.note}` });
      else addLog(run, { event: 'step_complete', node_id, text: `${name}${entry.branch ? ` → ${entry.branch}` : ''}${entry.ms != null ? ` (${entry.ms} ms)` : ''}` });
    },
    output(card) {
      if (run.outputs.length >= MAX_OUTPUTS) return;
      const full = { ...card, at: new Date().toISOString() };
      run.outputs.push(full);
      publish(run, { type: 'output', card: full });
    },
    log(text, level = 'info') {
      addLog(run, { event: 'log', level, text });
    },
  });

  // Compile before creating the row, so a broken graph is just an error reply.
  run.compiled = compileGraph({ ...graph, name: flow.name }, run.ctx, {
    trigger_id,
    exit_on_error: options?.exit_on_error !== false,
    max_loop_iterations: config.max_loop_iterations,
  });

  const row = await Execution.create({
    flow_id: flow.id,
    mode,
    status: 'running',
    started_at: run.started_at,
    graph,
  });
  run.id = row.id;
  run.ctx.execution = { id: row.id, mode };
  runs.set(run.id, run);
  run.unobserve = observe(run.compiled, run.ctx, {
    running: (node_id) => publish(run, { type: 'node_running', node_id }),
    done: (node_id) => publish(run, { type: 'node_done', node_id }),
    log: (entry) => addLog(run, entry),
    nameOf: (node_id) => nodeName(run, node_id),
  });

  publish(run, {
    type: 'execution_started',
    execution: { id: row.id, flow_id: flow.id, mode, status: 'running', started_at: run.started_at },
    trigger_id: run.compiled.trigger.id,
  });
  addLog(run, { event: 'workflow_running', text: `Run started (${mode}) from "${run.compiled.trigger.name}"` });

  const done = execute(run, row);
  return { execution_id: row.id, done };
}

async function execute(run, row) {
  const { status, error } = await executeRoot(run.compiled.root, run.ctx);
  addLog(run, {
    event: status === 'success' ? 'workflow_complete' : 'workflow_failed',
    level: status === 'success' ? 'info' : status === 'stopped' ? 'warn' : 'error',
    text: status === 'success' ? 'Run finished' : `Run ${status}: ${error}`,
  });

  const finished_at = new Date();
  try {
    await row.update({
      status,
      error,
      finished_at,
      node_runs: run.node_runs,
      log: run.log,
      outputs: run.outputs,
    });
  } catch (e) {
    console.error(`Could not save execution ${run.id}:`, e.message);
  }

  run.unobserve();
  runs.delete(run.id);

  publish(run, {
    type: 'execution_finished',
    execution: { id: run.id, flow_id: run.flow_id, mode: run.mode, status, error, started_at: run.started_at, finished_at },
  });

  pruneExecutions(run.flow_id).catch((e) => console.error('Could not prune executions:', e.message));

  return { id: run.id, status, error, response: run.ctx.response, last: run.ctx.last };
}

async function pruneExecutions(flow_id) {
  const old = await Execution.findAll({
    where: { flow_id },
    order: [['started_at', 'DESC']],
    offset: config.max_executions_per_flow,
    attributes: ['id'],
  });
  if (old.length) await Execution.destroy({ where: { id: old.map((e) => e.id) } });
}

export function stopRun(execution_id) {
  const run = runs.get(execution_id);
  if (!run) return false;
  stopContext(run.ctx);
  addLog(run, { event: 'workflow_cancelled', level: 'warn', text: 'Stop requested' });
  return true;
}

export function stopFlowRuns(flow_id) {
  for (const run of runs.values()) if (run.flow_id === flow_id) stopRun(run.id);
}

// Executions left "running" by a crash or restart can never finish.
export async function markInterrupted() {
  await Execution.update(
    { status: 'error', error: 'interrupted: the server restarted during this run', finished_at: new Date() },
    { where: { status: 'running' } },
  );
}

// For the editor's "micro-flow" tab: compile without running.
export function preview(flow, graph, trigger_id = null) {
  const compiled = compileGraph({ ...graph, name: flow.name }, createContext(), {
    trigger_id,
    exit_on_error: flow.options?.exit_on_error !== false,
    max_loop_iterations: config.max_loop_iterations,
  });
  return {
    tree: describeTree(compiled),
    serialized: compiled.root.prepareForSerialization(),
  };
}

