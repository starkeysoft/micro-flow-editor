// Turns micro-flow's step/workflow events into per-node records.
//
// Action nodes record their own runs (compile.js). Control nodes (If, Switch,
// Filter, Skip Next If, Wait, loops) have no callable of ours, so they are
// recorded here from the events micro-flow emits for their steps. Retries,
// skips and breaks are reported here too.
//
// micro-flow's events are process-wide, so one set of listeners (installed on
// first use) routes each event to its run through `watched`, a map from
// compiled step id to the observation that owns it.
import { Workflow } from '@ronaldroe/micro-flow';

const watched = new Map(); // step id → { compiled, ctx, hooks, branch }
let installed = false;

// Kinds recorded from step_complete (their input passes straight through).
const CONTROL = new Set(['if', 'switch', 'break', 'skip', 'delay']);

/**
 * Starts routing events for a compiled flow's steps.
 * @param {object} compiled - compileGraph() result.
 * @param {object} ctx - The run's context (its record() receives control-node runs).
 * @param {object} [hooks] - running(node_id), done(node_id), log({ event, node_id, level, text }), nameOf(node_id)
 * @returns {() => void} Stops observing.
 */
export function observe(compiled, ctx, hooks = {}) {
  install();
  const observation = { compiled, ctx, hooks, branch: new Map() };
  for (const id of compiled.steps.keys()) watched.set(id, observation);
  return () => {
    for (const id of compiled.steps.keys()) if (watched.get(id) === observation) watched.delete(id);
  };
}

function safeInput(entry) {
  try { return entry.inputFn?.(); } catch { return undefined; }
}

function lookup(step_id) {
  const observation = watched.get(step_id);
  const entry = observation?.compiled.steps.get(step_id);
  return entry ? { observation, entry } : null;
}

function install() {
  if (installed) return;
  installed = true;
  const name = (o, node_id) => o.hooks.nameOf?.(node_id) ?? node_id;

  const step_events = {
    step_running({ observation: o, entry }) {
      if (entry.kind === 'case') {
        // The Case that runs tells us which Switch branch was taken.
        o.branch.set(entry.node_id, entry.port);
        return;
      }
      if (!entry.node_id) return;
      // Forget the previous pass's branch (an If or Switch inside a loop).
      if (entry.kind === 'if' || entry.kind === 'switch') o.branch.delete(entry.node_id);
      o.hooks.running?.(entry.node_id);
    },
    step_retrying({ observation: o, entry }, detail) {
      if (!entry.node_id || entry.kind === 'case') return;
      o.hooks.log?.({
        event: 'step_retrying', node_id: entry.node_id, level: 'warn',
        text: `${name(o, entry.node_id)}: retry ${detail.retry_count} of ${detail.max_retries}`,
      });
    },
    step_complete({ observation: o, entry }) {
      if (!entry.node_id || entry.kind === 'case') return;
      if (CONTROL.has(entry.kind)) {
        const input = safeInput(entry);
        const branch = entry.kind === 'switch' ? o.branch.get(entry.node_id) ?? 'default' : o.branch.get(entry.node_id);
        o.ctx.record(entry.node_id, { status: 'success', input, output: input, ...(branch ? { branch } : {}) });
      }
      o.hooks.done?.(entry.node_id);
    },
    step_failed({ observation: o, entry }) {
      if (!entry.node_id || entry.kind === 'case') return;
      // Action nodes record their own errors; a loop's group step fails along
      // with the loop step, which records it.
      if (entry.kind !== 'action' && entry.kind !== 'group') {
        o.ctx.record(entry.node_id, { status: 'error', error: 'a step inside this node or its branch failed' });
      }
      o.hooks.done?.(entry.node_id);
    },
    conditional_true_branch_executed: ({ observation: o, entry }) => o.branch.set(entry.node_id, 'true'),
    conditional_false_branch_executed: ({ observation: o, entry }) => o.branch.set(entry.node_id, 'false'),
  };

  for (const [event_name, handler] of Object.entries(step_events)) {
    Workflow.events.step.on(event_name, (detail) => {
      const found = lookup(detail?.id);
      if (found) handler(found, detail);
    });
  }

  Workflow.events.workflow.on('workflow_step_skipped', (detail) => {
    const found = lookup(detail?.step?.id);
    if (!found?.entry.node_id) return;
    found.observation.ctx.record(found.entry.node_id, { status: 'skipped', note: 'skipped by Skip Next If' });
  });

  Workflow.events.workflow.on('workflow_break_executed', (detail) => {
    const found = lookup(detail?.step?.id);
    if (!found) return;
    found.observation.hooks.log?.({ event: 'workflow_break_executed', text: `Filter stopped the branch "${detail.workflow?.name ?? ''}"` });
  });
}
