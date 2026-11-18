// MCP (Model Context Protocol) server at /mcp, so AI agents (Claude Code,
// Claude Desktop, any MCP client) can look up the node catalogue and build,
// check, save, activate and run logic flows.
//
// Streamable HTTP in stateless mode: every POST gets a fresh McpServer and
// transport, so nothing is kept between requests and several editor
// instances can sit behind one load balancer. Replies are plain JSON (no SSE
// stream), because no tool sends progress notifications.
//
// Auth is the same as the rest of /api: open while sign-in is off, otherwise
// an API token (Authorization: Bearer mfe_…) or a session cookie. Every tool
// goes through the same helpers as the REST routes in flows.js.
import express from 'express';
import * as z from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Flow, Execution } from '../db.js';
import { config } from '../config.js';
import {
  NODE_TYPES, GROUPS, OPERATORS, TRANSFORM_OPS, isTrigger, outputsOf, hasInput,
} from '../../shared/nodes.js';
import { TEMPLATES } from '../../shared/templates.js';
import { runFlow, stopRun, preview, clip, BusyError } from '../engine/runner.js';
import { GraphError } from '../engine/compile.js';
import { flushAll } from '../drafts.js';
import {
  InputError, cleanGraph, cleanOptions, summary, lastExecution, full, load,
  createFlow, updateFlow, archiveFlow,
} from './flows.js';

import pkg from '../../package.json' with { type: 'json' };

const MAX_WAIT_MS = 5 * 60 * 1000;
const LOG_TAIL = 100;

// ── What an agent needs to know to write a graph ──
const GUIDE = `A logic flow is a graph of nodes. Each node compiles to one @ronaldroe/micro-flow step.

Graph: { "nodes": [ { "id", "type", "name", "x", "y", "config", "settings" } ], "edges": [ { "from", "port", "to" } ] }
- id: unique short string ("t", "fetch", "n3"). name: unique label, used by $node["Name"] expressions.
- type: a key from node_types. config: that type's fields (missing keys get the defaults). Field values are
  strings unless the field kind is number/checkbox/cases.
- settings: { "retries": 0, "timeout_ms": "", "notes": "" }. Retries and a timeout apply to action nodes.
- x, y: canvas position. Lay flows out left to right, ~260 px between columns and ~120 px between rows.
- edges: "from" node id, "port" (one of that node's outputs; "main" for single-output nodes), "to" node id.
  Several edges from one port run those branches one after another. Triggers have no input.
- Every flow needs a trigger (manual, webhook or schedule). No cycles: use loop / repeat / while nodes.
- Loop, Repeat and Repeat While have two ports: "each" (the body, run per item) and "done" (gets the
  list of the body's results). If has "true"/"false"; Switch has "case-0".."case-N" plus "default".

Expressions (no code, paths only): {{ path }} in text fields reads from the node's input.
- {{ user.name }}, {{ items[0].id }}; {{ $ }} is the whole input.
- {{ $item }} the current loop item, {{ $trigger.x }} the trigger's output, {{ $node["Name"].x }} a node's
  last output, {{ $now }} ISO time, {{ $execution.id }}.
- A field that is only "{{ path }}" keeps the value's type; mixed text becomes a string.
- Condition fields (If, Switch, Filter, Skip, Repeat While): "path" is a bare path (no braces), "op" an
  operator value, "value" the right-hand side ("a, b" lists for in / not_in).

Running: run_flow starts at the Manual Trigger (or trigger_id). Its output is config.json, or the
"input" you pass. Webhook and schedule triggers only fire on their own while the flow is active, and then
run the latest saved snapshot. update_flow saves a snapshot every time.`;

function describeField(f) {
  const field = { key: f.key, label: f.label, kind: f.kind };
  if (f.options) field.options = f.options.map(([value, label]) => ({ value, label }));
  if (f.kind === 'operator') field.options = 'see operators';
  if (f.kind === 'cases') field.format = '[{ "op": "<operator>", "value": "<text>" }, …]';
  // show() is a one-line arrow function of config; its source says when the field applies.
  if (f.show) field.only_when = f.show.toString();
  return field;
}

