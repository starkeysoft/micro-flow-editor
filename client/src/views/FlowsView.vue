<template>
  <div class="flows-page">
    <header class="flows-header">
      <div class="brand">
        <span class="logo" aria-hidden="true"></span>
        <h1>micro-flow &mdash; editor</h1>
      </div>
      <div class="header-actions">
        <label class="button ghost">
          Import
          <input type="file" accept="application/json,.json" hidden @change="importFile" />
        </label>
        <button class="button" type="button" @click="create()">New flow</button>
      </div>
    </header>

    <main class="flows-main">
      <section>
        <div class="section-head">
          <h2 class="panel-title">Flows <span v-if="flows.length" class="count">{{ flows.length }}</span></h2>
          <input v-if="flows.length > 4" v-model="query" class="input search" type="search" placeholder="Search flows…" aria-label="Search flows" />
        </div>

        <p v-if="loading" class="empty">Loading…</p>
        <p v-else-if="error" class="empty">Could not load flows: {{ error }}</p>
        <p v-else-if="!flows.length" class="empty">No flows yet. Start a new one, or pick a template below.</p>

        <ul class="flow-list">
          <li v-for="flow in filtered" :key="flow.id" class="flow-card" :class="{ active: flow.active }">
            <RouterLink :to="`/flows/${flow.id}`" class="flow-link">
              <span class="flow-name">{{ flow.name }}</span>
              <span v-if="flow.description" class="flow-desc">{{ flow.description }}</span>
              <span class="flow-meta">
                <span v-for="t in flow.triggers" :key="t" class="badge">{{ triggerLabel(t) }}</span>
                <span class="badge dim">{{ flow.node_count }} nodes</span>
                <span v-if="flow.last_execution" class="badge" :class="statusTone(flow.last_execution.status)">
                  {{ flow.last_execution.status }} · {{ ago(flow.last_execution.started_at) }}
                </span>
              </span>
            </RouterLink>
            <div class="flow-foot">
              <label class="switch" :title="canActivate(flow) ? 'Listen on Schedule/Webhook triggers' : 'Add a Schedule or Webhook trigger to activate'">
                <input type="checkbox" :checked="flow.active" :disabled="!canActivate(flow)" @change="toggleActive(flow, $event.target.checked)" />
                <span class="track"></span>
                <span class="label">{{ flow.active ? 'Active' : 'Inactive' }}</span>
              </label>
              <span class="updated">edited {{ ago(flow.updated_at) }}</span>
              <div class="card-actions">
                <button class="button ghost small icon" type="button" title="Duplicate" aria-label="Duplicate" @click="duplicate(flow)">⧉</button>
                <a class="button ghost small icon" :href="api.exportUrl(flow.id)" title="Export JSON" aria-label="Export JSON">⇩</a>
                <button class="button ghost small icon danger" type="button" title="Delete" aria-label="Delete" @click="remove(flow)">✕</button>
              </div>
            </div>
          </li>
        </ul>
      </section>

      <section class="templates">
        <h2 class="panel-title">Start from a template</h2>
        <ul class="template-list">
          <li v-for="t in TEMPLATES" :key="t.key">
            <button class="template" type="button" @click="create(t)">
              <span class="flow-name">{{ t.title }}</span>
              <span class="flow-desc">{{ t.description }}</span>
            </button>
          </li>
        </ul>
      </section>

      <footer class="foot">
        Flows run on the server with
        <a href="https://www.npmjs.com/package/@ronaldroe/micro-flow" target="_blank" rel="noopener">@ronaldroe/micro-flow</a>.
        <span v-if="meta">Database: {{ meta.dialect }}.</span>
      </footer>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../lib/api.js';
import { toast } from '../lib/toast.js';
import { ago, statusTone } from '../lib/format.js';
import { NODE_TYPES } from '@shared/nodes.js';
import { TEMPLATES } from '@shared/templates.js';

const router = useRouter();
const flows = ref([]);
const loading = ref(true);
const error = ref('');
const query = ref('');
const meta = ref(null);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q ? flows.value.filter((f) => `${f.name} ${f.description}`.toLowerCase().includes(q)) : flows.value;
});

const triggerLabel = (type) => NODE_TYPES[type]?.title.replace(' Trigger', '') ?? type;
const canActivate = (flow) => flow.active || flow.triggers.some((t) => t === 'schedule' || t === 'webhook');

