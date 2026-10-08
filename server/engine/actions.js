// What each action/trigger node does when its Step runs on the server.
// run(input, config, ctx) returns the node's output. ctx is the per-execution
// context built by runner.js (see the comment there).
import dns from 'dns/promises';
import net from 'net';
import { getPath, setPath, resolve, resolveText, parseLines } from '../../shared/nodes.js';

const asObject = (input) =>
  input && typeof input === 'object' && !Array.isArray(input) ? { ...input } : { value: input };

function list(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return value === undefined || value === null ? [] : [value];
}

const compare = (a, b) => (a > b ? 1 : a < b ? -1 : 0);

function parseJson(text, what) {
  try {
    return JSON.parse(text || '{}');
  } catch (error) {
    throw new Error(`${what} is not valid JSON: ${error.message}`);
  }
}

function transform(input, c, ctx) {
  const source = c.path ? getPath(input, c.path, ctx) : input;
  const field = (item) => (c.field ? getPath(item, c.field) : item);
  const n = Math.max(0, Number(c.n) || 0);
  switch (c.op) {
    case 'get': return source;
    case 'add': return (Number(source) || 0) + (Number(c.n) || 0);
    case 'pluck': return list(source).map(field);
    case 'length': return typeof source === 'string' ? source.length : list(source).length;
    case 'first': return list(source).slice(0, n);
    case 'last': return n ? list(source).slice(-n) : [];
    case 'sum': return list(source).reduce((total, item) => total + (Number(field(item)) || 0), 0);
    case 'sort': return [...list(source)].sort((a, b) => compare(field(a), field(b)));
    case 'reverse': return [...list(source)].reverse();
    case 'unique': {
      const seen = new Set();
      return list(source).filter((item) => {
        const key = JSON.stringify(field(item));
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    case 'random': { const items = list(source); return items[Math.floor(Math.random() * items.length)]; }
    case 'shuffle': {
      const items = [...list(source)];
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      return items;
    }
    case 'keys': return Object.keys(source ?? {});
    case 'values': return Object.values(source ?? {});
    case 'join': return list(source).map((v) => (typeof v === 'object' ? JSON.stringify(v) : v)).join(c.field ?? ',');
    case 'split': return String(source ?? '').split(c.field || ',');
    case 'upper': return String(source ?? '').toUpperCase();
    case 'lower': return String(source ?? '').toLowerCase();
    case 'match': {
      const match = String(source ?? '').match(new RegExp(c.field));
      return match ? (match[1] ?? match[0]) : null;
    }
    case 'parse_json': return typeof source === 'string' ? parseJson(source, 'Source') : source;
    case 'stringify': return JSON.stringify(source);
    default: return source;
  }
}

// --- SSRF guard (only when ctx.block_private_networks is on) ---
function isPrivate(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const lower = address.toLowerCase();
  if (lower.startsWith('::ffff:')) return isPrivate(lower.slice(7));
  return lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

async function assertPublic(url) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (addresses.some(({ address }) => isPrivate(address))) {
    throw new Error(`blocked: ${host} resolves to a private address (BLOCK_PRIVATE_NETWORKS is on)`);
  }
}

async function guardedFetch(url, options, block_private_networks) {
  if (!block_private_networks) return fetch(url, options);
  // Follow redirects by hand so every hop is checked.
  let current = new URL(url);
  for (let hop = 0; hop < 5; hop++) {
    if (!['http:', 'https:'].includes(current.protocol)) throw new Error(`unsupported protocol ${current.protocol}`);
    await assertPublic(current);
    const res = await fetch(current, { ...options, redirect: 'manual' });
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) return res;
    current = new URL(location, current);
    if (res.status === 303) options = { ...options, method: 'GET', body: undefined };
  }
  throw new Error('too many redirects');
}

const MAX_BODY = 5 * 1024 * 1024;

async function httpRequest(input, c, ctx, timeout_ms) {
  const url = resolveText(c.url, input, ctx).trim();
  if (!/^https?:\/\//i.test(url)) throw new Error(`URL must start with http:// or https:// (got "${url}")`);

  const headers = Object.fromEntries(parseLines(c.headers, ':').map(([k, v]) => [k, resolveText(v, input, ctx)]));
  const options = { method: c.method || 'GET', headers };
  if (!['GET', 'DELETE', 'HEAD'].includes(options.method) && String(c.body ?? '').trim() !== '') {
    const body = resolve(c.body, input, ctx);
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
      headers['content-type'] = typeof body === 'string' && !/^\s*[[{]/.test(body) ? 'text/plain' : 'application/json';
    }
  }

  // Abort when the user stops the run, or when the step's own timeout passes
  // (micro-flow stops waiting at that point, but fetch would keep going).
  const signals = [ctx.abort.signal];
  if (timeout_ms) signals.push(AbortSignal.timeout(timeout_ms));
  options.signal = AbortSignal.any(signals);

  const res = await guardedFetch(url, options, ctx.block_private_networks);
  const text = await res.text();
  if (text.length > MAX_BODY) throw new Error(`response is larger than ${MAX_BODY / 1024 / 1024} MB`);
  let body = text;
  if (/json/i.test(res.headers.get('content-type') ?? '') || /^\s*[[{]/.test(text)) {
    try { body = JSON.parse(text); } catch { /* keep text */ }
  }
  if (c.response === 'full') {
    return { status: res.status, headers: Object.fromEntries(res.headers), body };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}`);
  return body;
}

export const ACTIONS = {
  // The runtime can pass a payload in; the editor's Run uses the node's JSON.
  manual: (input, c, ctx) => ctx.trigger_payload ?? parseJson(c.json, 'Output JSON'),

  schedule: () => ({ timestamp: new Date().toISOString() }),

  // A real request passes its payload in; Run in the editor uses the sample.
  webhook: (input, c, ctx) => ctx.trigger_payload ?? {
    method: c.method === 'ANY' ? 'POST' : c.method,
    path: c.path,
    query: {},
    headers: {},
    body: parseJson(c.sample, 'Test body'),
  },

  http: (input, c, ctx, step) => httpRequest(input, c, ctx, step.max_timeout_ms),

  set(input, c, ctx) {
    const out = c.mode === 'replace' ? {} : asObject(input);
    for (const [key, value] of parseLines(c.assignments)) setPath(out, key, resolve(value, input, ctx));
    return out;
  },

  transform(input, c, ctx) {
    const result = transform(input, c, ctx);
    if (!c.into) return result;
    const out = asObject(input);
    setPath(out, c.into, result);
    return out;
  },

  random(input, c) {
    const min = Math.ceil(Number(c.min));
    const max = Math.floor(Number(c.max));
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) throw new Error('min and max must be numbers, with min ≤ max');
    const out = asObject(input);
    setPath(out, c.field || 'value', min + Math.floor(Math.random() * (max - min + 1)));
    return out;
  },

  async chaos(input, c, ctx) {
    await ctx.sleep(Number(c.latency_ms) || 0);
    if (Math.random() * 100 < Number(c.fail_pct)) throw new Error('chaos monkey struck');
    return input;
  },

  output(input, c, ctx) {
    ctx.output({
      title: resolveText(c.title, input, ctx),
      image: resolveText(c.image, input, ctx),
      text: resolveText(c.text, input, ctx),
      tone: c.tone,
    });
    return input;
  },

  log(input, c, ctx) {
    ctx.log(resolveText(c.message, input, ctx), c.level || 'info');
    return input;
  },

  respond(input, c, ctx) {
    if (!ctx.response) {
      const status = Math.min(599, Math.max(100, Number(c.status) || 200));
      let body = c.content_type === 'application/json' ? resolve(c.body, input, ctx) : resolveText(c.body, input, ctx);
      // JSON written with {{ }} inside it resolves to text; send it as JSON.
      if (c.content_type === 'application/json' && typeof body === 'string') {
        try { body = JSON.parse(body); } catch { /* send the string */ }
      }
      ctx.response = { status, content_type: c.content_type, body };
    }
    return input;
  },
};
