// Compiles an editor graph into a tree of micro-flow Workflows.
//
// Starting at the chosen trigger, each node becomes one step:
// - action nodes (and triggers) are Steps whose callable runs the node and
//   keeps its output in ctx.out (keyed by step id); the next node's inputFn
//   reads it there.
// - one successor is appended to the same Workflow. Several successors
//   (fan-out) each become a Step whose callable is a nested Workflow, run in
//   the order the wires were made.
// - If → ConditionalStep, Switch → SwitchStep + Cases, Loop/Repeat/While →
//   LoopStep (for_each/for/while); each of their branches is a nested Workflow.
//   A loop and its two hidden helper steps run inside one group Step, so the
//   node is a single step to its Workflow (a Skip Next If skips all of it).
// - Wait → DelayStep, Filter/Skip Next If → FlowControlStep; they pass their
//   input straight through.
// A node reached by several paths compiles once per path; `steps` maps every
// compiled step id back to its node.
import {
  Workflow,
  Step,
  LoopStep,
  ConditionalStep,
  SwitchStep,
  Case,
  DelayStep as MicroDelayStep,
  FlowControlStep,
} from '@ronaldroe/micro-flow';
import schedule from 'node-schedule';
import { NODE_TYPES, getPath, resolve, conditionValue, isTrigger } from '../../shared/nodes.js';
import { ACTIONS } from './actions.js';

export class GraphError extends Error {
  constructor(message, node_id = null) {
    super(message);
    this.node_id = node_id;
  }
}

export class StopError extends Error {}

// micro-flow's DelayStep works out when to wake up, then emits its
// "scheduled" event (which serializes the step) before handing that time to
// node-schedule. If emitting takes longer than the delay, the time has passed,
// scheduleJob() returns null and the step never finishes. This subclass
// resolves straight away in that case, and ends the wait when a run is stopped.
class DelayStep extends MicroDelayStep {
  constructor({ abort_signal, ...options }) {
    super(options);
    this.abort_signal = abort_signal;
  }

  async delay(delay_until) {
    const prefix = `DELAY_STEP_${this.delay_type.toUpperCase()}`;
    this.log(Workflow.event_names.step[`${prefix}_SCHEDULED`]);
    const finish = () => {
      this.log(Workflow.event_names.step[`${prefix}_COMPLETE`]);
      return { delayed: true, delay_type: this.delay_type, timestamp: new Date().toISOString() };
    };
    if (delay_until.getTime() <= Date.now()) return finish();
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.scheduled_job?.cancel();
        reject(new StopError('stopped by user'));
      };
      this.scheduled_job = schedule.scheduleJob(delay_until, () => {
        this.abort_signal?.removeEventListener('abort', onAbort);
        resolve(finish());
      });
      if (!this.scheduled_job) return resolve(finish());
      this.abort_signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

// Picks the trigger to start from and checks the graph. A flow may have
// several triggers (e.g. a Manual one for testing and a Webhook one).
export function validate(graph, trigger_id = null) {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const node of graph.nodes) {
    if (!NODE_TYPES[node.type]) throw new GraphError(`Unknown node type "${node.type}".`, node.id);
  }
  for (const edge of graph.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) throw new GraphError('A connection points at a node that no longer exists.');
  }

  const triggers = graph.nodes.filter((n) => isTrigger(n.type));
  if (triggers.length === 0) throw new GraphError('Add a trigger: every flow starts at one.');
  const trigger = trigger_id
    ? triggers.find((t) => t.id === trigger_id)
    : triggers.find((t) => t.type === 'manual') ?? triggers[0];
  if (!trigger) throw new GraphError('That trigger is not in this flow.');

  const names = new Set();
  for (const node of graph.nodes) {
    if (names.has(node.name)) throw new GraphError(`Two nodes are called "${node.name}". Node names must be unique.`, node.id);
    names.add(node.name);
  }

  const reachable = new Set();
  const visit = (id, stack) => {
    if (stack.includes(id)) {
      throw new GraphError('This flow has a cycle. Use a Loop, Repeat or Repeat While node to run things more than once.', id);
    }
    reachable.add(id);
    for (const edge of graph.edges.filter((e) => e.from === id)) visit(edge.to, [...stack, id]);
  };
  visit(trigger.id, []);
  return { trigger, reachable };
}

// Keeps each nested Workflow's sessions to the current run. Loop bodies run
// once per item, and every snapshot of a workflow embeds all of its sessions,
// so without this, event payloads grow with every pass.
function keepOneSession(workflow) {
  const start = workflow.startNewSession.bind(workflow);
  workflow.startNewSession = (...args) => {
    workflow.sessions = {};
    return start(...args);
  };
}

