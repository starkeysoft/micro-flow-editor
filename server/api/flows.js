// REST API for flows and their executions, mounted at /api.
import express from 'express';
import { sequelize, Flow, Execution, Snapshot, ArchivedFlow } from '../db.js';
import { NODE_TYPES, withDefaults } from '../../shared/nodes.js';
import { runFlow, stopRun, stopFlowRuns, preview, activeRuns, BusyError } from '../engine/runner.js';
import { registerLive, unregister, triggerSummary } from '../engine/triggers.js';
import {
  saveDraft, flush, flushAll, discard, createSnapshot, latestSnapshot, hasUnsnapshottedChanges,
} from '../drafts.js';
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

const snapshotSummary = (s) => ({
  id: s.id,
  label: s.label,
  name: s.name,
  created_by: s.created_by,
  created_at: s.createdAt,
  node_count: s.graph.nodes.length,
});

const full = async (flow) => {
  const latest = await latestSnapshot(flow.id);
  return {
    ...summary(flow, await lastExecution(flow.id)),
    graph: flow.graph,
    options: flow.options,
    listening: triggerSummary(flow.id),
    // Active triggers run the latest snapshot; changed_since says the editor
    // holds changes that aren't in it yet.
    snapshot: {
      latest: latest ? snapshotSummary(latest) : null,
      changed_since: await hasUnsnapshottedChanges(flow),
    },
  };
};

// Loads a flow, writing its pending autosave draft first so every route sees
// the latest edits.
async function load(req) {
  await flush(req.params.id);
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
      res.status(error.status ?? 400).json({ error: error.message, ...(error.deactivated ? { deactivated: true } : {}) });
    } else {
      console.error(error);
      res.status(500).json({ error: error.message });
    }
  }
};

// Starting a flow's triggers can fail (bad cron, webhook clash). The flow is
// then switched off, and the error says so; whatever was being saved stays saved.
async function applyTriggers(flow) {
  try {
    await registerLive(flow);
  } catch (error) {
    unregister(flow.id);
    if (flow.active) await flow.update({ active: false });
    throw Object.assign(new InputError(`${error.message} The flow has been turned off.`), { deactivated: true });
  }
}

router.get('/flows', handle(async (req, res) => {
  await flushAll().catch((error) => console.error(`Autosave flush failed: ${error.message}`));
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
  // A graph sent here replaces any pending autosave draft.
  if (changes.graph) await discard(flow.id);
  const activating = changes.active === true && !flow.active;
  await flow.update(changes);
  // PUT with a graph is a save; turning a flow on saves its current state if
  // it isn't in a snapshot yet. Either way the triggers run that snapshot.
  const saved_content = changes.graph || changes.options;
  if (saved_content || (activating && await hasUnsnapshottedChanges(flow))) {
    await createSnapshot(flow, { label: saved_content ? 'Saved through the API' : 'Activated', created_by: req.user?.username ?? null });
  }
  await applyTriggers(flow);
  res.json(await full(flow));
}));

