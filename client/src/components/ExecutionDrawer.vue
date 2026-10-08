<template>
  <section class="drawer" :class="{ open }">
    <div class="drawer-bar">
      <nav class="tabs" role="tablist">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          role="tab"
          class="tab"
          :class="{ active: open && tab === t.key }"
          :aria-selected="open && tab === t.key"
          @click="select(t.key)"
        >{{ t.label }}<span v-if="t.count" class="count">{{ t.count }}</span></button>
      </nav>
      <span v-if="viewing" class="viewing badge warn" :title="`Execution ${viewing.id}`">
        viewing {{ viewing.mode }} run · {{ time(viewing.started_at) }}
        <button type="button" aria-label="Stop viewing this execution" @click="$emit('close-execution')">✕</button>
      </span>
      <button class="button ghost small icon toggle" type="button" :aria-label="open ? 'Collapse panel' : 'Expand panel'" @click="$emit('update:open', !open)">
        {{ open ? '▾' : '▴' }}
      </button>
    </div>

    <div v-if="open" class="drawer-body">
      <!-- Output cards -->
      <div v-if="tab === 'output'">
        <p v-if="!outputs.length" class="empty">Output Card nodes show their cards here when the flow runs.</p>
        <div v-else class="cards">
          <article v-for="(card, i) in outputs" :key="i" class="card" :class="`tone-${card.tone || 'violet'}`">
            <img v-if="card.image" :src="card.image" alt="" loading="lazy" referrerpolicy="no-referrer" />
            <div>
              <h4>{{ card.title }}</h4>
              <p v-if="card.text">{{ card.text }}</p>
            </div>
          </article>
        </div>
      </div>

      <!-- Log -->
      <div v-else-if="tab === 'log'">
        <p v-if="!log.length" class="empty">The execution log fills in while a flow runs: every step that starts, finishes, retries, is skipped or fails.</p>
        <ol v-else ref="logList" class="log">
          <li v-for="(entry, i) in log" :key="i" :class="entry.level" @click="entry.node_id && $emit('select-node', entry.node_id)">
            <span class="log-time">{{ time(entry.at) }}</span>
            <span class="log-event">{{ entry.event }}</span>
            <span class="log-text">{{ entry.text }}</span>
          </li>
        </ol>
      </div>

      <!-- Executions -->
      <div v-else-if="tab === 'executions'">
        <div class="exec-head">
          <span class="field-hint">Every run is saved: manual, webhook and scheduled. Pick one to see its data on the canvas.</span>
          <button v-if="executions.length" class="button ghost small danger" type="button" @click="$emit('clear-executions')">Clear finished</button>
        </div>
        <p v-if="!executions.length" class="empty">No executions yet.</p>
        <ul v-else class="exec-list">
          <li v-for="e in executions" :key="e.id">
            <button type="button" class="exec" :class="{ current: viewing?.id === e.id || liveId === e.id }" @click="$emit('open-execution', e.id)">
              <span class="badge" :class="statusTone(e.status)">{{ e.status }}</span>
              <span class="exec-mode label">{{ e.mode }}</span>
              <span class="exec-time mono">{{ new Date(e.started_at).toLocaleString() }}</span>
              <span class="exec-dur mono">{{ duration(e.started_at, e.finished_at) }}</span>
              <span v-if="e.error" class="exec-error">{{ e.error }}</span>
            </button>
          </li>
        </ul>
      </div>

      <!-- Compiled micro-flow -->
      <div v-else-if="tab === 'micro'">
        <div class="exec-head">
          <span class="field-hint">What the canvas compiles to: one root micro-flow Workflow, with a nested Workflow for every branch.</span>
          <div class="seg">
            <button type="button" class="button ghost small" :class="{ on: microView === 'tree' }" @click="microView = 'tree'">Tree</button>
            <button type="button" class="button ghost small" :class="{ on: microView === 'json' }" @click="microView = 'json'">serialize()</button>
          </div>
        </div>
        <p v-if="preview.loading" class="empty">Compiling…</p>
        <p v-else-if="preview.error" class="run-error">{{ preview.error }}</p>
        <template v-else-if="preview.tree">
          <ul v-if="microView === 'tree'" class="tree">
            <TreeWorkflow :wf="preview.tree" @select-node="$emit('select-node', $event)" />
          </ul>
          <JsonBlock v-else :value="preview.serialized" />
        </template>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, watch, nextTick, h } from 'vue';
