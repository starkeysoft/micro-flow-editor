<template>
  <aside class="inspector" :class="mode" :style="{ '--c': def.color }" aria-label="Node settings">
    <header class="insp-head">
      <span class="insp-icon" aria-hidden="true">{{ def.icon }}</span>
      <div class="insp-titles">
        <input
          class="insp-name"
          :class="{ invalid: nameTaken }"
          :value="node.data.name"
          aria-label="Node name"
          maxlength="100"
          @change="rename($event.target.value)"
          @keydown.enter="$event.target.blur()"
        />
        <span class="insp-type">{{ def.title }} · <span class="step-type-badge">{{ def.micro }}</span></span>
      </div>
      <button class="button ghost small icon" type="button" title="Close" aria-label="Close" @click="$emit('close')">✕</button>
    </header>
    <p v-if="nameTaken" class="field-error insp-pad">Another node is already called "{{ node.data.name }}". Names must be unique.</p>

    <nav class="tabs insp-tabs">
      <button v-for="t in tabs" :key="t.key" type="button" class="tab" :class="{ active: tab === t.key }" @click="tab = t.key">
        {{ t.label }}<span v-if="t.count" class="count">{{ t.count }}</span>
      </button>
    </nav>

    <div class="insp-body">
      <!-- Parameters -->
      <div v-if="tab === 'params'">
        <p class="insp-blurb">{{ def.blurb }}</p>
        <template v-for="field in visibleFields" :key="`${field.key}-${field.label}`">
          <div class="field">
            <label class="label" :for="`f-${field.key}`">{{ field.label }}</label>

            <select v-if="field.kind === 'select'" :id="`f-${field.key}`" v-model="config[field.key]" class="input">
              <option v-for="[value, label] in field.options" :key="value" :value="value">{{ label }}</option>
            </select>

            <select v-else-if="field.kind === 'operator'" :id="`f-${field.key}`" v-model="config[field.key]" class="input">
              <option v-for="[value, label] in OPERATORS" :key="value" :value="value">{{ label }}</option>
            </select>

            <textarea
              v-else-if="field.kind === 'textarea' || field.kind === 'json'"
              :id="`f-${field.key}`"
              v-model="config[field.key]"
              class="input"
              :class="{ invalid: field.kind === 'json' && jsonError(config[field.key]) }"
              :rows="field.kind === 'json' ? 6 : 4"
              spellcheck="false"
            ></textarea>

            <input
              v-else-if="field.kind === 'number'"
              :id="`f-${field.key}`"
              class="input"
              type="number"
              inputmode="numeric"
              :value="config[field.key]"
              @input="config[field.key] = $event.target.value === '' ? '' : Number($event.target.value)"
            />

            <label v-else-if="field.kind === 'checkbox'" class="check">
              <input :id="`f-${field.key}`" v-model="config[field.key]" type="checkbox" /> {{ field.label }}
            </label>

            <div v-else-if="field.kind === 'cases'" class="cases">
              <div v-for="(kase, i) in config.cases" :key="i" class="case-row">
                <span class="case-n mono">{{ i + 1 }}</span>
                <select v-model="kase.op" class="input" aria-label="Case operator">
                  <option v-for="[value, label] in OPERATORS" :key="value" :value="value">{{ label }}</option>
                </select>
                <input v-if="needsValue(kase.op)" v-model="kase.value" class="input" aria-label="Case value" placeholder="value" />
                <button class="button ghost small icon danger" type="button" aria-label="Remove case" @click="removeCase(i)">✕</button>
              </div>
              <button class="button ghost small" type="button" @click="addCase">+ Add case</button>
              <p class="field-hint">Cases are checked in order; the first match runs. Removing a case drops its wires.</p>
            </div>

            <input
              v-else
              :id="`f-${field.key}`"
              v-model="config[field.key]"
              class="input"
              :placeholder="field.placeholder ?? ''"
              spellcheck="false"
              autocomplete="off"
            />

            <p v-if="field.kind === 'json' && jsonError(config[field.key])" class="field-error">{{ jsonError(config[field.key]) }}</p>
          </div>
        </template>

        <p v-if="node.data.type === 'webhook'" class="field-hint webhook-url">
          URL: <span class="mono">{{ webhookUrl }}</span><br />
          Listens only while the flow is active (the switch in the top bar).
        </p>

        <details class="hint-box">
          <summary class="label">Expressions</summary>
          <p class="field-hint">
            <span class="mono" v-pre>{{ field.path }}</span> reads this node's input,
            <span class="mono" v-pre>{{ $item.x }}</span> the current loop item,
            <span class="mono" v-pre>{{ $trigger.x }}</span> the trigger's output,
            <span class="mono" v-pre>{{ $node["Name"].x }}</span> any earlier node's output,
            <span class="mono" v-pre>{{ $now }}</span> the time and <span class="mono" v-pre>{{ $ }}</span> the whole input.
            A value that is only <span class="mono" v-pre>{{ … }}</span> keeps its type.
          </p>
        </details>
      </div>

      <!-- Settings -->
      <div v-else-if="tab === 'settings'">
        <template v-if="node.data.type !== 'wait'">
          <div class="field">
            <label class="label" for="s-retries">Retries (max_retries)</label>
            <input id="s-retries" class="input" type="number" min="0" max="10" inputmode="numeric" :value="settings.retries" @input="settings.retries = clampInt($event.target.value, 0, 10)" />
            <p class="field-hint">Run again this many times if the step fails. micro-flow emits step_retrying before each retry.</p>
          </div>
          <div class="field">
            <label class="label" for="s-timeout">Timeout ms (max_timeout_ms)</label>
            <input id="s-timeout" class="input" type="number" min="0" inputmode="numeric" placeholder="default" :value="settings.timeout_ms" @input="settings.timeout_ms = $event.target.value === '' ? '' : clampInt($event.target.value, 0, 86400000)" />
            <p class="field-hint">{{ isContainer ? 'Blank = no timeout (this node contains a branch).' : 'Blank = 30000 ms, micro-flow\'s default.' }} Applies to each attempt.</p>
          </div>
        </template>
        <div class="field">
          <label class="label" for="s-notes">Notes</label>
          <textarea id="s-notes" v-model="settings.notes" class="input" rows="3" placeholder="What is this node for?"></textarea>
        </div>
        <div class="insp-actions">
          <button class="button ghost small" type="button" @click="$emit('duplicate')">Duplicate</button>
          <button class="button ghost small danger" type="button" @click="$emit('remove')">Delete node</button>
        </div>
      </div>

      <!-- Data from the last run -->
      <div v-else>
        <p v-if="!runs.length" class="empty">This node hasn't run yet{{ viewing ? ' in this execution' : '' }}. Press Run to see its input and output here.</p>
        <template v-else>
          <div class="run-nav">
            <button class="button ghost small icon" type="button" :disabled="runIndex <= 0" aria-label="Previous run" @click="runIndex--">‹</button>
            <span class="label">Run {{ runIndex + 1 }} of {{ runs.length }}</span>
            <button class="button ghost small icon" type="button" :disabled="runIndex >= runs.length - 1" aria-label="Next run" @click="runIndex++">›</button>
            <span class="badge" :class="statusTone(run.status)">{{ run.status }}</span>
            <span v-if="run.ms != null" class="badge dim">{{ run.ms }} ms</span>
            <span v-if="run.attempt" class="badge warn">attempt {{ run.attempt + 1 }}</span>
            <span v-if="run.branch" class="badge good">→ {{ run.branch }}</span>
          </div>
          <p v-if="run.error" class="run-error">{{ run.error }}</p>
          <p v-if="run.note" class="field-hint">{{ run.note }}</p>
          <div v-if="run.input !== undefined" class="field">
            <span class="label">Input</span>
            <JsonBlock :value="run.input" />
          </div>
          <div v-if="run.output !== undefined" class="field">
            <span class="label">Output</span>
            <JsonBlock :value="run.output" />
          </div>
        </template>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { NODE_TYPES, OPERATORS, needsValue } from '@shared/nodes.js';
