// Editor autosave: a write-behind cache in front of the flows table, plus the
// snapshots that Save creates.
//
// Every change the editor makes is sent to PUT /api/flows/:id/draft, which
// only writes it into the cache (fast, so dragging a node never waits on the
// database). A background worker flushes changed flows to the database every
// FLUSH_INTERVAL_MS, as an UPDATE of the flow's own row. Anything that reads a
// flow flushes it first, and shutdown flushes everything, so the database
// stays the source of truth.
//
// Cache stores (picked at startup):
// - memory (default): a Map in this process. Nothing else to run; a hard
//   crash loses at most the last FLUSH_INTERVAL_MS of edits.
// - redis (REDIS_URL set): drafts live in Redis, so they survive a crash or
//   restart of this process and several editor instances can share them.
//
// A draft is { name, description, graph, options, version, updated_at }.
// `version` is unique per write: after a flush, the draft is cleared only if
// no newer write arrived meanwhile (compare-and-delete), so no edit is lost.
import crypto from 'crypto';
import { config } from './config.js';
import { Flow, Snapshot } from './db.js';

class MemoryStore {
  kind = 'memory';
  #drafts = new Map();

  async put(id, draft) { this.#drafts.set(id, draft); }
  async get(id) { return this.#drafts.get(id) ?? null; }
  async dirty() { return [...this.#drafts.keys()]; }
  async settle(id, version) {
    if (this.#drafts.get(id)?.version === version) this.#drafts.delete(id);
  }
  async drop(id) { this.#drafts.delete(id); }
  async close() {}
}

// Drafts as hashes { version, data } plus a set of dirty flow ids.
const SETTLE_SCRIPT = `
if redis.call('HGET', KEYS[1], 'version') == ARGV[1] then
  redis.call('DEL', KEYS[1])
  redis.call('SREM', KEYS[2], ARGV[2])
  return 1
end
return 0`;

class RedisStore {
  kind = 'redis';

  constructor(client, prefix = 'micro-flow-editor:') {
    this.client = client;
    this.key = (id) => `${prefix}draft:${id}`;
    this.dirty_key = `${prefix}dirty`;
  }

  async put(id, draft) {
    await this.client.multi()
      .hSet(this.key(id), { version: draft.version, data: JSON.stringify(draft) })
      .sAdd(this.dirty_key, id)
      .exec();
  }

  async get(id) {
    const data = await this.client.hGet(this.key(id), 'data');
    return data ? JSON.parse(data) : null;
  }

  async dirty() { return this.client.sMembers(this.dirty_key); }

  async settle(id, version) {
    await this.client.eval(SETTLE_SCRIPT, { keys: [this.key(id), this.dirty_key], arguments: [version, id] });
  }

  async drop(id) {
    await this.client.multi().del(this.key(id)).sRem(this.dirty_key, id).exec();
  }

  async close() { await this.client.quit(); }
}

async function createStore() {
  if (!config.redis_url) return new MemoryStore();
  let createClient;
  try {
    ({ createClient } = await import('redis'));
  } catch {
    throw new Error('REDIS_URL is set but the "redis" package isn\'t installed (npm install redis).');
  }
  const client = createClient({ url: config.redis_url });
  client.on('error', (error) => console.error(`Redis: ${error.message}`));
  await client.connect();
  return new RedisStore(client);
}

let store = new MemoryStore();
let timer = null;
const in_flight = new Map(); // flow id → promise of a running flush

export const cacheKind = () => store.kind;

/** Connects the cache and starts the background flush worker. */
export async function startDraftWorker() {
  store = await createStore();
  timer = setInterval(() => {
    flushAll().catch((error) => console.error(`Autosave flush failed: ${error.message}`));
  }, config.flush_interval_ms);
  timer.unref();
}

/** Stops the worker after writing every pending draft. */
export async function stopDraftWorker() {
  clearInterval(timer);
  timer = null;
  await flushAll();
  await store.close();
  store = new MemoryStore();
}

/** Puts an editor change in the cache. The worker writes it to the database. */
export async function saveDraft(flow_id, draft) {
  const full = {
    ...draft,
    version: `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`,
    updated_at: new Date().toISOString(),
  };
  await store.put(flow_id, full);
  return { version: full.version, updated_at: full.updated_at, cache: store.kind };
}

/** Writes a flow's pending draft (if any) to its row. Returns true if it wrote. */
export function flush(flow_id) {
  // One flush per flow at a time; callers share it.
  if (in_flight.has(flow_id)) return in_flight.get(flow_id);
  const run = (async () => {
    const draft = await store.get(flow_id);
    if (!draft) return false;
    const flow = await Flow.findByPk(flow_id);
    if (!flow) {
      await store.drop(flow_id); // the flow was deleted
      return false;
    }
    await flow.update({ name: draft.name, description: draft.description, graph: draft.graph, options: draft.options });
    await store.settle(flow_id, draft.version);
    return true;
  })().finally(() => in_flight.delete(flow_id));
  in_flight.set(flow_id, run);
  return run;
}

/** Flushes every pending draft. One failing flow doesn't stop the others. */
export async function flushAll() {
  const ids = await store.dirty();
  const results = await Promise.allSettled(ids.map((id) => flush(id)));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) throw new Error(`${failed.length} flow(s) not written: ${failed[0].reason?.message}`);
  return ids.length;
}

/** Forgets a pending draft (the flow was deleted, or replaced through PUT). */
export const discard = (flow_id) => store.drop(flow_id);

// ── Snapshots ──
export const latestSnapshot = (flow_id) => Snapshot.findOne({
  where: { flow_id },
  order: [['createdAt', 'DESC'], ['id', 'DESC']],
});

export async function createSnapshot(flow, { label = '', created_by = null } = {}) {
  const snapshot = await Snapshot.create({
    flow_id: flow.id,
    label: String(label ?? '').slice(0, 200),
    name: flow.name,
    description: flow.description,
    graph: flow.graph,
    options: flow.options,
    created_by,
  });
  await pruneSnapshots(flow.id);
  return snapshot;
}

async function pruneSnapshots(flow_id) {
  if (!config.max_snapshots_per_flow) return;
  const old = await Snapshot.findAll({
    where: { flow_id },
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    offset: config.max_snapshots_per_flow,
    attributes: ['id'],
  });
  if (old.length) await Snapshot.destroy({ where: { id: old.map((s) => s.id) } });
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** True when the flow differs from its latest snapshot (or it has none). */
export async function hasUnsnapshottedChanges(flow) {
  const latest = await latestSnapshot(flow.id);
  return !latest
    || latest.name !== flow.name
    || latest.description !== flow.description
    || !sameJson(latest.graph, flow.graph)
    || !sameJson(latest.options, flow.options);
}

/**
 * What active triggers run: the latest snapshot, or the flow itself when it
 * has never been saved as a snapshot (flows from before snapshots existed).
 */
export async function liveVersion(flow) {
  const latest = await latestSnapshot(flow.id);
  return latest
    ? { graph: latest.graph, options: latest.options, snapshot_id: latest.id }
    : { graph: flow.graph, options: flow.options, snapshot_id: null };
}