import { time, duration, statusTone } from '../lib/format.js';
import JsonBlock from './JsonBlock.vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  tab: { type: String, default: 'output' },
  outputs: { type: Array, default: () => [] },
  log: { type: Array, default: () => [] },
  executions: { type: Array, default: () => [] },
  viewing: { type: Object, default: null },
  liveId: { type: String, default: null },
  preview: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['update:open', 'update:tab', 'open-execution', 'close-execution', 'clear-executions', 'select-node', 'load-preview']);

const microView = ref('tree');
const logList = ref(null);

const tabs = computed(() => [
  { key: 'output', label: 'Output', count: props.outputs.length || '' },
  { key: 'log', label: 'Log', count: props.log.length || '' },
  { key: 'executions', label: 'Executions', count: props.executions.length || '' },
  { key: 'micro', label: 'micro-flow' },
]);

function select(key) {
  emit('update:tab', key);
  emit('update:open', true);
  if (key === 'micro') emit('load-preview');
}

// Keep the log scrolled to the newest entry.
watch(() => props.log.length, async () => {
  await nextTick();
  const list = logList.value;
  if (list) list.parentElement.parentElement.scrollTop = list.scrollHeight;
});

// A small recursive renderer for the compiled tree.
const TreeWorkflow = {
  name: 'TreeWorkflow',
  props: { wf: Object, label: String },
  emits: ['select-node'],
  setup(p, { emit: up }) {
    return () => h('li', { class: 'tree-wf' }, [
      h('div', { class: 'tree-wf-name' }, [
        p.label ? h('span', { class: 'tree-label' }, `${p.label} → `) : null,
        h('span', { class: 'step-type-badge' }, 'Workflow'),
        ' ',
        h('span', { class: 'mono' }, p.wf.workflow),
      ]),
      h('ul', { class: 'tree-steps' }, p.wf.steps.map((step) => h('li', { class: ['tree-step', { hidden: !step.node_id }] }, [
        h('button', {
          type: 'button',
          class: 'tree-step-btn',
          disabled: !step.node_id,
          onClick: () => step.node_id && up('select-node', step.node_id),
        }, [
          h('span', { class: 'step-type-badge' }, step.detail ? `${step.class} › ${step.detail}` : step.class),
          ' ',
          h('span', { class: 'mono' }, step.name),
        ]),
        step.children.length
          ? h('ul', { class: 'tree-children' }, step.children.map((child) => h(TreeWorkflow, {
            wf: child,
            label: child.label,
            'onSelect-node': (id) => up('select-node', id),
          })))
          : null,
      ]))),
    ]);
  },
};
</script>

<style scoped>
.drawer {
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border-top: 1px solid var(--border);
  min-height: 0;
  flex: none;
}

.drawer.open { height: var(--drawer-h, 260px); }

.drawer-bar { display: flex; align-items: center; gap: 0.5rem; padding: 0 0.5rem; flex: none; }
.drawer-bar .tabs { flex: 1; min-width: 0; }
.toggle { flex: none; }

.viewing { display: inline-flex; align-items: center; gap: 4px; flex: none; }
.viewing button { background: none; border: none; color: inherit; cursor: pointer; font-size: 0.7rem; padding: 0 2px; }

.drawer-body { flex: 1; overflow-y: auto; padding: 0.6rem 1rem 1rem; min-height: 0; border-top: 1px solid var(--border); }

/* output cards */
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 0.6rem; }

