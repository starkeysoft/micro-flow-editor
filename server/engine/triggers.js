// Listens on the Schedule and Webhook triggers of active flows.
//
// Cron schedules use node-schedule (the scheduler micro-flow's DelayStep
// uses); "every N minutes" schedules use setInterval.
// Webhooks are kept in a map from "METHOD path" to { flow_id, trigger_id },
// which api/webhooks.js looks up for every /webhook/* request.
import schedule from 'node-schedule';
import { Flow } from '../db.js';
import { runFlow } from './runner.js';

const jobs = new Map();      // flow id → [Job]
const webhooks = new Map();  // `${METHOD} ${path}` → { flow_id, trigger_id }

export const normalizePath = (path) => String(path ?? '').trim().replace(/^\/+|\/+$/g, '');

const webhookKeys = (node) => {
  const path = normalizePath(node.config.path);
  const methods = node.config.method === 'ANY' ? ['ANY'] : [node.config.method || 'POST'];
  return methods.map((m) => `${m} ${path}`);
};

export function findWebhook(method, path) {
  const clean = normalizePath(path);
  return webhooks.get(`${method} ${clean}`) ?? webhooks.get(`ANY ${clean}`) ?? null;
}

// Throws if another active flow already listens on one of this flow's webhooks.
export function checkWebhookConflicts(flow) {
  for (const node of flow.graph.nodes.filter((n) => n.type === 'webhook')) {
    const path = normalizePath(node.config.path);
    if (!path) throw new Error(`Webhook "${node.name}" needs a path.`);
    if (!/^[\w\-./]+$/.test(path)) throw new Error(`Webhook path "${path}" may only use letters, numbers, - _ . and /.`);
    for (const key of webhookKeys(node)) {
      const [method] = key.split(' ');
      const clashes = [...webhooks.entries()].filter(([k, v]) => {
        if (v.flow_id === flow.id) return false;
        const [m, p] = k.split(' ');
        return p === path && (m === method || m === 'ANY' || method === 'ANY');
      });
      if (clashes.length) throw new Error(`Another active flow already listens on /webhook/${path}.`);
    }
  }
}

function scheduleRule(node) {
  if (node.config.mode === 'cron') return String(node.config.cron ?? '').trim();
  const minutes = Math.max(1, Math.floor(Number(node.config.minutes) || 0));
  return minutes;
}

export function unregister(flow_id) {
  for (const job of jobs.get(flow_id) ?? []) job.cancel();
  jobs.delete(flow_id);
  for (const [key, value] of webhooks) if (value.flow_id === flow_id) webhooks.delete(key);
}

// (Re)registers a flow's triggers. Inactive flows just get unregistered.
export function register(flow) {
  unregister(flow.id);
  if (!flow.active) return;

  checkWebhookConflicts(flow);
  for (const node of flow.graph.nodes.filter((n) => n.type === 'webhook')) {
    for (const key of webhookKeys(node)) webhooks.set(key, { flow_id: flow.id, trigger_id: node.id });
  }

  const flow_jobs = [];
  for (const node of flow.graph.nodes.filter((n) => n.type === 'schedule')) {
    const rule = scheduleRule(node);
    const fire = async () => {
      // Read the latest saved version, so edits apply without re-activating.
      const current = await Flow.findByPk(flow.id);
      if (!current?.active) return;
      try {
        await runFlow({ flow: current, mode: 'schedule', trigger_id: node.id });
      } catch (error) {
        console.error(`Scheduled run of "${current.name}" failed to start: ${error.message}`);
      }
    };
    let job;
    if (typeof rule === 'number') {
      const every = rule * 60 * 1000;
      const timer = setInterval(fire, every);
      job = { cancel: () => clearInterval(timer) };
    } else {
      job = schedule.scheduleJob(rule, fire);
      if (!job) throw new Error(`"${rule}" is not a valid cron expression (Schedule "${node.name}").`);
    }
    flow_jobs.push(job);
  }
  jobs.set(flow.id, flow_jobs);
}

export async function registerAll() {
  for (const flow of await Flow.findAll({ where: { active: true } })) {
    try {
      register(flow);
    } catch (error) {
      console.error(`Could not activate "${flow.name}": ${error.message}`);
      unregister(flow.id);
    }
  }
}

export const triggerSummary = (flow_id) => ({
  webhooks: [...webhooks.entries()].filter(([, v]) => v.flow_id === flow_id).map(([k]) => k),
  schedules: jobs.get(flow_id)?.length ?? 0,
});

export function unregisterAll() {
  for (const flow_id of [...jobs.keys()]) unregister(flow_id);
  webhooks.clear();
}