function describeNodeTypes() {
  return Object.entries(NODE_TYPES).map(([type, t]) => ({
    type,
    title: t.title,
    group: t.group,
    kind: t.kind,
    micro_flow_class: t.micro,
    has_input: t.inputs !== false,
    outputs: typeof t.outputs === 'function'
      ? { depends_on_config: true, with_defaults: t.outputs(t.defaults ?? {}) }
      : t.outputs,
    description: t.blurb,
    defaults: t.defaults ?? {},
    fields: (t.fields ?? []).map(describeField),
  }));
}

// Problems compile() doesn't reject: they don't stop a run, but they're
// almost always mistakes.
function graphWarnings(graph, reachable) {
  const warnings = [];
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const edge of graph.edges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (from && !outputsOf(from).includes(edge.port)) {
      warnings.push(`Edge ${edge.from} → ${edge.to} uses port "${edge.port}", but "${from.name}" has ports ${JSON.stringify(outputsOf(from))}.`);
    }
    if (to && !hasInput(to)) warnings.push(`Edge ${edge.from} → ${edge.to} points at the trigger "${to.name}", which has no input.`);
  }
  for (const node of graph.nodes) {
    if (!isTrigger(node.type) && !reachable.has(node.id)) {
      warnings.push(`"${node.name}" (${node.id}) is not connected to the trigger that runs, so it never runs.`);
    }
  }
  return warnings;
}

// Reachable from any trigger (a flow can have a manual and a webhook one).
function reachableIds(graph) {
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const e of graph.edges) if (e.from === id) visit(e.to);
  };
  for (const n of graph.nodes) if (isTrigger(n.type)) visit(n.id);
  return seen;
}

function check(flow, graph, trigger_id) {
  const triggers = graph.nodes.filter((n) => isTrigger(n.type)).map((n) => ({ id: n.id, type: n.type, name: n.name }));
  try {
    const { tree } = preview(flow, graph, trigger_id);
    return { ok: true, triggers, warnings: graphWarnings(graph, reachableIds(graph)), compiled: tree };
  } catch (error) {
    if (!(error instanceof GraphError)) throw error;
    return { ok: false, error: error.message, node_id: error.node_id, triggers };
  }
}

// What a finished (or running) execution looks like to an agent: per node,
// how often it ran and its last result.
function describeExecution(execution, { nodes = execution.graph?.nodes ?? [], include_log = true } = {}) {
  const names = new Map(nodes.map((n) => [n.id, n.name]));
  const node_results = Object.entries(execution.node_runs ?? {}).map(([node_id, runs]) => {
    const last = runs.at(-1) ?? {};
    return {
      node_id,
      name: names.get(node_id) ?? node_id,
      runs: runs.length,
      status: last.status,
      ...(last.branch ? { branch: last.branch } : {}),
      ...(last.error ? { error: last.error } : {}),
      ...(last.note ? { note: last.note } : {}),
      ...(last.output !== undefined ? { output: last.output } : {}),
    };
  });
  const log = execution.log ?? [];
  return {
    id: execution.id,
    flow_id: execution.flow_id,
    mode: execution.mode,
    status: execution.status,
    error: execution.error ?? null,
    started_at: execution.started_at,
    finished_at: execution.finished_at ?? null,
    nodes: node_results,
    outputs: execution.outputs ?? [],
    ...(include_log ? { log: log.slice(-LOG_TAIL).map((e) => `${e.level === 'info' ? '' : `[${e.level}] `}${e.text}`), log_entries: log.length } : {}),
  };
}

// ── Tool plumbing ──
const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (message) => ({ content: [{ type: 'text', text: message }], isError: true });