.card {
  --tone: #8b5cf6;
  display: flex;
  gap: 0.6rem;
  align-items: center;
  padding: 0.6rem 0.7rem;
  border-radius: 10px;
  background: color-mix(in srgb, var(--tone) 10%, var(--bg));
  border: 1px solid color-mix(in srgb, var(--tone) 35%, transparent);
  box-shadow: 0 0 18px color-mix(in srgb, var(--tone) 18%, transparent);
  animation: card-in 0.25s ease;
}

.card img { width: 52px; height: 52px; object-fit: contain; border-radius: 8px; background: rgba(255, 255, 255, .04); flex: none; }
.card h4 { font-family: var(--mono); font-size: 0.82rem; color: var(--text); font-weight: 600; overflow-wrap: anywhere; }
.card p { font-size: 0.7rem; color: var(--muted); margin-top: 2px; overflow-wrap: anywhere; }
.tone-red { --tone: #ef4444; }
.tone-blue { --tone: #3b82f6; }
.tone-green { --tone: #22c55e; }
.tone-amber { --tone: #f59e0b; }
.tone-slate { --tone: #64748b; }

@keyframes card-in { from { opacity: 0; transform: translateY(6px) scale(.98); } }

/* log */
.log { list-style: none; font-family: var(--mono); font-size: 0.68rem; line-height: 1.5; }
.log li { display: grid; grid-template-columns: 70px 190px minmax(0, 1fr); gap: 0.6rem; padding: 1px 0; cursor: default; }
.log-time { color: var(--faint); }
.log-event { color: var(--good); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.log-text { color: var(--accent-text); overflow-wrap: anywhere; }
.log li.warn .log-event { color: var(--warn); }
.log li.error .log-event { color: var(--bad); }
.log li.error .log-text { color: #fca5a5; }

/* executions */
.exec-head { display: flex; align-items: center; justify-content: space-between; gap: 0.8rem; margin-bottom: 0.6rem; flex-wrap: wrap; }
.exec-list { list-style: none; display: flex; flex-direction: column; gap: 4px; }

.exec {
  width: 100%;
  display: grid;
  grid-template-columns: 74px 72px minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0.6rem;
  min-height: 40px;
  font: inherit;
  text-align: left;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  cursor: pointer;
}

.exec:hover, .exec.current { border-color: var(--accent); }
.exec .badge { justify-self: start; }
.exec-time, .exec-dur { font-size: 0.7rem; color: var(--accent-text); }
.exec-dur { color: var(--muted); }
.exec-error { grid-column: 1 / -1; font-size: 0.68rem; color: #fca5a5; font-family: var(--mono); overflow-wrap: anywhere; }

/* micro-flow tree */
.seg { display: flex; gap: 4px; }
.seg .on { border-color: var(--accent); color: var(--text); }
.run-error { color: #fca5a5; font-family: var(--mono); font-size: 0.75rem; }

.tree, :deep(.tree-steps), :deep(.tree-children) { list-style: none; }
:deep(.tree-wf-name) { font-size: 0.75rem; color: var(--text); margin: 2px 0; }
:deep(.tree-label) { font-family: var(--mono); font-size: 0.7rem; color: var(--warn); }
:deep(.tree-steps) { border-left: 1px solid var(--border); margin-left: 6px; padding-left: 12px; }
:deep(.tree-step-btn) { font: inherit; font-size: 0.75rem; background: none; border: none; color: var(--accent-text); cursor: pointer; padding: 2px 0; text-align: left; }
:deep(.tree-step-btn:disabled) { cursor: default; }
:deep(.tree-step.hidden > .tree-step-btn) { opacity: 0.55; }
:deep(.tree-step-btn:not(:disabled):hover .mono) { text-decoration: underline; }
:deep(.tree-children) { margin-left: 4px; }

@media (max-width: 760px) {
  .drawer.open { height: min(55dvh, 420px); }
  .log li { grid-template-columns: 62px minmax(0, 1fr); }
  .log-event { display: none; }
  .exec { grid-template-columns: 70px minmax(0, 1fr) auto; }
  .exec-mode { display: none; }
  .viewing { max-width: 40%; overflow: hidden; text-overflow: ellipsis; }
}
</style>
