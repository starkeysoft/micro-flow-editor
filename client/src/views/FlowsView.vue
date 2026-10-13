<template>
  <div class="flows-page">
    <header class="flows-header">
      <div class="brand">
        <span class="logo" aria-hidden="true"></span>
        <h1>micro-flow &mdash; editor</h1>
      </div>
      <div class="header-actions">
        <button
          class="button ghost"
          type="button"
          :title="session.user ? `Signed in as ${session.user.username}` : 'Settings'"
          @click="showSettings = true"
        >
          {{ session.user ? session.user.username : 'Settings' }}
        </button>
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
                <span class="badge dim">{{ flow.node_count }} node{{ flow.node_count === 1 ? '' : 's' }}</span>
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
                <button class="button ghost small icon" type="button" title="Archive" aria-label="Archive" @click="archive(flow)">
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 3.5h12v3H2zM3 6.5v6h10v-6M6.5 9h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
                </button>
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

      <!-- Archived flows: collapsed by default -->
      <details class="archived" :open="archivedOpen" @toggle="archivedOpen = $event.target.open">
        <summary>
          <span class="panel-title">Archived</span>
          <span class="count">{{ archived.length }}</span>
        </summary>
        <p class="field-hint">
          Archived flows are out of the flow list and their triggers are off. Each keeps only its most recent snapshot; unarchiving brings the flow back from it.
        </p>
        <p v-if="!archived.length" class="empty">Nothing archived.</p>
        <ul v-else class="archived-list">
          <li v-for="a in archived" :key="a.id" class="archived-item">
            <div class="archived-main">
              <span class="flow-name">{{ a.name }}</span>
              <span v-if="a.description" class="flow-desc">{{ a.description }}</span>
              <span class="flow-meta">
                <span v-for="t in a.triggers" :key="t" class="badge">{{ triggerLabel(t) }}</span>
                <span class="badge dim">{{ a.node_count }} node{{ a.node_count === 1 ? '' : 's' }}</span>
                <span class="archived-when">archived {{ ago(a.archived_at) }}{{ a.archived_by ? ` by ${a.archived_by}` : '' }}</span>
              </span>
            </div>
            <div class="card-actions">
              <button class="button ghost small" type="button" @click="unarchive(a)">Unarchive</button>
              <a class="button ghost small icon" :href="api.archivedExportUrl(a.id)" title="Download JSON" aria-label="Download JSON">⇩</a>
              <button class="button ghost small icon danger" type="button" title="Delete permanently" aria-label="Delete permanently" @click="removeArchived(a)">✕</button>
            </div>
          </li>
        </ul>
      </details>

      <SettingsModal v-if="showSettings" @close="showSettings = false" />

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
import { session } from '../lib/session.js';
import SettingsModal from '../components/SettingsModal.vue';

const router = useRouter();
const flows = ref([]);
const loading = ref(true);
const error = ref('');
const query = ref('');
const meta = ref(null);
const showSettings = ref(false);
const archived = ref([]);
const archivedOpen = ref(false);

async function loadArchived() {
  try {
    archived.value = await api.listArchived();
  } catch { /* the section just shows nothing */ }
}

async function archive(flow) {
  if (!confirm(`Archive "${flow.name}"?\n\nIt leaves the flow list and its triggers stop. Only its most recent snapshot is kept (edits that aren't in a snapshot are saved as one first); its other snapshots and its execution history are deleted. Unarchive brings it back from that snapshot.`)) return;
  try {
    await api.archiveFlow(flow.id);
    flows.value = flows.value.filter((f) => f.id !== flow.id);
    await loadArchived();
    toast(`Archived "${flow.name}"`, 'good');
  } catch (e) {
    toast(e.message, 'bad');
  }
}

async function unarchive(item) {
  try {
    await api.unarchiveFlow(item.id);
    await Promise.all([load(), loadArchived()]);
    toast(`"${item.name}" is back (switched off)`, 'good');
  } catch (e) {
    toast(e.message, 'bad');
  }
}

async function removeArchived(item) {
  if (!confirm(`Delete the archived flow "${item.name}" permanently? This can't be undone.`)) return;
  try {
    await api.deleteArchived(item.id);
    archived.value = archived.value.filter((a) => a.id !== item.id);
    toast('Deleted permanently');
  } catch (e) {
    toast(e.message, 'bad');
  }
}

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
  loadArchived();
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

/* archived (collapsed by default) */
.archived { border-top: 1px solid var(--border); padding-top: 1rem; }
.archived summary { display: flex; align-items: center; gap: 0.5rem; cursor: pointer; list-style: none; min-height: 36px; }
.archived summary::-webkit-details-marker { display: none; }
.archived summary::before { content: '▸'; color: var(--dim); font-size: 0.75rem; transition: transform 0.15s; }
.archived[open] summary::before { transform: rotate(90deg); }
.archived .count { color: var(--accent-text); font-size: 0.72rem; }
.archived > .field-hint { margin: 0.4rem 0 0.8rem; }
.archived-list { list-style: none; display: flex; flex-direction: column; gap: 6px; }
.archived-item { display: flex; align-items: center; gap: 0.8rem; padding: 0.7rem 0.9rem; border: 1px dashed var(--border-strong); border-radius: var(--radius); background: rgba(19, 25, 42, .5); }
.archived-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.3rem; }
.archived-item .flow-name { color: var(--muted); }
.archived-when { font-size: 0.68rem; color: var(--dim); align-self: center; }

@media (max-width: 600px) {
  .archived-item { flex-direction: column; align-items: stretch; }
}

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
