<template>
  <aside class="palette" :class="mode" aria-label="Nodes">
    <div class="palette-head">
      <span class="panel-title">{{ connecting ? 'Connect a node' : 'Nodes' }}</span>
      <button v-if="mode === 'sheet'" class="button ghost small icon" type="button" aria-label="Close" @click="$emit('close')">✕</button>
    </div>
    <input
      ref="search"
      v-model="query"
      class="input palette-search"
      type="search"
      placeholder="Search nodes…"
      aria-label="Search nodes"
      @keydown.enter.prevent="addFirst"
      @keydown.esc="$emit('close')"
    />
    <div class="palette-groups">
      <section v-for="group in groups" :key="group.name" class="palette-group">
        <h3 class="label">{{ group.name }}</h3>
        <button
          v-for="item in group.items"
          :key="item.type"
          class="palette-item"
          type="button"
          :style="{ '--c': item.def.color }"
          :draggable="mode === 'dock'"
          :title="item.def.blurb"
          @dragstart="dragStart($event, item.type)"
          @click="$emit('add', item.type)"
        >
          <span class="palette-icon" aria-hidden="true">{{ item.def.icon }}</span>
          <span class="palette-text">
            <span class="palette-title">{{ item.def.title }}</span>
            <span class="palette-micro">{{ item.def.micro }}</span>
          </span>
        </button>
      </section>
      <p v-if="!groups.length" class="empty">No node matches "{{ query }}".</p>
    </div>
    <p v-if="mode === 'dock'" class="palette-hint">Drag onto the canvas, or click to add after the selected node.</p>
  </aside>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue';
import { NODE_TYPES, GROUPS } from '@shared/nodes.js';

const props = defineProps({
  mode: { type: String, default: 'dock' }, // dock | sheet
  connecting: { type: Boolean, default: false },
  autofocus: { type: Boolean, default: false },
});
const emit = defineEmits(['add', 'close']);

const query = ref('');
const search = ref(null);

// Title matches rank above matches in the micro-flow class or description.
function score(type, def, q) {
  if (!q) return 1;
  const title = def.title.toLowerCase();
  if (title.startsWith(q)) return 4;
  if (title.includes(q) || type.includes(q)) return 3;
  if (def.micro.toLowerCase().includes(q)) return 2;
  return def.blurb.toLowerCase().includes(q) ? 1 : 0;
}

const matches = computed(() => {
  const q = query.value.trim().toLowerCase();
  return Object.entries(NODE_TYPES)
    .filter(([, def]) => !(props.connecting && def.group === 'Triggers'))
    .map(([type, def]) => ({ type, def, score: score(type, def, q) }))
    .filter((item) => item.score > 0);
});

const groups = computed(() => GROUPS
  .map((name) => ({
    name,
    items: matches.value.filter((item) => item.def.group === name).sort((a, b) => b.score - a.score),
  }))
  .filter((g) => g.items.length));

// Enter adds the best match overall.
function addFirst() {
  const best = [...matches.value].sort((a, b) => b.score - a.score)[0];
  if (best) emit('add', best.type);
}

function dragStart(event, type) {
  event.dataTransfer.setData('application/x-micro-flow-node', type);
  event.dataTransfer.effectAllowed = 'move';
}

onMounted(() => {
  if (props.autofocus) nextTick(() => search.value?.focus());
});
</script>

<style scoped>
.palette {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  background: var(--panel);
  min-height: 0;
}

.palette.dock {
  width: 236px;
  border-right: 1px solid var(--border);
  padding: 0.9rem 0.8rem;
}

.palette.sheet { padding: 0.9rem 1rem calc(1rem + env(safe-area-inset-bottom)); max-height: 100%; }

.palette-head { display: flex; align-items: center; justify-content: space-between; min-height: 30px; }

.palette-groups { overflow-y: auto; flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 0.8rem; padding-right: 2px; }
.palette-group { display: flex; flex-direction: column; gap: 4px; }
.palette-group h3 { font-weight: 600; margin-bottom: 2px; }

.sheet .palette-group { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.sheet .palette-group h3 { grid-column: 1 / -1; }

.palette-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.45rem 0.55rem;
  min-height: 44px;
  font: inherit;
  text-align: left;
  background: var(--bg);
  border: 1px solid var(--border);
  border-left: 3px solid var(--c);
  border-radius: 8px;
  color: var(--text);
  cursor: grab;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.palette-item:hover, .palette-item:focus-visible {
  border-color: var(--accent);
  border-left-color: var(--c);
  box-shadow: 0 0 18px rgba(99, 102, 241, .25);
  outline: none;
}

.sheet .palette-item { cursor: pointer; }

.palette-icon {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  color: var(--c);
  background: color-mix(in srgb, var(--c) 14%, transparent);
}

.palette-text { display: flex; flex-direction: column; min-width: 0; }
.palette-title { font-size: 0.78rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.palette-micro { font-family: var(--mono); font-size: 0.6rem; color: var(--badge-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.palette-hint { font-size: 0.66rem; color: var(--dim); line-height: 1.4; }
</style>