export function compileGraph(graph, ctx, { trigger_id = null, exit_on_error = true, max_loop_iterations = 1000 } = {}) {
  const { trigger } = validate(graph, trigger_id);
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const steps = new Map();      // step id → { node_id, kind, inputFn }
  const step_order = [];        // every compiled step id, in creation order
  const children = new Map();   // step id → [{ label, workflow }] (for the tree view)
  const workflows = new Set();

  const successors = (node_id, port) =>
    graph.edges.filter((e) => e.from === node_id && e.port === port);

  const stepOptions = (node, container) => {
    const timeout = Number(node.settings?.timeout_ms);
    return {
      name: node.name,
      max_retries: Math.min(10, Math.max(0, Number(node.settings?.retries) || 0)),
      // Containers default to no timeout: their branches may take a while.
      max_timeout_ms: timeout > 0 ? timeout : container ? null : 30000,
    };
  };

  const track = (step, entry) => {
    steps.set(step.id, entry);
    step_order.push(step.id);
    return step;
  };

  function makeWorkflow(name, wf_steps) {
    const wf = new Workflow({ name, exit_on_error, steps: wf_steps });
    keepOneSession(wf);
    workflows.add(wf);
    return wf;
  }

  const checkStop = () => {
    if (ctx.stopped) throw new StopError('stopped by user');
  };

  // The output of a step for the next node: its stored output; if it never
  // ran (a Skip Next If skipped it), its own input passes through; if it
  // failed, undefined, so later nodes in the branch are marked skipped.
  const outputOf = (step_id, inputFn) => () => {
    if (ctx.out.has(step_id)) return ctx.out.get(step_id);
    if (ctx.failed.has(step_id)) return undefined;
    return inputFn();
  };

  function body(node, port, edges, inputFn, stack) {
    return makeWorkflow(`${node.name} › ${port}`, continuation(edges, inputFn, stack));
  }

  function continuation(edges, inputFn, stack) {
    if (edges.length === 0) return [];
    if (edges.length === 1) return chain(edges[0], inputFn, stack);
    // Fan-out: every branch is its own Workflow, run one after another in
    // the order the wires were made.
    return edges.map((edge) => {
      const target = nodes.get(edge.to);
      const wf = makeWorkflow(`branch → ${target.name}`, chain(edge, inputFn, stack));
      const step = new Step({ name: `branch → ${target.name}`, callable: wf, max_timeout_ms: null });
      track(step, { node_id: null, kind: 'branch' });
      children.set(step.id, [{ label: 'callable', workflow: wf }]);
      return step;
    });
  }

  function condition(node, inputFn) {
    const { path, op, value } = node.config;
    return {
      subject: () => getPath(inputFn(), path, ctx),
      operator: op,
      value: conditionValue(op, value, inputFn, ctx),
    };
  }

  // A loop pass is a body Workflow: a hidden step that makes the item the
  // pass's input, the "each" branch, then a hidden step that keeps the pass's
  // last output. A Filter that breaks the pass skips the collect step, so the
  // item is dropped.
  function loopBody(node, itemFn, edges, collector, stack, onCollect = () => {}) {
    const first_body_step = step_order.length;
    const item = new Step({
      name: `· ${node.name} item`,
      max_timeout_ms: null,
      callable: function loopItem() {
        checkStop();
        // Forget the previous pass's outputs, so a node skipped on this pass
        // can't hand on a stale value.
        for (const id of body_ids) { ctx.out.delete(id); ctx.failed.delete(id); }
        ctx.item = itemFn();
        ctx.last = ctx.item;
        ctx.iteration_failed = false;
        ctx.out.set(this.id, ctx.item);
      },
    });
    const branch = continuation(edges, () => ctx.out.get(item.id), stack);
    const body_ids = step_order.slice(first_body_step);
    const collect = new Step({
      name: `· ${node.name} collect`,
      max_timeout_ms: null,
      callable: function loopCollect() {
        if (ctx.iteration_failed) return;
        collector.push(ctx.last);
        onCollect(ctx.last);
      },
    });
    track(item, { node_id: null, kind: 'hidden' });
    track(collect, { node_id: null, kind: 'hidden' });
    return makeWorkflow(`${node.name} › each`, [item, ...branch, collect]);
  }

  function chain(edge, inputFn, stack) {
    const node = nodes.get(edge.to);
    if (stack.includes(node.id)) throw new GraphError('This flow has a cycle.', node.id);
    const next_stack = [...stack, node.id];
    const def = NODE_TYPES[node.type];
    const after = (port, fn = inputFn) => continuation(successors(node.id, port), fn, next_stack);

    switch (def.kind) {
      case 'trigger':
      case 'action': {
        const run = ACTIONS[node.type];
        const step = new Step({
          ...stepOptions(node, false),
          callable: async function runNode() {
            checkStop();
            ctx.out.delete(this.id);
            ctx.failed.delete(this.id);
            const input = def.kind === 'trigger' ? undefined : inputFn();
            if (input === undefined && def.kind !== 'trigger') {
              ctx.record(node.id, { status: 'skipped', note: 'no input: an earlier node failed' });
              ctx.failed.add(this.id);
              return { node: node.name, skipped: true };
            }
            const started = Date.now();
            try {
              const output = (await run(input, node.config, ctx, this)) ?? null;
              checkStop();
              ctx.out.set(this.id, output);
              ctx.last = output;
              ctx.by_name.set(node.name, output);
              if (def.kind === 'trigger') ctx.trigger = output;
              ctx.record(node.id, { status: 'success', input, output, ms: Date.now() - started, attempt: this.retry_count });
              // Keep the step's own result small: event payloads embed it.
              return { node: node.name, output_type: Array.isArray(output) ? 'array' : typeof output };
            } catch (error) {
              ctx.failed.add(this.id);
              const will_retry = !(error instanceof StopError) && this.retry_count < this.max_retries;
              // Only a final failure drops the loop pass; a retry may succeed.
              if (!will_retry) ctx.iteration_failed = true;
              ctx.record(node.id, {
                status: will_retry ? 'retrying' : 'error',
                input,
                error: error.message,
                ms: Date.now() - started,
                attempt: this.retry_count,
              });
              throw error;
            }
          },
        });
        track(step, { node_id: node.id, kind: 'action' });
        return [step, ...after('main', outputOf(step.id, inputFn))];
      }

      case 'delay': {
        const step = track(new DelayStep({
          name: node.name,
          abort_signal: ctx.abort?.signal,
          relative_delay_ms: Math.min(24 * 3600e3, Math.max(0, Number(node.config.ms) || 0)),
        }), { node_id: node.id, kind: def.kind, inputFn });
        return [step, ...after('main')];
      }

      case 'break':
      case 'skip': {
        const step = track(new FlowControlStep({
          ...stepOptions(node, false),
          flow_control_type: def.kind,
          conditional: condition(node, inputFn),
        }), { node_id: node.id, kind: def.kind, inputFn });
        return [step, ...after('main')];
      }

      case 'if': {
        const true_wf = body(node, 'true', successors(node.id, 'true'), inputFn, next_stack);
        const false_wf = body(node, 'false', successors(node.id, 'false'), inputFn, next_stack);
        const step = track(new ConditionalStep({
          ...stepOptions(node, true),
          conditional: condition(node, inputFn),
          true_callable: true_wf,
          false_callable: false_wf,
        }), { node_id: node.id, kind: def.kind, inputFn });
        children.set(step.id, [{ label: 'true', workflow: true_wf }, { label: 'false', workflow: false_wf }]);
        return [step];
      }

      case 'switch': {
        const kids = [];
        const cases = (node.config.cases ?? []).map((kase, i) => {
          const port = `case-${i}`;
          const wf = body(node, port, successors(node.id, port), inputFn, next_stack);
          const case_step = new Case({
            name: `${node.name} case ${i + 1}`,
            conditional: { subject: null, operator: kase.op, value: conditionValue(kase.op, kase.value, inputFn, ctx) },
            callable: wf,
            max_timeout_ms: null,
          });
          track(case_step, { node_id: node.id, kind: 'case', port });
          kids.push({ label: `Case ${kase.op} ${kase.value ?? ''}`, workflow: wf });
          return case_step;
        });
        const default_wf = body(node, 'default', successors(node.id, 'default'), inputFn, next_stack);
        kids.push({ label: 'default', workflow: default_wf });
        const step = track(new SwitchStep({
          ...stepOptions(node, true),
          // A Case throws if the subject is null or undefined, so a missing
          // value is compared as ''.
          subject: () => getPath(inputFn(), node.config.path, ctx) ?? '',
          cases,
          default_callable: default_wf,
        }), { node_id: node.id, kind: def.kind, inputFn });
        children.set(step.id, kids);
        return [step];
      }

      case 'loop':
      case 'repeat':
      case 'while': {
        const collector = [];
        let loop_step = null;
        let outer_item = null;
        let pass_input = null;
        const itemFn = {
          loop: () => loop_step.current_item,
          repeat: () => {
            const input = inputFn();
            const base = input && typeof input === 'object' && !Array.isArray(input) ? input : { value: input };
            return { ...base, index: loop_step.results.length };
          },
          // Each pass of a while loop gets the previous pass's output.
          while: () => pass_input,
        }[def.kind];
        // The while condition reads the last pass's output.
        const wf = loopBody(node, itemFn, successors(node.id, 'each'), collector, next_stack, (last) => { pass_input = last; });

        const options = { ...stepOptions(node, true), max_iterations: max_loop_iterations, callable: wf };
        if (def.kind === 'loop') {
          loop_step = new LoopStep({
            ...options,
            loop_type: 'for_each',
            // A function iterable is called when the loop starts, so it reads
            // whatever the step before produced on this run.
            iterable: function loopItems() {
              const value = getPath(inputFn(), node.config.path, ctx);
              let items;
              if (Array.isArray(value)) items = value;
              else if (value && typeof value === 'object') items = Object.entries(value).map(([key, v]) => ({ key, value: v }));
              else items = value === undefined || value === null ? [] : [value];
              return items.slice(0, max_loop_iterations);
            },
          });
        } else if (def.kind === 'repeat') {
          loop_step = new LoopStep({
            ...options,
            loop_type: 'for',
            iterations: Math.max(0, Math.min(max_loop_iterations, Number(node.config.times) || 0)),
          });
        } else {
          loop_step = new LoopStep({
            ...options,
            loop_type: 'while',
            conditional: {
              subject: () => getPath(pass_input, node.config.path, ctx),
              operator: node.config.op,
              value: conditionValue(node.config.op, node.config.value, () => pass_input, ctx),
            },
          });
        }
        track(loop_step, { node_id: node.id, kind: def.kind, inputFn });
        children.set(loop_step.id, [{ label: 'each', workflow: wf }]);

        // Hidden steps around the loop: one resets the results and remembers
        // the outer $item, the other hands the results to the "done" branch.
        const start = new Step({
          name: `· ${node.name} start`,
          max_timeout_ms: null,
          callable: function loopStart() {
            checkStop();
            outer_item = ctx.item;
            collector.length = 0;
            pass_input = inputFn();
            // Repeat's count may be a {{ }} template, so it is resolved now,
            // just before the for LoopStep reads `iterations`.
            if (def.kind === 'repeat') {
              const times = Number(resolve(node.config.times, pass_input, ctx));
              loop_step.iterations = Math.max(0, Math.min(max_loop_iterations, Number.isFinite(times) ? Math.floor(times) : 0));
            }
          },
        });
        const done = new Step({
          name: `· ${node.name} done`,
          max_timeout_ms: null,
          callable: function loopDone() {
            ctx.item = outer_item;
            const results = [...collector];
            ctx.out.set(this.id, results);
            ctx.last = results;
            ctx.by_name.set(node.name, results);
            ctx.record(node.id, { status: 'success', input: inputFn(), output: results, note: `${loop_step.iterations} passes` });
          },
        });
        track(start, { node_id: null, kind: 'hidden' });
        track(done, { node_id: null, kind: 'hidden' });
        const group_wf = makeWorkflow(`${node.name} › loop`, [start, loop_step, done]);
        const group = new Step({ name: node.name, callable: group_wf, max_timeout_ms: null });
        track(group, { node_id: node.id, kind: 'group' });
        children.set(group.id, [{ label: 'callable', workflow: group_wf }]);
        // If the whole loop was skipped, its input passes on to the done branch.
        return [group, ...after('done', outputOf(done.id, inputFn))];
      }

      default:
        throw new GraphError(`Node type "${node.type}" can't be compiled.`, node.id);
    }
  }

  const root = makeWorkflow(graph.name || 'flow', chain({ id: null, to: trigger.id }, () => undefined, []));
  return { root, trigger, steps, children, workflows };
}

// A plain description of the compiled tree, for the editor's micro-flow tab.
export function describeTree(compiled) {
  const { root, steps, children } = compiled;
  const describeWorkflow = (wf) => ({
    workflow: wf.name,
    steps: wf._steps.map((step) => ({
      name: step.name,
      class: step instanceof MicroDelayStep ? 'DelayStep' : step.constructor.name,
      node_id: steps.get(step.id)?.node_id ?? null,
      detail: step.loop_type ?? step.flow_control_type ?? (step.relative_delay_ms != null ? `${step.relative_delay_ms} ms` : undefined),
      children: (children.get(step.id) ?? []).map(({ label, workflow }) => ({ label, ...describeWorkflow(workflow) })),
    })),
  });
  return describeWorkflow(root);
}
