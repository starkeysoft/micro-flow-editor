// Converts between the saved graph format and Vue Flow's nodes/edges.
//   graph:     { nodes: [{ id, type, name, x, y, config, settings }], edges: [{ id, from, port, to }] }
//   vue flow:  nodes [{ id, type: 'flow', position, data: { type, name, config, settings } }]
//              edges [{ id, type: 'flow', source, sourceHandle: port, target, targetHandle: 'in' }]
import { NODE_TYPES, withDefaults, outputsOf } from '@shared/nodes.js';

export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `n${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export const edgeId = (from, port, to) => `${from}.${port}>${to}`;

export function toFlowNode(node) {
  const full = withDefaults(node);
  return {
    id: full.id,
    type: 'flow',
    position: { x: full.x, y: full.y },
    data: { type: full.type, name: full.name, config: full.config, settings: full.settings },
  };
}

export const toFlowEdge = (edge) => ({
  id: edge.id || edgeId(edge.from, edge.port, edge.to),
  type: 'flow',
  source: edge.from,
  sourceHandle: edge.port,
  target: edge.to,
  targetHandle: 'in',
});

export function fromGraph(graph) {
  const nodes = (graph?.nodes ?? []).filter((n) => NODE_TYPES[n.type]).map(toFlowNode);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (graph?.edges ?? []).filter((e) => ids.has(e.from) && ids.has(e.to)).map(toFlowEdge);
  return { nodes, edges };
}

export function toGraph(nodes, edges) {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.type,
      name: n.data.name,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      config: n.data.config,
      settings: n.data.settings,
    })),
    // Drop wires whose port no longer exists (e.g. a removed Switch case).
    edges: edges
      .filter((e) => {
        const source = nodes.find((n) => n.id === e.source);
        return source && outputsOf({ type: source.data.type, config: source.data.config }).includes(e.sourceHandle);
      })
      .map((e) => ({ id: e.id, from: e.source, port: e.sourceHandle, to: e.target })),
  };
}

export function uniqueName(base, taken) {
  const names = new Set(taken);
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

// True if `to` can already reach `from`, i.e. wiring from → to makes a cycle.
export function wouldCycle(edges, from, to) {
  if (from === to) return true;
  const seen = new Set();
  const stack = [to];
  while (stack.length) {
    const id = stack.pop();
    if (id === from) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of edges) if (e.source === id) stack.push(e.target);
  }
  return false;
}
