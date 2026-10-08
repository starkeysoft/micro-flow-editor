// The per-run context that node actions and compiled steps share. Both the
// editor's server (runner.js) and the standalone runtime (runtime/index.js)
// create one per run and pass in callbacks for what a run reports.
//
//   out, failed        step id → output / step ids that failed
//   last, item         the latest output / the innermost loop's current item
//   trigger            the trigger's output         by_name  node name → output
//   trigger_payload    what a webhook/schedule passed in
//   execution          { id, mode }                 response the Respond node's reply
//   stopped, abort     set by stop()                iteration_failed (loops)
//   block_private_networks  SSRF guard for HTTP Request nodes
//   record(node_id, entry), output(card), log(text, level), sleep(ms)
import { StopError } from './compile.js';

export function createContext({
  trigger_payload = null,
  execution = null,
  block_private_networks = false,
  record = () => {},
  output = () => {},
  log = () => {},
} = {}) {
  const abort = new AbortController();
  return {
    out: new Map(),
    failed: new Set(),
    by_name: new Map(),
    last: undefined,
    item: undefined,
    trigger: undefined,
    trigger_payload,
    execution,
    response: null,
    stopped: false,
    iteration_failed: false,
    block_private_networks,
    abort,
    sleep: (ms) => new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      abort.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new StopError('stopped by user')); }, { once: true });
    }),
    record,
    output,
    log,
  };
}

export function stopContext(ctx) {
  ctx.stopped = true;
  ctx.abort.abort();
}

// Runs a compiled root Workflow and sums up how it ended.
export async function executeRoot(root, ctx) {
  let status = 'success';
  let error = null;
  try {
    await root.execute();
    if (ctx.stopped) {
      status = 'stopped';
    } else if (root.status === 'failed') {
      status = 'error';
      error = root.results?.at(-1)?.data?.error?.message ?? 'the flow failed';
    }
  } catch (e) {
    status = ctx.stopped || e instanceof StopError ? 'stopped' : 'error';
    error = e.message;
  }
  if (status === 'stopped') error = 'stopped by user';
  return { status, error };
}