router.delete('/flows/:id', handle(async (req, res) => {
  const flow = await load(req);
  unregister(flow.id);
  stopFlowRuns(flow.id);
  await discard(flow.id);
  await Execution.destroy({ where: { flow_id: flow.id } });
  await Snapshot.destroy({ where: { flow_id: flow.id } });
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

// ── Autosave ──
// The editor sends its whole document after every change. It goes into the
// cache only; the background worker (server/drafts.js) writes it to the row.
// POST is accepted too, for fetch({ keepalive }) when a tab closes.
// The existence check is a primary-key read on every draft (cheap; the cache
// exists to spare writes). Caching it would let edits to a flow deleted
// elsewhere (another instance, a reset database) be accepted and then lost.
async function putDraft(req, res) {
  const id = req.params.id;
  if (!(await Flow.findByPk(id, { attributes: ['id'] }))) {
    await discard(id);
    throw Object.assign(new InputError('flow not found'), { status: 404 });
  }
  const body = req.body ?? {};
  if (!isObject(body.graph)) throw new InputError('a draft needs a graph');
  const saved = await saveDraft(id, {
    name: str(body.name, 200).trim() || 'Untitled flow',
    description: str(body.description, 1000),
    graph: cleanGraph(body.graph),
    options: cleanOptions(body.options),
  });
  res.json(saved);
}

router.put('/flows/:id/draft', handle(putDraft));
router.post('/flows/:id/draft', handle(putDraft));

// ── Snapshots ──
router.get('/flows/:id/snapshots', handle(async (req, res) => {
  const flow = await load(req);
  const snapshots = await Snapshot.findAll({ where: { flow_id: flow.id }, order: [['createdAt', 'DESC'], ['id', 'DESC']] });
  res.json(snapshots.map((s, i) => ({ ...snapshotSummary(s), live: i === 0 })));
}));

// Save: writes the latest edits to the row, then stores them as a snapshot.
// An active flow's triggers switch to it.
router.post('/flows/:id/snapshots', handle(async (req, res) => {
  const flow = await load(req);
  const snapshot = await createSnapshot(flow, { label: req.body?.label, created_by: req.user?.username ?? null });
  if (flow.active) await applyTriggers(flow);
  res.status(201).json({ ...snapshotSummary(snapshot), live: true });
}));

async function loadSnapshot(req) {
  const snapshot = await Snapshot.findByPk(req.params.id);
  if (!snapshot) throw Object.assign(new InputError('snapshot not found'), { status: 404 });
  return snapshot;
}

router.get('/snapshots/:id', handle(async (req, res) => {
  const snapshot = await loadSnapshot(req);
  res.json({ ...snapshotSummary(snapshot), flow_id: snapshot.flow_id, description: snapshot.description, graph: snapshot.graph, options: snapshot.options });
}));

// Same format as GET /flows/:id/export, so a snapshot can be imported as a flow.
router.get('/snapshots/:id/export', handle(async (req, res) => {
  const snapshot = await loadSnapshot(req);
  const stamp = snapshot.createdAt.toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const base = snapshot.name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'flow';
  res.attachment(`${base}-${stamp}.json`).json({
    format: 'micro-flow-editor',
    version: 1,
    name: snapshot.name,
    description: snapshot.description,
    options: snapshot.options,
    graph: snapshot.graph,
  });
}));

router.delete('/snapshots/:id', handle(async (req, res) => {
  const snapshot = await loadSnapshot(req);
  const owner = await Flow.findByPk(snapshot.flow_id, { attributes: ['id', 'active'] });
  if (owner?.active && (await Snapshot.count({ where: { flow_id: owner.id } })) === 1) {
    // Without a snapshot an active flow would run its autosaved draft.
    throw Object.assign(new InputError('This is the only snapshot of an active flow, so it\'s what the triggers run. Turn the flow off first, or save another snapshot.'), { status: 409 });
  }
  await snapshot.destroy();
  // Deleting the latest snapshot changes what an active flow runs.
  const flow = await Flow.findByPk(snapshot.flow_id);
  if (flow?.active) await applyTriggers(flow);
  res.status(204).end();
}));

// ── Archive ──
// Archiving takes a flow out of the flows table. Only its most recent
// snapshot is kept (edits not in a snapshot are saved as one first), copied
// into archived_flows; its other snapshots and executions are deleted.
// Unarchiving recreates the flow, with the same id, from that snapshot.
const archivedSummary = (a) => ({
  id: a.id,
  name: a.name,
  description: a.description,
  node_count: a.graph.nodes.length,
  triggers: [...new Set(a.graph.nodes.filter((n) => NODE_TYPES[n.type]?.kind === 'trigger').map((n) => n.type))],
  archived_at: a.archived_at,
  archived_by: a.archived_by,
  snapshot: { id: a.snapshot_id, label: a.snapshot_label, created_at: a.snapshot_created_at, created_by: a.snapshot_created_by },
});

async function loadArchived(req) {
  const archived = await ArchivedFlow.findByPk(req.params.id);
  if (!archived) throw Object.assign(new InputError('archived flow not found'), { status: 404 });
  return archived;
}

// Sequelize sets createdAt itself on create; put the original time back.
// (The model's attribute definitions let each dialect format the date.)
const restoreCreatedAt = (model, id, date, transaction) => (date
  ? sequelize.getQueryInterface().bulkUpdate(model.getTableName(), { createdAt: date }, { id }, { transaction }, model.getAttributes())
  : null);

router.post('/flows/:id/archive', handle(async (req, res) => {
  const flow = await load(req); // writes any pending autosave first
  const user = req.user?.username ?? null;
  unregister(flow.id);
  stopFlowRuns(flow.id);
  let latest = await latestSnapshot(flow.id);
  if (!latest || await hasUnsnapshottedChanges(flow)) {
    latest = await createSnapshot(flow, { label: 'Archived', created_by: user });
  }
  const archived = await sequelize.transaction(async (transaction) => {
    const row = await ArchivedFlow.create({
      id: flow.id,
      name: latest.name,
      description: latest.description,
      graph: latest.graph,
      options: latest.options,
      snapshot_id: latest.id,
      snapshot_label: latest.label,
      snapshot_created_by: latest.created_by,
      snapshot_created_at: latest.createdAt,
      flow_created_at: flow.createdAt,
      archived_at: new Date(),
      archived_by: user,
    }, { transaction });
    await Execution.destroy({ where: { flow_id: flow.id }, transaction });
    await Snapshot.destroy({ where: { flow_id: flow.id }, transaction });
    await flow.destroy({ transaction });
    return row;
  });
  await discard(flow.id);
  res.json(archivedSummary(archived));
}));

router.get('/archive', handle(async (req, res) => {
  const archived = await ArchivedFlow.findAll({ order: [['archived_at', 'DESC']] });
  res.json(archived.map(archivedSummary));
}));

router.get('/archive/:id', handle(async (req, res) => {
  const archived = await loadArchived(req);
  res.json({ ...archivedSummary(archived), graph: archived.graph, options: archived.options });
}));

// Same format as GET /flows/:id/export, so it can be imported as a new flow.
router.get('/archive/:id/export', handle(async (req, res) => {
  const archived = await loadArchived(req);
  const file = `${archived.name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'flow'}.json`;
  res.attachment(file).json({
    format: 'micro-flow-editor',
    version: 1,
    name: archived.name,
    description: archived.description,
    options: archived.options,
    graph: archived.graph,
  });
}));

// Recreates the flow (same id, switched off) from the kept snapshot, which
// becomes its one snapshot again.
router.post('/archive/:id/unarchive', handle(async (req, res) => {
  const archived = await loadArchived(req);
  if (await Flow.findByPk(archived.id, { attributes: ['id'] })) {
    throw Object.assign(new InputError('A flow with this id already exists.'), { status: 409 });
  }
  const flow = await sequelize.transaction(async (transaction) => {
    const created = await Flow.create({
      id: archived.id,
      name: archived.name,
      description: archived.description,
      graph: archived.graph,
      options: archived.options,
      active: false,
    }, { transaction });
    await Snapshot.create({
      id: archived.snapshot_id,
      flow_id: archived.id,
      label: archived.snapshot_label,
      name: archived.name,
      description: archived.description,
      graph: archived.graph,
      options: archived.options,
      created_by: archived.snapshot_created_by,
    }, { transaction });
    await restoreCreatedAt(Flow, archived.id, archived.flow_created_at, transaction);
    await restoreCreatedAt(Snapshot, archived.snapshot_id, archived.snapshot_created_at, transaction);
    await archived.destroy({ transaction });
    return created;
  });
  await flow.reload();
  res.json(await full(flow));
}));

router.delete('/archive/:id', handle(async (req, res) => {
  const archived = await loadArchived(req);
  await archived.destroy();
  res.status(204).end();
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
