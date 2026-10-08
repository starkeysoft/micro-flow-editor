// The node catalogue, shared by the editor (palette, inspector, port layout)
// and the server (compiling a graph into micro-flow steps). It has no
// imports, so browsers load it as-is from /shared/nodes.js.
//
// A graph is { nodes: [{ id, type, name, x, y, config, settings }],
//              edges: [{ id, from, port, to }] }.
// What an action node does when it runs lives in server/engine/actions.js.

// --- Paths and templates ---
// A path like `types[0].type.name` reads from the node's input. Other roots:
//   $item       the current item of the innermost loop
//   $trigger    the trigger's output
//   $node[...]  the last output of a node, by name: $node["Fetch user"].id
//   $now        the current time (ISO string)
//   $execution  { id, mode }
// `$` or an empty path is the input itself.
const ROOTS = ['$item', '$trigger', '$node', '$now', '$execution'];

export function getPath(input, path, ctx = {}) {
  let text = String(path ?? '').trim();
  let base = input;
  const root = ROOTS.find((r) => text === r || text.startsWith(`${r}.`) || text.startsWith(`${r}[`));
  if (root) {
    text = text.slice(root.length);
    base = {
      $item: ctx.item,
      $trigger: ctx.trigger,
      $node: ctx.by_name ? Object.fromEntries(ctx.by_name) : {},
      $now: new Date().toISOString(),
      $execution: ctx.execution,
    }[root];
  } else if (text.startsWith('$')) {
    text = text.slice(1);
  }
  const parts = text.split(/[.[\]'"]/).filter(Boolean);
  let value = base;
  for (const part of parts) {
    if (value === null || value === undefined) return undefined;
    value = value[part];
  }
  return value;
}

export function setPath(target, path, value) {
  const parts = String(path).split(/[.[\]'"]/).filter(Boolean);
  if (parts.length === 0) return;
  let current = target;
  parts.slice(0, -1).forEach((part, i) => {
    if (typeof current[part] !== 'object' || current[part] === null) {
      current[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    }
    current = current[part];
  });
  current[parts.at(-1)] = value;
}

const WHOLE = /^\{\{\s*([^}]*?)\s*\}\}$/;

// '{{ a.b }}' on its own returns the raw value (a number stays a number);
// mixed text returns a string. Text with no {{ }} is auto-typed.
export function resolve(template, input, ctx) {
  const text = String(template ?? '');
  const whole = text.trim().match(WHOLE);
  if (whole) return getPath(input, whole[1], ctx);
  if (!text.includes('{{')) return autoType(text);
  return text.replace(/\{\{\s*([^}]*?)\s*\}\}/g, (_, path) => {
    const value = getPath(input, path, ctx);
    if (value === undefined || value === null) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}

// Like resolve(), but always a string (for URLs, headers and messages).
export const resolveText = (template, input, ctx) => {
  const value = resolve(template, input, ctx);
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

export function autoType(text) {
  const t = String(text).trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  if (t !== '' && !Number.isNaN(Number(t))) return Number(t);
  return text;
}

// "key = value" (or "key: value") lines, as used by Edit Fields and headers.
export function parseLines(text, separator = '=') {
  const pattern = separator === ':' ? /^\s*([^:]+?)\s*:\s*(.*)$/ : /^\s*([^=]+?)\s*=\s*(.*)$/;
  return String(text ?? '').split('\n')
    .map((line) => line.match(pattern))
    .filter(Boolean)
    .map(([, key, value]) => [key, value]);
}

// --- Conditions ---
// Every micro-flow comparator except custom_function (which would need code).
export const OPERATORS = [
  ['===', 'is (===)'], ['!==', 'is not (!==)'], ['==', '== (loose)'], ['!=', '!= (loose)'],
  ['>', '>'], ['>=', '>='], ['<', '<'], ['<=', '<='],
  ['string_contains', 'text contains'], ['string_not_contains', 'text does not contain'],
  ['string_starts_with', 'starts with'], ['string_ends_with', 'ends with'],
  ['array_contains', 'list contains'], ['array_not_contains', 'list does not contain'],
  ['in', 'is one of (a, b, c)'], ['not_in', 'is none of (a, b, c)'],
  ['regex_match', 'matches regex'], ['regex_not_match', 'does not match regex'],
  ['empty', 'is empty'], ['not_empty', 'is not empty'],
  ['nullish', 'is null / missing'], ['not_nullish', 'exists'],
  ['is_type', 'is type'], ['is_not_type', 'is not type'],
];

const NO_VALUE = new Set(['empty', 'not_empty', 'nullish', 'not_nullish']);
const TEXT_VALUE = new Set([
  'string_contains', 'string_not_contains', 'string_starts_with', 'string_ends_with',
  'regex_match', 'regex_not_match', 'is_type', 'is_not_type',
]);

export const needsValue = (op) => !NO_VALUE.has(op);

// The value side of a condition. A value with {{ }} becomes a function, which
// micro-flow calls each time it checks the condition.
export function conditionValue(op, raw, inputFn, ctx) {
  if (NO_VALUE.has(op)) return null;
  const text = String(raw ?? '');
  if (text.includes('{{')) return () => resolve(text, inputFn(), ctx);
  if (op === 'in' || op === 'not_in') return text.split(',').map((s) => autoType(s.trim()));
  if (TEXT_VALUE.has(op)) return text;
  return autoType(text);
}

export const opLabel = (op) => OPERATORS.find(([v]) => v === op)?.[1] ?? op;

export function describeCondition(path, op, value) {
  return `${path || '$'} ${opLabel(op)}${needsValue(op) ? ` ${value}` : ''}`;
}

// --- Node types ---
// group:   palette section.        kind:    how the compiler builds it.
// micro:   the micro-flow class it compiles to (shown in the inspector).
// inputs:  false for triggers.     outputs: port names, or a function of config.
// fields:  inspector form. kind is text | textarea | json | number | select |
//          operator | cases | checkbox; show(config) hides a field.
export const TRANSFORM_OPS = [
  ['get', 'get value at path'], ['add', 'add N (number)'], ['pluck', 'pluck field from each item'], ['length', 'count items'],
  ['first', 'first N items'], ['last', 'last N items'], ['sum', 'sum (of field)'],
  ['sort', 'sort by field'], ['reverse', 'reverse list'], ['unique', 'unique values'],
  ['random', 'random item'], ['shuffle', 'shuffle'], ['keys', 'object keys'], ['values', 'object values'],
  ['join', 'join list into text'], ['split', 'split text into list'],
  ['upper', 'uppercase text'], ['lower', 'lowercase text'],
  ['match', 'regex match (first group)'], ['parse_json', 'parse JSON text'], ['stringify', 'JSON stringify'],
];

const TONES = [['violet', 'violet'], ['red', 'red'], ['blue', 'blue'], ['green', 'green'], ['amber', 'amber'], ['slate', 'slate']];

const CONDITION_FIELDS = [
  { key: 'path', label: 'Value at path', kind: 'text', placeholder: 'e.g. status or $item.id' },
  { key: 'op', label: 'Operator', kind: 'operator' },
  { key: 'value', label: 'Compare with', kind: 'text', show: (c) => needsValue(c.op) },
];

const trim = (text, n = 34) => {
  const s = String(text ?? '');
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

export const NODE_TYPES = {
  // ── Triggers ──
  manual: {
    title: 'Manual Trigger', group: 'Triggers', icon: '▶', kind: 'trigger', color: '#22c55e',
    micro: 'Workflow + Step', inputs: false, outputs: ['main'],
    blurb: 'Starts the flow when you press Run in the editor. Its output is the JSON below.',
    defaults: { json: '{}' },
    fields: [{ key: 'json', label: 'Output JSON', kind: 'json' }],
    summary: (c) => trim(String(c.json).replace(/\s+/g, ' ')),
  },

  schedule: {
    title: 'Schedule Trigger', group: 'Triggers', icon: '◷', kind: 'trigger', color: '#10b981',
    micro: 'Workflow + Step', inputs: false, outputs: ['main'],
    blurb: 'Runs the flow on a schedule while the flow is active: every N minutes, or on a cron expression (minute hour day month weekday). Outputs { timestamp }. Run also starts it by hand.',
    defaults: { mode: 'interval', minutes: 5, cron: '0 9 * * 1-5' },
    fields: [
      { key: 'mode', label: 'Mode', kind: 'select', options: [['interval', 'every N minutes'], ['cron', 'cron expression']] },
      { key: 'minutes', label: 'Minutes', kind: 'number', show: (c) => c.mode !== 'cron' },
      { key: 'cron', label: 'Cron', kind: 'text', show: (c) => c.mode === 'cron', placeholder: '*/15 * * * *' },
    ],
    summary: (c) => (c.mode === 'cron' ? `cron ${c.cron}` : `every ${c.minutes} min`),
  },

  webhook: {
    title: 'Webhook Trigger', group: 'Triggers', icon: '⚓', kind: 'trigger', color: '#14b8a6',
    micro: 'Workflow + Step', inputs: false, outputs: ['main'],
    blurb: 'Runs the flow when a request hits /webhook/<path> while the flow is active. Outputs { method, path, query, headers, body }. The caller gets what a Respond node sends, or the last output.',
    defaults: { path: 'my-hook', method: 'POST', sample: '{ "hello": "world" }' },
    fields: [
      { key: 'path', label: 'Path', kind: 'text', placeholder: 'my-hook' },
      { key: 'method', label: 'Method', kind: 'select', options: [['POST', 'POST'], ['GET', 'GET'], ['PUT', 'PUT'], ['PATCH', 'PATCH'], ['DELETE', 'DELETE'], ['ANY', 'any method']] },
      { key: 'sample', label: 'Test body (used by Run)', kind: 'json' },
    ],
    summary: (c) => `${c.method} /webhook/${c.path}`,
  },

  // ── Data ──
  http: {
    title: 'HTTP Request', group: 'Data', icon: '⇄', kind: 'action', color: '#38bdf8',
    micro: 'Step', outputs: ['main'],
    blurb: 'Calls a URL from the server and outputs the response body (parsed as JSON when possible). Use {{ path }} anywhere to build it from the input. Give it retries and a timeout in Settings.',
    defaults: { method: 'GET', url: 'https://pokeapi.co/api/v2/pokemon/{{id}}', headers: '', body: '', response: 'auto' },
    fields: [
      { key: 'method', label: 'Method', kind: 'select', options: [['GET', 'GET'], ['POST', 'POST'], ['PUT', 'PUT'], ['PATCH', 'PATCH'], ['DELETE', 'DELETE']] },
      { key: 'url', label: 'URL', kind: 'text' },
      { key: 'headers', label: 'Headers (Name: value per line)', kind: 'textarea' },
      { key: 'body', label: 'Body (JSON or text)', kind: 'textarea', show: (c) => !['GET', 'DELETE'].includes(c.method) },
      { key: 'response', label: 'Output', kind: 'select', options: [['auto', 'body (JSON if possible)'], ['full', '{ status, headers, body }']] },
    ],
    summary: (c) => `${c.method} ${trim(String(c.url).replace(/^https?:\/\//, ''), 30)}`,
  },

  set: {
    title: 'Edit Fields', group: 'Data', icon: '✎', kind: 'action', color: '#a78bfa',
    micro: 'Step', outputs: ['main'],
    blurb: 'Sets fields, one "key = value" per line. Values can use {{ path }}, {{ $item.x }}, {{ $trigger.x }} or {{ $node["Name"].x }}. "Keep only these" drops every other field.',
    defaults: { assignments: 'greeting = hello {{name}}', mode: 'merge' },
    fields: [
      { key: 'assignments', label: 'Fields (key = value)', kind: 'textarea' },
      { key: 'mode', label: 'Mode', kind: 'select', options: [['merge', 'merge into input'], ['replace', 'keep only these']] },
    ],
    summary: (c) => trim(parseLines(c.assignments).map(([k]) => k).join(', ') || 'no fields'),
  },

  transform: {
    title: 'Transform', group: 'Data', icon: 'ƒ', kind: 'action', color: '#c084fc',
    micro: 'Step', outputs: ['main'],
    blurb: 'Reshapes data: read a path, pluck, count, sum, sort, dedupe, join/split text, regex-match or parse JSON. The result replaces the input, or is written into one field of it.',
    defaults: { op: 'get', path: '', field: '', n: 3, into: '' },
    fields: [
      { key: 'op', label: 'Operation', kind: 'select', options: TRANSFORM_OPS },
      { key: 'path', label: 'Source path (blank = input)', kind: 'text' },
      { key: 'field', label: 'Field', kind: 'text', show: (c) => ['pluck', 'sum', 'sort', 'unique'].includes(c.op) },
      { key: 'field', label: 'Regex', kind: 'text', show: (c) => c.op === 'match' },
      { key: 'field', label: 'Separator', kind: 'text', show: (c) => ['join', 'split'].includes(c.op) },
      { key: 'n', label: 'N', kind: 'number', show: (c) => ['first', 'last', 'add'].includes(c.op) },
      { key: 'into', label: 'Write into field (blank = replace input)', kind: 'text' },
    ],
    summary: (c) => trim(`${TRANSFORM_OPS.find(([v]) => v === c.op)?.[1] ?? c.op}${c.path ? ` of ${c.path}` : ''}${c.into ? ` → ${c.into}` : ''}`),
  },

  random: {
    title: 'Random Number', group: 'Data', icon: '⚄', kind: 'action', color: '#f472b6',
    micro: 'Step', outputs: ['main'],
    blurb: 'Adds a random whole number between min and max (inclusive) to the input.',
    defaults: { field: 'id', min: 1, max: 100 },
    fields: [
      { key: 'field', label: 'Field', kind: 'text' },
      { key: 'min', label: 'Min', kind: 'number' },
      { key: 'max', label: 'Max', kind: 'number' },
    ],
    summary: (c) => `${c.field} = ${c.min}…${c.max}`,
  },

  // ── Logic ──
  if: {
    title: 'If', group: 'Logic', icon: '⑂', kind: 'if', color: '#facc15',
    micro: 'ConditionalStep', outputs: ['true', 'false'],
    blurb: 'Compares a value with any of micro-flow\'s comparison operators and runs the true or the false branch. Each branch compiles to its own nested Workflow.',
    defaults: { path: 'value', op: '>', value: '10' },
    fields: CONDITION_FIELDS,
    summary: (c) => trim(describeCondition(c.path, c.op, c.value)),
  },

  switch: {
    title: 'Switch', group: 'Logic', icon: '⋔', kind: 'switch', color: '#fbbf24',
    micro: 'SwitchStep + Case',
    outputs: (c) => [...(c.cases ?? []).map((_, i) => `case-${i}`), 'default'],
    portLabel: (c, port) => {
      if (port === 'default') return 'default';
      const kase = c.cases?.[Number(port.split('-')[1])];
      return kase ? `${opLabel(kase.op).replace(/ \(.*\)$/, '')} ${needsValue(kase.op) ? kase.value : ''}`.trim() : port;
    },
    blurb: 'Reads one value and runs the first Case that matches, or the default branch. Every Case is a micro-flow Case whose callable is a nested Workflow.',
    defaults: { path: 'type', cases: [{ op: '===', value: 'a' }, { op: '===', value: 'b' }] },
    fields: [
      { key: 'path', label: 'Value at path', kind: 'text' },
      { key: 'cases', label: 'Cases', kind: 'cases' },
    ],
    summary: (c) => `on ${c.path || '$'}`,
  },

  stop: {
    title: 'Filter (Stop If)', group: 'Logic', icon: '⊘', kind: 'break', color: '#ef4444',
    micro: 'FlowControlStep › break', outputs: ['main'],
    blurb: 'If the condition is true, stops the rest of this branch (a break FlowControlStep on the Workflow it sits in). Directly inside a loop, that drops the item, like a filter.',
    defaults: { path: 'value', op: '<', value: '5' },
    fields: CONDITION_FIELDS,
    summary: (c) => trim(`stop if ${describeCondition(c.path, c.op, c.value)}`),
  },

  skip: {
    title: 'Skip Next If', group: 'Logic', icon: '⤼', kind: 'skip', color: '#f97316',
    micro: 'FlowControlStep › skip', outputs: ['main'],
    blurb: 'If the condition is true, the next node in this branch is skipped (a skip FlowControlStep) and the one after it runs.',
    defaults: { path: 'value', op: '===', value: '0' },
    fields: CONDITION_FIELDS,
    summary: (c) => trim(`skip next if ${describeCondition(c.path, c.op, c.value)}`),
  },

  // ── Flow ──
  loop: {
    title: 'Loop Over Items', group: 'Flow', icon: '↻', kind: 'loop', color: '#60a5fa',
    micro: 'LoopStep › for_each', outputs: ['each', 'done'],
    blurb: 'Runs the "each" branch once per item of a list (a for_each LoopStep). Inside it, the input is the item, also readable as {{ $item }}. "done" gets the list of results; a Filter in the branch drops that item.',
    defaults: { path: '' },
    fields: [{ key: 'path', label: 'List at path (blank = input)', kind: 'text' }],
    summary: (c) => `each of ${c.path || 'input'}`,
  },

  repeat: {
    title: 'Repeat', group: 'Flow', icon: '⟳', kind: 'repeat', color: '#3b82f6',
    micro: 'LoopStep › for', outputs: ['each', 'done'],
    blurb: 'Runs the "each" branch N times (a for LoopStep). N can be a number or a {{ path }} read from the input. Each pass gets the input plus an "index" field. "done" gets the list of results.',
    defaults: { times: 3 },
    fields: [{ key: 'times', label: 'Times (number or {{ path }})', kind: 'text', placeholder: '3' }],
    summary: (c) => `${c.times} times`,
  },

  while: {
    title: 'Repeat While', group: 'Flow', icon: '∞', kind: 'while', color: '#2563eb',
    micro: 'LoopStep › while', outputs: ['each', 'done'],
    blurb: 'Runs the "each" branch while the condition holds (a while LoopStep). The condition reads the last pass\'s output (the input on the first pass), so the branch can move toward the exit. Capped by the server\'s loop limit.',
    defaults: { path: 'count', op: '<', value: '5' },
    fields: CONDITION_FIELDS,
    summary: (c) => trim(`while ${describeCondition(c.path, c.op, c.value)}`),
  },

  wait: {
    title: 'Wait', group: 'Flow', icon: '⏱', kind: 'delay', color: '#94a3b8',
    micro: 'DelayStep › relative', outputs: ['main'],
    blurb: 'Pauses this branch for a number of milliseconds (a relative DelayStep), then passes the input on.',
    defaults: { ms: 1000 },
    fields: [{ key: 'ms', label: 'Milliseconds', kind: 'number' }],
    summary: (c) => `${c.ms} ms`,
  },

  chaos: {
    title: 'Chaos Monkey', group: 'Flow', icon: '☢', kind: 'action', color: '#fb923c',
    micro: 'Step', outputs: ['main'],
    blurb: 'Passes its input through after a delay, but fails some of the time. Give it retries or a timeout in Settings to watch micro-flow retry it or time it out.',
    defaults: { fail_pct: 50, latency_ms: 300 },
    fields: [
      { key: 'fail_pct', label: 'Failure chance (%)', kind: 'number' },
      { key: 'latency_ms', label: 'Latency (ms)', kind: 'number' },
    ],
    summary: (c) => `${c.fail_pct}% fail · ${c.latency_ms} ms`,
  },

  // ── Output ──
  output: {
    title: 'Output Card', group: 'Output', icon: '▣', kind: 'action', color: '#34d399',
    micro: 'Step', outputs: ['main'],
    blurb: 'Adds a card to the execution\'s Output tab and passes its input on. Title, image URL and text can all use {{ path }}.',
    defaults: { title: '{{name}}', image: '', text: '', tone: 'violet' },
    fields: [
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'image', label: 'Image URL', kind: 'text' },
      { key: 'text', label: 'Text', kind: 'text' },
      { key: 'tone', label: 'Colour', kind: 'select', options: TONES },
    ],
    summary: (c) => trim(c.title || c.text || 'card'),
  },

  log: {
    title: 'Log', group: 'Output', icon: '≡', kind: 'action', color: '#64748b',
    micro: 'Step', outputs: ['main'],
    blurb: 'Writes a message to the execution log and passes its input on.',
    defaults: { message: 'got {{$}}', level: 'info' },
    fields: [
      { key: 'message', label: 'Message', kind: 'text' },
      { key: 'level', label: 'Level', kind: 'select', options: [['info', 'info'], ['warn', 'warning'], ['error', 'error']] },
    ],
    summary: (c) => trim(c.message),
  },

  respond: {
    title: 'Respond to Webhook', group: 'Output', icon: '↩', kind: 'action', color: '#2dd4bf',
    micro: 'Step', outputs: ['main'],
    blurb: 'Sets the HTTP response a Webhook Trigger sends back (the first Respond that runs wins). Without one, the caller gets the flow\'s last output.',
    defaults: { status: 200, body: '{{$}}', content_type: 'application/json' },
    fields: [
      { key: 'status', label: 'Status code', kind: 'number' },
      { key: 'body', label: 'Body', kind: 'textarea' },
      { key: 'content_type', label: 'Content type', kind: 'select', options: [['application/json', 'JSON'], ['text/plain', 'text'], ['text/html', 'HTML']] },
    ],
    summary: (c) => `${c.status} ${trim(c.body, 26)}`,
  },
};

export const GROUPS = ['Triggers', 'Data', 'Logic', 'Flow', 'Output'];

export const isTrigger = (type) => NODE_TYPES[type]?.kind === 'trigger';

export const outputsOf = (node) => {
  const outs = NODE_TYPES[node.type]?.outputs ?? [];
  return typeof outs === 'function' ? outs(node.config ?? {}) : outs;
};

export const hasInput = (node) => NODE_TYPES[node.type]?.inputs !== false;

export const portLabel = (node, port) =>
  NODE_TYPES[node.type]?.portLabel?.(node.config ?? {}, port) ?? (port === 'main' ? '' : port);

export const defaultSettings = () => ({ retries: 0, timeout_ms: '', notes: '' });

// Fills in config keys a node is missing (e.g. after the catalogue gains a field).
export const withDefaults = (node) => ({
  ...node,
  config: { ...structuredClone(NODE_TYPES[node.type]?.defaults ?? {}), ...(node.config ?? {}) },
  settings: { ...defaultSettings(), ...(node.settings ?? {}) },
});
