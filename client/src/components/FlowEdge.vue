<template>
  <BaseEdge :id="id" :path="path[0]" :marker-end="markerEnd" class="fedge" :class="{ selected, traversed, live }" :interaction-width="24" />
  <EdgeLabelRenderer>
    <div
      class="fedge-tools nodrag nopan"
      :class="{ show: selected }"
      :style="{ transform: `translate(-50%, -50%) translate(${path[1]}px, ${path[2]}px)` }"
    >
      <button type="button" title="Insert a node here" aria-label="Insert a node here" @click.stop="actions.insertOnEdge(id)">+</button>
      <button type="button" class="danger" title="Delete connection" aria-label="Delete connection" @click.stop="actions.removeEdge(id)">✕</button>
    </div>
  </EdgeLabelRenderer>
</template>

<script setup>
import { computed, inject } from 'vue';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@vue-flow/core';

const props = defineProps({
  id: String,
  source: String,
  target: String,
  sourceHandleId: String,
  sourceX: Number,
  sourceY: Number,
  targetX: Number,
  targetY: Number,
  sourcePosition: String,
  targetPosition: String,
  markerEnd: String,
  selected: Boolean,
});

const actions = inject('nodeActions');
const runState = inject('runState');

const path = computed(() => getBezierPath({
  sourceX: props.sourceX,
  sourceY: props.sourceY,
  sourcePosition: props.sourcePosition,
  targetX: props.targetX,
  targetY: props.targetY,
  targetPosition: props.targetPosition,
  curvature: 0.35,
}));

// Highlight wires the last run actually went along.
const traversed = computed(() => {
  const target = runState[props.target];
  return Boolean(target?.status && target.status !== 'skipped' && runState[props.source]?.status);
});
const live = computed(() => Boolean(runState[props.target]?.running));
</script>

<style>
.fedge { stroke: var(--border-strong) !important; stroke-width: 2px !important; transition: stroke 0.2s; }
.vue-flow__edge:hover .fedge { stroke: var(--muted) !important; }
.fedge.traversed { stroke: rgba(52, 211, 153, .6) !important; }
.fedge.live { stroke: var(--accent-2) !important; stroke-dasharray: 6 4; animation: dash 0.6s linear infinite; }
.fedge.selected { stroke: var(--accent) !important; }

@keyframes dash { to { stroke-dashoffset: -10; } }

.fedge-tools {
  position: absolute;
  display: flex;
  gap: 4px;
  pointer-events: all;
  opacity: 0;
  transition: opacity 0.15s;
}

.vue-flow__edge:hover + .fedge-tools, .fedge-tools:hover, .fedge-tools.show { opacity: 1; }

.fedge-tools button {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--accent-text);
  font-size: 0.75rem;
  line-height: 1;
  cursor: pointer;
}

.fedge-tools button:hover { border-color: var(--accent); box-shadow: 0 0 12px rgba(99, 102, 241, .4); }
.fedge-tools button.danger { color: #fca5a5; }
.fedge-tools button.danger:hover { border-color: var(--bad); }

@media (pointer: coarse) {
  .fedge-tools button { width: 32px; height: 32px; }
}
</style>
