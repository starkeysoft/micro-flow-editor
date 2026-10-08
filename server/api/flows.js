// REST API for flows and their executions, mounted at /api.
import express from 'express';
import { Flow, Execution } from '../db.js';
import { NODE_TYPES, withDefaults } from '../../shared/nodes.js';
import { runFlow, stopRun, stopFlowRuns, preview, activeRuns, BusyError } from '../engine/runner.js';
import { register, unregister, triggerSummary } from '../engine/triggers.js';
import { GraphError } from '../engine/compile.js';

export const router = express.Router();

const MAX_NODES = 500;

class InputError extends Error {}

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => String(v ?? '').slice(0, max);

// Accepts a graph from the client and keeps only what the app understands.
export function cleanGraph(graph) {
  if (!isObject(graph)) throw new InputError('graph must be an object');
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  if (nodes.length > MAX_NODES) throw new InputError(`a flow can have at most ${MAX_NODES} nodes`);

  const clean_nodes = nodes.map((n) => {
    if (!isObject(n) || !NODE_TYPES[n.type]) throw new InputError(`unknown node type "${n?.type}"`);
    return withDefaults({
      id: str(n.id, 64),
      type: n.type,
      name: str(n.name, 100).trim() || NODE_TYPES[n.type].title,
      x: Number(n.x) || 0,
      y: Number(n.y) || 0,
      config: isObject(n.config) ? n.config : {},
      settings: isObject(n.settings) ? n.settings : {},
    });
  });
  const ids = new Set(clean_nodes.map((n) => n.id));
  if (ids.size !== clean_nodes.length || ids.has('')) throw new InputError('node ids must be unique');

  const seen = new Set();
  const clean_edges = edges
    .filter((e) => isObject(e) && ids.has(e.from) && ids.has(e.to))
    .map((e) => ({ id: str(e.id, 200) || `${e.from}.${e.port}>${e.to}`, from: e.from, port: str(e.port, 40) || 'main', to: e.to }))
    .filter((e) => {
      const key = `${e.from}.${e.port}>${e.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const viewport = isObject(graph.viewport)
    ? { x: Number(graph.viewport.x) || 0, y: Number(graph.viewport.y) || 0, zoom: Number(graph.viewport.zoom) || 1 }
    : undefined;
  return { nodes: clean_nodes, edges: clean_edges, ...(viewport ? { viewport } : {}) };
}

const cleanOptions = (options) => ({ exit_on_error: options?.exit_on_error !== false });

function summary(flow, last) {
  return {
    id: flow.id,
    name: flow.name,
    description: flow.description,
    active: flow.active,
    node_count: flow.graph.nodes.length,
    triggers: [...new Set(flow.graph.nodes.filter((n) => NODE_TYPES[n.type]?.kind === 'trigger').map((n) => n.type))],
    updated_at: flow.updatedAt,
    created_at: flow.createdAt,
    last_execution: last ? { id: last.id, status: last.status, started_at: last.started_at, mode: last.mode } : null,
  };
}

const lastExecution = (flow_id) => Execution.findOne({
  where: { flow_id },
  order: [['started_at', 'DESC']],
  attributes: ['id', 'status', 'started_at', 'mode'],
});

const full = async (flow) => ({
  ...summary(flow, await lastExecution(flow.id)),
  graph: flow.graph,
  options: flow.options,
  listening: triggerSummary(flow.id),
});

async function load(req) {
  const flow = await Flow.findByPk(req.params.id);
  if (!flow) {
    const error = new InputError('flow not found');
    error.status = 404;
    throw error;
  }
  return flow;
}

// Wraps async handlers so thrown errors become JSON replies.
const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error instanceof GraphError) {
      res.status(422).json({ error: error.message, node_id: error.node_id });
    } else if (error instanceof BusyError) {
      res.status(429).json({ error: error.message });
    } else if (error instanceof InputError) {
      res.status(error.status ?? 400).json({ error: error.message });
    } else {
      console.error(error);
      res.status(500).json({ error: error.message });
    }
  }
};

// Activating a flow can fail (bad cron, webhook clash); roll back if so.
async function applyTriggers(flow) {
  try {
    register(flow);
  } catch (error) {
    unregister(flow.id);
    if (flow.active) await flow.update({ active: false });
    throw new InputError(`${error.message} The flow was saved but is now inactive.`);
  }
}

router.get('/flows', handle(async (req, res) => {
  const flows = await Flow.findAll({ order: [['updatedAt', 'DESC']] });
  const lasts = await Promise.all(flows.map((f) => lastExecution(f.id)));
  res.json(flows.map((f, i) => summary(f, lasts[i])));
}));

router.post('/flows', handle(async (req, res) => {
  const body = req.body ?? {};
  const graph = body.graph ? cleanGraph(body.graph) : {
    nodes: [withDefaults({ id: 'trigger', type: 'manual', name: 'Start', x: 0, y: 0 })],
    edges: [],
  };
  const flow = await Flow.create({
    name: str(body.name, 200).trim() || 'Untitled flow',
    description: str(body.description, 1000),
    graph,
    options: cleanOptions(body.options),
    active: false,
  });
  res.status(201).json(await full(flow));
}));

router.get('/flows/:id', handle(async (req, res) => {
  res.json(await full(await load(req)));
}));

router.put('/flows/:id', handle(async (req, res) => {
  const flow = await load(req);
  const body = req.body ?? {};
  const changes = {};
  if (body.name !== undefined) changes.name = str(body.name, 200).trim() || 'Untitled flow';
  if (body.description !== undefined) changes.description = str(body.description, 1000);
  if (body.graph !== undefined) changes.graph = cleanGraph(body.graph);
  if (body.options !== undefined) changes.options = cleanOptions(body.options);
  if (body.active !== undefined) changes.active = Boolean(body.active);
  await flow.update(changes);
  await applyTriggers(flow);
  res.json(await full(flow));
}));

router.delete('/flows/:id', handle(async (req, res) => {
  const flow = await load(req);
  unregister(flow.id);
  stopFlowRuns(flow.id);
  await Execution.destroy({ where: { flow_id: flow.id } });
  await flow.destroy();
  res.status(204).end();
}));

router.post('/flows/:id/duplicate', handle(async (req, res) => {
  const flow = await load(req);
  const copy = await Flow.create({
    name: `${flow.name} (copy)`.slice(0, 200),
    description: flow.description,
    graph: flow.graph,
    options: flow.options,
    active: false,
  });
  res.status(201).json(await full(copy));
}));

// Export format: { format: 'micro-flow-editor', version: 1, name, description, options, graph }
router.get('/flows/:id/export', handle(async (req, res) => {
  const flow = await load(req);
  const file = `${flow.name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'flow'}.json`;
  res.attachment(file).json({
    format: 'micro-flow-editor',
    version: 1,
    name: flow.name,
    description: flow.description,
    options: flow.options,
    graph: flow.graph,
  });
}));

router.post('/flows/import', handle(async (req, res) => {
  const body = req.body ?? {};
  if (!isObject(body.graph)) throw new InputError('not a micro-flow-editor export: "graph" is missing');
  const flow = await Flow.create({
    name: str(body.name, 200).trim() || 'Imported flow',
    description: str(body.description, 1000),
    graph: cleanGraph(body.graph),
    options: cleanOptions(body.options),
    active: false,
  });
  res.status(201).json(await full(flow));
}));

// Runs the flow. The editor sends its current (maybe unsaved) graph.
router.post('/flows/:id/run', handle(async (req, res) => {
  const flow = await load(req);
  const graph = req.body?.graph ? cleanGraph(req.body.graph) : flow.graph;
  const options = req.body?.options ? cleanOptions(req.body.options) : flow.options;
  const { execution_id } = await runFlow({
    flow,
    graph,
    options,
    mode: 'manual',
    trigger_id: req.body?.trigger_id ? String(req.body.trigger_id) : null,
  });
  res.status(202).json({ execution_id });
}));

router.post('/flows/:id/preview', handle(async (req, res) => {
  const flow = await load(req);
  const graph = req.body?.graph ? cleanGraph(req.body.graph) : flow.graph;
  res.json(preview(flow, graph, req.body?.trigger_id ?? null));
}));

router.get('/flows/:id/executions', handle(async (req, res) => {
  await load(req);
  const executions = await Execution.findAll({
    where: { flow_id: req.params.id },
    order: [['started_at', 'DESC']],
    limit: Math.min(200, Number(req.query.limit) || 50),
    attributes: ['id', 'flow_id', 'mode', 'status', 'started_at', 'finished_at', 'error'],
  });
  res.json(executions);
}));

router.delete('/flows/:id/executions', handle(async (req, res) => {
  await load(req);
  await Execution.destroy({ where: { flow_id: req.params.id, status: ['success', 'error', 'stopped'] } });
  res.status(204).end();
}));

router.get('/executions/:id', handle(async (req, res) => {
  const execution = await Execution.findByPk(req.params.id);
  if (!execution) throw Object.assign(new InputError('execution not found'), { status: 404 });
  res.json(execution);
}));

router.delete('/executions/:id', handle(async (req, res) => {
  await Execution.destroy({ where: { id: req.params.id } });
  res.status(204).end();
}));

router.post('/executions/:id/stop', handle(async (req, res) => {
  if (!stopRun(req.params.id)) throw Object.assign(new InputError('that execution is not running'), { status: 404 });
  res.status(202).json({ stopping: true });
}));

router.get('/runs', (req, res) => res.json(activeRuns()));
