<template>
  <div
    class="fnode"
    :class="[state?.status ?? 'idle', { selected, trigger: isTriggerNode, running: state?.running, invalid: !def }]"
    :style="{ '--c': def?.color ?? '#64748b' }"
  >
    <Handle v-if="def && hasInput(nodeLike)" id="in" type="target" :position="Position.Left" class="port port-in" />

    <div class="fnode-head">
      <span class="fnode-icon" aria-hidden="true">{{ def?.icon ?? '?' }}</span>
      <div class="fnode-titles">
        <span class="fnode-name">{{ data.name }}</span>
        <span class="fnode-type">{{ def?.title ?? data.type }}</span>
      </div>
      <span v-if="state?.count > 1" class="fnode-count" :title="`ran ${state.count} times`">×{{ state.count }}</span>
      <span v-if="state?.status && state.status !== 'idle'" class="fnode-status" :title="state.status" aria-hidden="true">{{ statusIcon }}</span>
    </div>

    <div class="fnode-summary" :title="summary">{{ summary || ' ' }}</div>

    <div class="fnode-outs">
      <div v-for="port in ports" :key="port" class="fnode-out" :class="{ taken: state?.branch === port }">
        <span class="fnode-port-label">{{ portLabel(nodeLike, port) }}</span>
        <Handle :id="port" type="source" :position="Position.Right" class="port port-out" :class="`port-${port}`" />
      </div>
    </div>

    <button
      v-if="isTriggerNode"
      class="fnode-run"
      type="button"
      title="Run from this trigger"
      aria-label="Run from this trigger"
      @click.stop="actions.runFrom(id)"
    >▶</button>

    <div v-if="data.settings?.retries > 0 || data.settings?.timeout_ms" class="fnode-flags">
      <span v-if="data.settings.retries > 0" title="max_retries">↻{{ data.settings.retries }}</span>
      <span v-if="data.settings.timeout_ms" title="max_timeout_ms">⏲{{ data.settings.timeout_ms }}ms</span>
    </div>
  </div>
</template>

<script setup>
import { computed, inject } from 'vue';
import { Handle, Position } from '@vue-flow/core';
import { NODE_TYPES, outputsOf, portLabel, hasInput, isTrigger } from '@shared/nodes.js';

const props = defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
});

const runState = inject('runState');
const actions = inject('nodeActions');

const def = computed(() => NODE_TYPES[props.data.type]);
const nodeLike = computed(() => ({ type: props.data.type, config: props.data.config }));
const ports = computed(() => (def.value ? outputsOf(nodeLike.value) : []));
const isTriggerNode = computed(() => isTrigger(props.data.type));
const state = computed(() => runState[props.id]);

const summary = computed(() => {
  try {
    return def.value?.summary?.(props.data.config) ?? '';
  } catch {
    return '';
  }
});

const statusIcon = computed(() => ({
  success: '✓', error: '✕', retrying: '↻', skipped: '–', running: '…',
}[state.value?.running ? 'running' : state.value?.status] ?? ''));
</script>

<style scoped>
.fnode {
  position: relative;
  width: 220px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-left: 3px solid var(--c);
  border-radius: 10px;
  box-shadow: 0 4px 18px rgba(0, 0, 0, .35);
  font-size: 0.75rem;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.fnode.trigger { border-radius: 22px 10px 10px 22px; }
.fnode.selected { border-color: var(--accent); border-left-color: var(--c); box-shadow: 0 0 0 1px var(--accent), 0 0 28px rgba(99, 102, 241, .45); }
.fnode.success { box-shadow: 0 0 0 1px rgba(52, 211, 153, .55), 0 0 18px rgba(52, 211, 153, .25); }
.fnode.error { box-shadow: 0 0 0 1px rgba(239, 68, 68, .7), 0 0 22px rgba(239, 68, 68, .35); }
.fnode.retrying { box-shadow: 0 0 0 1px rgba(245, 158, 11, .7), 0 0 22px rgba(245, 158, 11, .3); }
.fnode.skipped { opacity: 0.6; }
.fnode.running { animation: pulse 1s ease-in-out infinite; }
.fnode.invalid { border-left-color: var(--bad); }

@keyframes pulse {
  50% { box-shadow: 0 0 0 2px var(--accent-2), 0 0 32px rgba(139, 92, 246, .7); }
}

.fnode-head { display: flex; align-items: center; gap: 0.55rem; padding: 0.6rem 0.7rem 0.3rem; }

.fnode-icon {
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 0.95rem;
  color: var(--c);
  background: color-mix(in srgb, var(--c) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 30%, transparent);
}

.fnode-titles { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.fnode-name { font-family: var(--mono); color: var(--text); font-size: 0.8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fnode-type { font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--dim); }

.fnode-count { font-family: var(--mono); font-size: 0.62rem; color: var(--accent-text); background: var(--badge-bg); padding: 1px 6px; border-radius: 999px; }

.fnode-status { font-size: 0.8rem; font-weight: 700; width: 18px; text-align: center; }
.success .fnode-status { color: var(--good); }
.error .fnode-status { color: var(--bad); }
.retrying .fnode-status { color: var(--warn); }
.skipped .fnode-status { color: var(--muted); }
.running .fnode-status { color: var(--accent-text); }

.fnode-summary {
  padding: 0 0.7rem 0.5rem;
  font-family: var(--mono);
  font-size: 0.66rem;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fnode-outs { display: flex; flex-direction: column; padding-bottom: 0.35rem; }
.fnode-outs:empty { padding: 0; }

.fnode-out {
  position: relative;
  display: flex;
  justify-content: flex-end;
  padding: 0.15rem 0.85rem;
  min-height: 20px;
  align-items: center;
}

.fnode-port-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--dim); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnode-out.taken .fnode-port-label { color: var(--good); }

.port {
  width: 12px;
  height: 12px;
  background: var(--bg);
  border: 2px solid var(--muted);
  transition: border-color 0.15s, background 0.15s, transform 0.15s;
}

.port:hover, .port.connecting { border-color: var(--accent); background: var(--accent); }
.port-in { left: -7px; }
.port-out { right: -7px; border-color: var(--c); }
.port-true { border-color: var(--good); }
.port-false { border-color: var(--bad); }
.port-done { border-color: var(--accent-text); }

/* Bigger targets for fingers. */
@media (pointer: coarse) {
  .port { width: 18px; height: 18px; }
  .port-in { left: -10px; }
  .port-out { right: -10px; }
}

.fnode-run {
  position: absolute;
  left: -34px;
  top: 14px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--good);
  font-size: 0.65rem;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, box-shadow 0.15s;
}

.fnode:hover .fnode-run, .fnode.selected .fnode-run { opacity: 1; }
.fnode-run:hover { box-shadow: 0 0 16px rgba(52, 211, 153, .5); border-color: var(--good); }

@media (pointer: coarse) {
  .fnode-run { opacity: 1; }
}

.fnode-flags {
  position: absolute;
  top: -9px;
  right: 10px;
  display: flex;
  gap: 4px;
}

.fnode-flags span {
  font-family: var(--mono);
  font-size: 0.56rem;
  color: var(--warn);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 5px;
}
</style>