async function load() {
  try {
    flows.value = await api.listFlows();
    error.value = '';
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function create(template) {
  try {
    const flow = await api.createFlow(template
      ? { name: template.title, description: template.description, graph: template.graph, options: template.options }
      : { name: 'Untitled flow' });
    router.push(`/flows/${flow.id}`);
  } catch (e) {
    toast(e.message, 'bad');
  }
}

async function duplicate(flow) {
  try {
    await api.duplicateFlow(flow.id);
    toast(`Duplicated "${flow.name}"`, 'good');
    load();
  } catch (e) {
    toast(e.message, 'bad');
  }
}

async function remove(flow) {
  if (!confirm(`Delete "${flow.name}" and all of its executions?`)) return;
  try {
    await api.deleteFlow(flow.id);
    flows.value = flows.value.filter((f) => f.id !== flow.id);
    toast('Flow deleted');
  } catch (e) {
    toast(e.message, 'bad');
  }
}

async function toggleActive(flow, active) {
  try {
    const updated = await api.updateFlow(flow.id, { active });
    Object.assign(flow, { active: updated.active });
    toast(active ? `"${flow.name}" is listening` : `"${flow.name}" stopped listening`, active ? 'good' : 'info');
  } catch (e) {
    toast(e.message, 'bad', 6000);
    load();
  }
}

async function importFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const flow = await api.importFlow(data);
    router.push(`/flows/${flow.id}`);
  } catch (e) {
    toast(`Import failed: ${e.message}`, 'bad', 6000);
  }
}

onMounted(() => {
  document.title = 'micro-flow editor';
  load();
  api.meta().then((m) => { meta.value = m; }).catch(() => {});
});
</script>

<style scoped>
.flows-page { min-height: 100%; display: flex; flex-direction: column; align-items: center; padding: 0 16px 3rem; }

.flows-header {
  width: min(1040px, 100%);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 2rem 0 1.5rem;
}

.brand { display: flex; align-items: center; gap: 0.75rem; }
.logo { width: 28px; height: 28px; border-radius: 8px; background: var(--grad); box-shadow: 0 0 24px rgba(99, 102, 241, .55); }
.header-actions { display: flex; gap: 0.5rem; }
.header-actions label { cursor: pointer; }

.flows-main { width: min(1040px, 100%); display: flex; flex-direction: column; gap: 2.25rem; }

.section-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 0.8rem; min-height: 36px; }
.section-head .count { color: var(--accent-text); margin-left: 4px; }
.search { max-width: 260px; }

.flow-list, .template-list {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.flow-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--panel);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.flow-card:hover { border-color: var(--accent); box-shadow: 0 0 24px rgba(99, 102, 241, .25); }
.flow-card.active { border-top: 2px solid var(--good); }

.flow-link, .template {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 1rem 1.2rem 0.8rem;
  text-decoration: none;
  color: inherit;
}

.flow-name { font-family: var(--mono); color: var(--accent-text); font-size: 0.95rem; overflow-wrap: anywhere; }
.flow-desc { font-size: 0.75rem; color: var(--muted); line-height: 1.45; }
.flow-meta { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 0.3rem; }

.flow-foot {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.8rem 0.6rem 1.2rem;
  border-top: 1px solid var(--border);
}

.updated { font-size: 0.68rem; color: var(--dim); margin-left: auto; white-space: nowrap; }
.card-actions { display: flex; gap: 4px; }

.template {
  width: 100%;
  font: inherit;
  text-align: left;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
  background: transparent;
  cursor: pointer;
  padding-bottom: 1rem;
  height: 100%;
  transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
}

.template:hover { border-color: var(--accent); background: var(--panel); box-shadow: 0 0 24px rgba(99, 102, 241, .2); }
.templates .panel-title { margin-bottom: 0.8rem; }

.foot { font-size: 0.72rem; color: var(--dim); }

@media (max-width: 900px) {
  .flow-list, .template-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 600px) {
  .flows-header { padding: 1.25rem 0 1rem; }
  .flow-list, .template-list { grid-template-columns: 1fr; }
  .header-actions { width: 100%; }
  .header-actions > * { flex: 1; }
  .search { max-width: 50%; }
}
</style>