import { statusTone } from '../lib/format.js';
import JsonBlock from './JsonBlock.vue';

const props = defineProps({
  node: { type: Object, required: true },
  runs: { type: Array, default: () => [] },
  names: { type: Array, default: () => [] },
  mode: { type: String, default: 'dock' },
  viewing: { type: Boolean, default: false },
  initialTab: { type: String, default: 'params' },
});
const emit = defineEmits(['close', 'remove', 'duplicate', 'rename']);

const tab = ref(props.initialTab);
const runIndex = ref(0);

const def = computed(() => NODE_TYPES[props.node.data.type]);
const config = computed(() => props.node.data.config);
const settings = computed(() => props.node.data.settings);
const visibleFields = computed(() => def.value.fields.filter((f) => !f.show || f.show(config.value)));
const isContainer = computed(() => ['if', 'switch', 'loop', 'repeat', 'while'].includes(def.value.kind));
const nameTaken = computed(() => props.names.includes(props.node.data.name));
const run = computed(() => props.runs[runIndex.value] ?? {});
const webhookUrl = computed(() => `${location.origin}/webhook/${String(config.value.path ?? '').replace(/^\/+/, '')}`);

const tabs = computed(() => [
  { key: 'params', label: 'Parameters' },
  { key: 'settings', label: 'Settings' },
  { key: 'data', label: 'Data', count: props.runs.length || '' },
]);