// Expected errors become tool errors the agent can read and fix; anything
// else is logged and reported the same way.
const tool = (fn) => async (args) => {
  try {
    return text(await fn(args));
  } catch (error) {
    if (error instanceof GraphError) return fail(`${error.message}${error.node_id ? ` (node ${error.node_id})` : ''}`);
    if (error instanceof InputError || error instanceof BusyError) return fail(error.message);
    if (error?.name === 'SequelizeDatabaseError' && /uuid/i.test(error.message)) return fail('not found');
    console.error('MCP tool failed:', error);
    return fail(error.message);
  }
};

// Graphs come in as objects; some clients send JSON text instead.
const graphArg = z.union([z.record(z.string(), z.unknown()), z.string()])
  .describe('The graph: { nodes: [...], edges: [...] }. Call get_node_types for the format.');
const parseGraph = (value) => {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { throw new InputError('graph is not valid JSON'); }
};
const optionsArg = z.object({ exit_on_error: z.boolean().optional() }).optional()
  .describe('exit_on_error (default true): stop the run at the first failed node.');
const flowId = z.string().describe('Flow id (from list_flows)');

const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

function buildServer(user) {
  const who = user?.username ?? null;
  const server = new McpServer(
    { name: 'micro-flow-editor', version: pkg.version },
    {
      instructions: 'Builds and runs logic flows in a micro-flow-editor server. Call get_node_types first: it explains '
        + 'the graph format, every node type and the {{ path }} expressions. Then check_flow a graph before saving it, '
        + 'and run_flow to test it. Flows are also editable by people in the visual editor at the same server.',
    },
  );

  server.registerTool('get_node_types', {
    title: 'Node types and graph format',
    description: 'The graph format, expression syntax, every node type (fields, defaults, ports) and the condition operators. Read it before writing a graph.',
    annotations: READ,
  }, tool(() => ({
    guide: GUIDE,
    groups: GROUPS,
    node_types: describeNodeTypes(),
    operators: OPERATORS.map(([value, label]) => ({ value, label })),
    transform_ops: TRANSFORM_OPS.map(([value, label]) => ({ value, label })),
    server_limits: { max_loop_iterations: config.max_loop_iterations, max_concurrent_runs: config.max_concurrent_runs, block_private_networks: config.block_private_networks },
  })));

  server.registerTool('list_templates', {
    title: 'List starter flows',
    description: 'Starter flows that create_flow can copy (pass template). Good worked examples of graphs.',
    inputSchema: { include_graphs: z.boolean().optional().describe('Include each template\'s graph (default false)') },
    annotations: READ,
  }, tool(({ include_graphs }) => TEMPLATES.map((t) => ({
    key: t.key, title: t.title, description: t.description, ...(include_graphs ? { graph: t.graph } : {}),
  }))));

  server.registerTool('list_flows', {
    title: 'List flows',
    description: 'Every flow: id, name, description, active, node count, trigger types and the last execution.',
    annotations: READ,
  }, tool(async () => {
    await flushAll().catch((error) => console.error(`Autosave flush failed: ${error.message}`));
    const flows = await Flow.findAll({ order: [['updatedAt', 'DESC']] });
    const lasts = await Promise.all(flows.map((f) => lastExecution(f.id)));
    return flows.map((f, i) => summary(f, lasts[i]));
  }));

  server.registerTool('get_flow', {
    title: 'Get a flow',
    description: 'One flow with its graph (including edits not yet saved as a snapshot), options, listening triggers and its latest snapshot.',
    inputSchema: { flow_id: flowId },
    annotations: READ,
  }, tool(async ({ flow_id }) => full(await load(flow_id))));

  server.registerTool('check_flow', {
    title: 'Check a graph',
    description: 'Compiles a graph without running it: reports the error (with node_id) that would stop it, warnings (wrong ports, unconnected nodes) and the micro-flow Workflow tree it compiles to. Pass a graph, a flow_id, or both (the flow\'s name and options with your graph).',
    inputSchema: {
      graph: graphArg.optional(),
      flow_id: flowId.optional(),
      trigger_id: z.string().optional().describe('The trigger to compile from (default: the Manual Trigger, else the first)'),
    },
    annotations: READ,
  }, tool(async ({ graph, flow_id, trigger_id }) => {
    if (!graph && !flow_id) throw new InputError('pass a graph or a flow_id');
    const flow = flow_id ? await load(flow_id) : { name: 'check', options: { exit_on_error: true } };
    return check(flow, graph ? cleanGraph(parseGraph(graph)) : flow.graph, trigger_id ?? null);
  }));

  server.registerTool('create_flow', {
    title: 'Create a flow',
    description: 'Creates a flow (switched off). Give a graph, or a template key, or neither for one Manual Trigger. Returns the flow with its id; the editor opens it at /flows/<id>.',
    inputSchema: {
      name: z.string().describe('Flow name'),
      description: z.string().optional(),
      graph: graphArg.optional(),
      template: z.string().optional().describe('A key from list_templates, used when no graph is given'),
      options: optionsArg,
    },
    annotations: WRITE,
  }, tool(async ({ name, description, graph, template, options }) => {
    let body = { name, description, options };
    if (graph) body.graph = parseGraph(graph);
    else if (template) {
      const found = TEMPLATES.find((t) => t.key === template);
      if (!found) throw new InputError(`no template "${template}"; list_templates shows the keys`);
      body = { name, description: description ?? found.description, options: options ?? found.options, graph: found.graph };
    }
    const flow = await createFlow(body);
    return { ...(await full(flow)), check: check(flow, flow.graph, null) };
  }));

  server.registerTool('update_flow', {
    title: 'Update a flow',
    description: 'Changes a flow\'s name, description, graph or options. A new graph replaces the whole graph (send every node and edge) and any unsaved edits in the editor, and is saved as a snapshot, which an active flow\'s triggers switch to.',
    inputSchema: {
      flow_id: flowId,
      name: z.string().optional(),
      description: z.string().optional(),
      graph: graphArg.optional(),
      options: optionsArg,
    },
    annotations: { ...WRITE, idempotentHint: true },
  }, tool(async ({ flow_id, name, description, graph, options }) => {
    const flow = await load(flow_id);
    const body = { name, description, options: options && cleanOptions({ ...flow.options, ...options }) };
    if (graph) body.graph = parseGraph(graph);
    await updateFlow(flow, body, { label: 'Saved through MCP', created_by: who, source: 'mcp' });
    return { ...(await full(flow)), check: check(flow, flow.graph, null) };
  }));

  server.registerTool('set_flow_active', {
    title: 'Turn a flow on or off',
    description: 'Active flows listen on their Webhook (/webhook/<path>) and Schedule triggers, running the latest snapshot. Turning a flow on snapshots edits not yet in one. Fails (and stays off) if a trigger can\'t start, e.g. a bad cron or a webhook path another flow uses.',
    inputSchema: { flow_id: flowId, active: z.boolean() },
    annotations: { ...WRITE, idempotentHint: true, openWorldHint: true },
  }, tool(async ({ flow_id, active }) => {
    const flow = await updateFlow(await load(flow_id), { active }, { created_by: who, source: 'mcp' });
    const { id, name, listening, snapshot } = await full(flow);
    return { id, name, active: flow.active, listening, snapshot };
  }));

  server.registerTool('archive_flow', {
    title: 'Archive a flow',
    description: 'Takes a flow out of the flow list: switches its triggers off, keeps only its latest snapshot and deletes its other snapshots and its executions. People can unarchive it in the editor.',
    inputSchema: { flow_id: flowId },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, tool(async ({ flow_id }) => archiveFlow(await load(flow_id), who)));

  server.registerTool('run_flow', {
    title: 'Run a flow',
    description: 'Runs a flow now (like Run in the editor) and waits for it to finish, up to wait_ms. Returns the status, each node\'s last output, Output cards and the log tail; if it is still running, returns the execution id for get_execution. HTTP Request nodes really call their URLs.',
    inputSchema: {
      flow_id: flowId,
      graph: graphArg.optional().describe('Run this graph instead of the stored one (it is not saved)'),
      trigger_id: z.string().optional().describe('The trigger to start from (default: the Manual Trigger, else the first)'),
      input: z.unknown().optional().describe('The trigger\'s output for this run, instead of its configured JSON / sample body'),
      wait_ms: z.number().int().min(0).max(MAX_WAIT_MS).optional().describe('How long to wait for the result (default 30000; 0 = don\'t wait)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, tool(async ({ flow_id, graph, trigger_id, input, wait_ms = 30000 }) => {
    const flow = await load(flow_id);
    const run_graph = graph ? cleanGraph(parseGraph(graph)) : flow.graph;
    const { execution_id, done } = await runFlow({
      flow,
      graph: run_graph,
      options: flow.options,
      mode: 'manual',
      trigger_id: trigger_id ?? null,
      trigger_payload: input === undefined ? null : input,
    });
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), wait_ms); });
    const finished = await Promise.race([done, timeout]);
    clearTimeout(timer);
    if (!finished) return { execution_id, status: 'running', note: 'Still running. Call get_execution with this id, or stop_execution.' };
    const row = await Execution.findByPk(execution_id);
    return {
      ...describeExecution(row, { nodes: run_graph.nodes }),
      ...(finished.response ? { webhook_response: clip(finished.response) } : {}),
      last_output: clip(finished.last),
    };
  }));

  server.registerTool('get_execution', {
    title: 'Get an execution',
    description: 'A run\'s status, error, each node\'s run count and last output, Output cards and the log tail.',
    inputSchema: {
      execution_id: z.string(),
      all_runs_of: z.string().optional().describe('A node id: also return every recorded run of that node (inputs and outputs)'),
    },
    annotations: READ,
  }, tool(async ({ execution_id, all_runs_of }) => {
    const row = await Execution.findByPk(execution_id);
    if (!row) throw new InputError('execution not found');
    const result = describeExecution(row);
    if (all_runs_of) result.runs_of_node = row.node_runs?.[all_runs_of] ?? [];
    return result;
  }));

  server.registerTool('list_executions', {
    title: 'List executions',
    description: 'A flow\'s recent runs, newest first.',
    inputSchema: { flow_id: flowId, limit: z.number().int().min(1).max(200).optional().describe('Default 20') },
    annotations: READ,
  }, tool(async ({ flow_id, limit = 20 }) => {
    await load(flow_id);
    return Execution.findAll({
      where: { flow_id },
      order: [['started_at', 'DESC']],
      limit,
      attributes: ['id', 'mode', 'status', 'started_at', 'finished_at', 'error'],
    });
  }));

  server.registerTool('stop_execution', {
    title: 'Stop a run',
    description: 'Stops a running execution.',
    inputSchema: { execution_id: z.string() },
    annotations: { ...WRITE, idempotentHint: true },
  }, tool(({ execution_id }) => {
    if (!stopRun(execution_id)) throw new InputError('that execution is not running');
    return { stopping: true };
  }));

  return server;
}

// ── HTTP ──
export const router = express.Router();

// The MCP spec asks servers to check Origin, against DNS rebinding: a web
// page must not drive a local editor through a visitor's browser. Clients
// that aren't browsers send no Origin.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.host ?? req.headers.host);
  } catch {
    return false;
  }
}

const rpcError = (res, status, message) => res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null });

router.post('/', async (req, res) => {
  if (!sameOrigin(req)) return rpcError(res, 403, 'cross-site request refused');
  const server = buildServer(req.user);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request failed:', error);
    if (!res.headersSent) rpcError(res, 500, 'internal error');
  }
});

// Stateless: no server-to-client stream and no sessions to end.
router.all('/', (req, res) => {
  res.set('Allow', 'POST');
  rpcError(res, 405, 'method not allowed: this MCP server is stateless, use POST');
});
