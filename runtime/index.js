// @ronaldroe/micro-flow-editor/runtime
//
// Runs flows built in the editor inside your own app, with no server or
// database: compile an exported flow (the JSON from "Export JSON") into a
// micro-flow Workflow tree and execute it.
//
//   import { runFlow } from '@ronaldroe/micro-flow-editor/runtime';
//   const result = await runFlow(JSON.parse(fs.readFileSync('my-flow.json', 'utf8')));
//
// The Workflow is built from @ronaldroe/micro-flow, a dependency that npm
// shares with your app's own install when the versions are compatible, so
// Workflow.events and everything else micro-flow offers work on it as usual.
import { compileGraph, describeTree, validate, GraphError, StopError } from '../server/engine/compile.js';
import { createContext, stopContext, executeRoot } from '../server/engine/context.js';
import { observe } from '../server/engine/observe.js';

export { NODE_TYPES, GROUPS, OPERATORS, getPath, resolve, isTrigger, outputsOf } from '../shared/nodes.js';
export { TEMPLATES } from '../shared/templates.js';
export { validate, GraphError, StopError };

// Accepts an export file ({ format, name, options, graph }), a flow row
// ({ name, graph, options }) or a bare graph ({ nodes, edges }).
function normalize(flow) {
  if (!flow || typeof flow !== 'object') throw new TypeError('compileFlow() needs a flow export, a flow or a graph');
  if (Array.isArray(flow.nodes)) return { name: 'flow', graph: flow, options: {} };
  if (!flow.graph || !Array.isArray(flow.graph.nodes)) throw new TypeError('the flow has no graph.nodes');
  return { name: flow.name || 'flow', graph: flow.graph, options: flow.options ?? {} };
}

/**
 * Compiles a flow into a micro-flow Workflow without running it.
 * @param {object} flow - An export file, a flow ({ name, graph, options }) or a graph.
 * @param {object} [options]
 * @param {string} [options.trigger_id] - Trigger node to start from (default: the first Manual Trigger, else the first trigger).
 * @param {*} [options.trigger_payload] - What the trigger outputs instead of its own settings (Manual and Webhook
 *   triggers); for a Webhook trigger use { method, path, query, headers, body }.
 * @param {boolean} [options.exit_on_error] - Defaults to the flow's own setting (true).
 * @param {number} [options.max_loop_iterations=1000]
 * @param {boolean} [options.block_private_networks=false] - SSRF guard for HTTP Request nodes.
 * @param {(node, entry) => void} [options.onNodeRun] - Called whenever a node finishes, fails, retries or is skipped.
 * @param {(card) => void} [options.onOutput] - Called for each Output Card.
 * @param {(text, level) => void} [options.onLog] - Called for each Log node message, retry and Filter break.
 * @returns {{ workflow, trigger, tree, run: () => Promise<object>, stop: () => void }}
 */
export function compileFlow(flow, options = {}) {
  const { name, graph, options: flow_options } = normalize(flow);
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const node_runs = {};
  const outputs = [];
  const logs = [];

  const ctx = createContext({
    trigger_payload: options.trigger_payload ?? null,
    execution: { id: null, mode: 'runtime' },
    block_private_networks: Boolean(options.block_private_networks),
    record(node_id, entry) {
      const full = { at: new Date().toISOString(), ...entry };
      (node_runs[node_id] ??= []).push(full);
      options.onNodeRun?.(nodes.get(node_id), full);
    },
    output(card) {
      outputs.push(card);
      options.onOutput?.(card);
    },
    log(text, level = 'info') {
      logs.push({ at: new Date().toISOString(), level, text });
      options.onLog?.(text, level);
    },
  });

  const compiled = compileGraph({ ...graph, name }, ctx, {
    trigger_id: options.trigger_id ?? null,
    exit_on_error: options.exit_on_error ?? flow_options.exit_on_error !== false,
    max_loop_iterations: options.max_loop_iterations ?? 1000,
  });

  let ran = false;
  return {
    /** The root micro-flow Workflow. */
    workflow: compiled.root,
    /** The trigger node the run starts from. */
    trigger: compiled.trigger,
    /** A plain description of the compiled Workflow tree. */
    tree: describeTree(compiled),
    /**
     * Executes the flow once. Resolves (never rejects for a failing flow) with
     * { status: 'success'|'error'|'stopped', error, output, response, outputs, logs, node_runs }.
     */
    async run() {
      if (ran) throw new Error('compileFlow() results run once; call compileFlow() again for another run');
      ran = true;
      // Control nodes (If, Switch, loops, Wait…) are recorded from micro-flow's events.
      const unobserve = observe(compiled, ctx, {
        log: (entry) => {
          logs.push({ at: new Date().toISOString(), level: entry.level ?? 'info', text: entry.text });
          options.onLog?.(entry.text, entry.level ?? 'info');
        },
        nameOf: (node_id) => nodes.get(node_id)?.name ?? node_id,
      });
      let outcome;
      try {
        outcome = await executeRoot(compiled.root, ctx);
      } finally {
        unobserve();
      }
      const { status, error } = outcome;
      return { status, error, output: ctx.last ?? null, response: ctx.response, outputs, logs, node_runs };
    },
    /** Stops a run in progress (in-flight HTTP requests and waits are aborted). */
    stop: () => stopContext(ctx),
  };
}

/** Compiles and runs a flow in one go. See compileFlow() for the options. */
export async function runFlow(flow, options = {}) {
  return compileFlow(flow, options).run();
}