// Show the newest run when a node is opened or runs arrive.
watch(() => [props.node.id, props.runs.length], () => {
  runIndex.value = Math.max(0, props.runs.length - 1);
}, { immediate: true });
watch(() => props.node.id, () => { tab.value = props.initialTab; });
watch(() => props.initialTab, (t) => { tab.value = t; });

function rename(value) {
  emit('rename', value.trim() || def.value.title);
}

function jsonError(text) {
  try {
    JSON.parse(text || '{}');
    return '';
  } catch (e) {
    return `Not valid JSON: ${e.message}`;
  }
}

const clampInt = (value, min, max) => Math.min(max, Math.max(min, Math.floor(Number(value) || 0)));

function addCase() {
  (config.value.cases ??= []).push({ op: '===', value: '' });
}

function removeCase(i) {
  config.value.cases.splice(i, 1);
}
</script>

<style scoped>
.inspector {
  display: flex;
  flex-direction: column;
  background: var(--panel);
  min-height: 0;
}

.inspector.dock { width: 360px; border-left: 1px solid var(--border); }
.inspector.sheet { max-height: 100%; }

.insp-head { display: flex; align-items: center; gap: 0.6rem; padding: 0.8rem 0.9rem 0.4rem; }

.insp-icon {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  font-size: 1.05rem;
  color: var(--c);
  background: color-mix(in srgb, var(--c) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 30%, transparent);
}

.insp-titles { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }

.insp-name {
  font: inherit;
  font-family: var(--mono);
  font-size: 0.95rem;
  color: var(--text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 2px 4px;
  margin-left: -5px;
  width: 100%;
}

.insp-name:hover { border-color: var(--border); }
.insp-name:focus { outline: none; border-color: var(--accent); background: var(--bg); }
.insp-name.invalid { border-color: var(--bad); }
.insp-type { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--dim); }
.insp-type .step-type-badge { text-transform: none; letter-spacing: 0; }
.insp-pad { padding: 0 0.9rem; }

.insp-tabs { border-bottom: 1px solid var(--border); padding: 0 0.5rem; flex: none; }
.insp-body { flex: 1; overflow-y: auto; padding: 0.9rem; min-height: 0; }
.insp-blurb { font-size: 0.75rem; color: var(--muted); line-height: 1.5; margin-bottom: 0.9rem; }

.cases { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.case-row { display: grid; grid-template-columns: 18px minmax(0, 1.2fr) minmax(0, 1fr) auto; gap: 6px; align-items: center; width: 100%; }
.case-n { color: var(--dim); font-size: 0.7rem; }

.webhook-url { margin-top: 0.8rem; padding: 0.6rem 0.7rem; border: 1px dashed var(--border-strong); border-radius: 8px; overflow-wrap: anywhere; }

.hint-box { margin-top: 1.1rem; border-top: 1px solid var(--border); padding-top: 0.7rem; }
.hint-box summary { cursor: pointer; }
.hint-box p { margin-top: 0.5rem; }

.insp-actions { display: flex; gap: 0.5rem; margin-top: 1.2rem; flex-wrap: wrap; }

.run-nav { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.7rem; }
.run-error { color: #fca5a5; font-family: var(--mono); font-size: 0.75rem; margin-bottom: 0.7rem; overflow-wrap: anywhere; }
</style>
