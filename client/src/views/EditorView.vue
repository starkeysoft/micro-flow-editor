<template>
  <div class="editor" :class="{ narrow: isNarrow }">
    <!-- Top bar -->
    <header class="topbar">
      <RouterLink to="/" class="button ghost small icon" title="All flows" aria-label="All flows">←</RouterLink>
      <input
        v-model="flowName"
        class="flow-title"
        aria-label="Flow name"
        maxlength="200"
        @keydown.enter="$event.target.blur()"
      />
      <span class="save-state" :class="{ dirty }">{{ saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved' }}</span>

      <div class="topbar-tools">
        <button class="button ghost small icon wide-only" type="button" title="Undo (Ctrl+Z)" aria-label="Undo" :disabled="!history.canUndo.value" @click="undo">↶</button>
        <button class="button ghost small icon wide-only" type="button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" :disabled="!history.canRedo.value" @click="redo">↷</button>

        <label class="switch wide-only" :title="hasListeningTrigger ? 'Listen on Schedule and Webhook triggers' : 'Add a Schedule or Webhook trigger to activate'">
          <input type="checkbox" :checked="active" :disabled="!hasListeningTrigger && !active" @change="setActive($event.target.checked)" />
          <span class="track"></span>
          <span class="label">{{ active ? 'Active' : 'Inactive' }}</span>
        </label>

        <button class="button ghost small wide-only" type="button" title="Save (Ctrl+S)" :disabled="saving || !dirty" @click="save()">Save</button>
        <button v-if="!running" class="button small" type="button" title="Run (Ctrl+Enter)" :disabled="!loaded" @click="run()">▶ Run</button>
        <button v-else class="button small danger" type="button" title="Stop" @click="stop">■ Stop</button>

        <div class="menu-wrap">
          <button class="button ghost small icon" type="button" aria-label="More" :aria-expanded="menuOpen" @click.stop="menuOpen = !menuOpen">⋯</button>
          <div v-if="menuOpen" class="menu" role="menu" @click="menuOpen = false">
            <button v-if="isNarrow" type="button" :disabled="!dirty" @click="save()">Save <span class="kbd">Ctrl S</span></button>
            <button v-if="isNarrow" type="button" :disabled="!history.canUndo.value" @click="undo">Undo</button>
            <button v-if="isNarrow" type="button" :disabled="!history.canRedo.value" @click="redo">Redo</button>
            <label v-if="isNarrow" class="check" @click.stop>
              <input type="checkbox" :checked="active" :disabled="!hasListeningTrigger && !active" @change="setActive($event.target.checked)" /> Active (listen on triggers)
            </label>
            <hr v-if="isNarrow" />
            <label class="check" @click.stop>
              <input v-model="exitOnError" type="checkbox" /> Stop on first error (exit_on_error)
            </label>
            <button type="button" @click="fit">Fit view <span class="kbd">1</span></button>
            <button type="button" @click="tidy">Tidy layout</button>
            <hr />
            <a :href="api.exportUrl(id)">Export JSON</a>
            <button type="button" @click="duplicateFlow">Duplicate flow</button>
            <button type="button" @click="showDetails = true">Description…</button>
            <button type="button" @click="showShortcuts = true">Keyboard shortcuts</button>
            <hr />
            <button type="button" class="danger" @click="deleteFlow">Delete flow</button>
          </div>
        </div>
      </div>
    </header>

    <div class="workspace">
      <NodePalette v-if="!isNarrow" mode="dock" @add="addFromPalette" />

      <div ref="canvasWrap" class="canvas" @dragover.prevent="onDragOver" @drop.prevent="onDrop">
        <VueFlow
          v-if="loaded"
          id="editor"
          class="flow"
          :default-viewport="initialViewport"
          :min-zoom="0.2"
          :max-zoom="2"
          :snap-to-grid="true"
          :snap-grid="[20, 20]"
          :delete-key-code="['Delete', 'Backspace']"
          :multi-selection-key-code="['Shift', 'Meta', 'Control']"
          :connection-radius="isTouch ? 36 : 24"
          :is-valid-connection="isValidConnection"
          :default-edge-options="{ type: 'flow' }"
          :connect-on-click="true"
          :zoom-on-double-click="false"
          :pan-on-scroll="false"
          :select-nodes-on-drag="false"
          @connect="onConnect"
          @connect-start="onConnectStart"
          @connect-end="onConnectEnd"
          @node-click="onNodeClick"
          @pane-click="onPaneClick"
          @pane-ready="onPaneReady"
          @nodes-change="onNodesChange"
        >
          <template #node-flow="nodeProps">
            <FlowNode :id="nodeProps.id" :data="nodeProps.data" :selected="nodeProps.selected" />
          </template>
          <template #edge-flow="edgeProps">
            <FlowEdge v-bind="edgeProps" />
          </template>
          <Background variant="lines" :gap="24" pattern-color="rgba(255,255,255,.035)" />
          <Controls position="bottom-left" :show-interactive="false" />
          <MiniMap v-if="!isNarrow && nodes.length > 6" position="bottom-right" pannable zoomable :node-color="minimapColor" mask-color="rgba(19,25,42,.75)" :mask-stroke-color="'#6366f1'" :mask-stroke-width="2" />
        </VueFlow>

        <div v-if="loaded && nodes.length === 0" class="canvas-empty">
          <p>Empty flow. {{ isNarrow ? 'Tap + to add a trigger.' : 'Drag a trigger in from the left to start.' }}</p>
        </div>
        <p v-if="loadError" class="canvas-empty">{{ loadError }}</p>

        <StatusPanel class="canvas-status" v-bind="status" />

        <div v-if="isNarrow" class="fab-stack">
          <button class="fab" type="button" aria-label="Add node" @click="openSheetPalette()">+</button>
        </div>
      </div>

      <NodeInspector
        v-if="selectedNode && !isNarrow"
        :key="selectedNode.id"
        mode="dock"
        :node="selectedNode"
        :runs="nodeRuns[selectedNode.id] ?? []"
        :names="otherNames"
        :viewing="Boolean(viewing)"
        :initial-tab="inspectorTab"
        @close="deselect"
        @remove="removeNode(selectedNode.id)"
        @duplicate="duplicateNodes([selectedNode])"
        @rename="renameNode(selectedNode, $event)"
      />
    </div>

    <ExecutionDrawer
      v-model:open="drawerOpen"
      v-model:tab="drawerTab"
      :outputs="outputs"
      :log="log"
      :executions="executions"
      :viewing="viewing"
      :live-id="liveId"
      :preview="previewState"
      @open-execution="openExecution"
      @close-execution="closeExecution"
      @clear-executions="clearExecutions"
      @select-node="selectNode"
      @load-preview="loadPreview"
    />

    <!-- Mobile sheets -->
    <Transition name="sheet">
      <div v-if="isNarrow && sheet" class="sheet-scrim" @click.self="closeSheet">
        <div class="bottom-sheet">
          <div class="sheet-grip" aria-hidden="true"></div>
          <NodePalette
            v-if="sheet === 'palette'"
            mode="sheet"
            :connecting="Boolean(pendingConnect || pendingInsert)"
            @add="addFromPalette"
            @close="closeSheet"
          />
          <NodeInspector
            v-else-if="sheet === 'inspector' && selectedNode"
            :key="selectedNode.id"
            mode="sheet"
            :node="selectedNode"
            :runs="nodeRuns[selectedNode.id] ?? []"
            :names="otherNames"
            :viewing="Boolean(viewing)"
            :initial-tab="inspectorTab"
            @close="deselect"
            @remove="removeNode(selectedNode.id)"
            @duplicate="duplicateNodes([selectedNode])"
            @rename="renameNode(selectedNode, $event)"
          />
        </div>
      </div>
    </Transition>

    <!-- Desktop quick-add popover (wire dropped on empty canvas, or + on a wire) -->
    <div v-if="!isNarrow && quickAdd" class="quick-add" :style="{ left: `${quickAdd.x}px`, top: `${quickAdd.y}px` }" @click.stop>
      <NodePalette mode="sheet" connecting autofocus @add="addFromPalette" @close="cancelQuickAdd" />
    </div>

    <!-- Description modal -->
    <div v-if="showDetails" class="scrim" @click.self="showDetails = false">
      <div class="modal">
        <h2>Flow description</h2>
        <textarea v-model="flowDescription" class="input" rows="4" maxlength="1000" placeholder="What does this flow do?"></textarea>
        <div class="modal-actions">
          <button class="button" type="button" @click="showDetails = false">Done</button>
        </div>
      </div>
    </div>

    <!-- Shortcuts modal -->
    <div v-if="showShortcuts" class="scrim" @click.self="showShortcuts = false">
      <div class="modal">
        <h2>Keyboard shortcuts</h2>
        <dl class="shortcuts">
          <template v-for="[keys, what] in SHORTCUTS" :key="keys">
            <dt class="mono">{{ keys }}</dt><dd>{{ what }}</dd>
          </template>
        </dl>
        <div class="modal-actions">
          <button class="button" type="button" @click="showShortcuts = false">Close</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, provide, onMounted, onBeforeUnmount, nextTick, markRaw } from 'vue';
import { useRouter, onBeforeRouteLeave } from 'vue-router';
import { VueFlow, useVueFlow } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { MiniMap } from '@vue-flow/minimap';
import { NODE_TYPES, outputsOf, hasInput, isTrigger, defaultSettings } from '@shared/nodes.js';
import { api } from '../lib/api.js';
import { toast } from '../lib/toast.js';
import { fromGraph, toGraph, newId, edgeId, uniqueName, wouldCycle } from '../lib/graph.js';
import { createHistory } from '../lib/history.js';
import FlowNode from '../components/FlowNode.vue';
import FlowEdge from '../components/FlowEdge.vue';
import NodePalette from '../components/NodePalette.vue';
import NodeInspector from '../components/NodeInspector.vue';
import ExecutionDrawer from '../components/ExecutionDrawer.vue';
import StatusPanel from '../components/StatusPanel.vue';

const props = defineProps({ id: { type: String, required: true } });
const router = useRouter();

const {
  nodes, edges, addNodes, addEdges, removeNodes, removeEdges, setNodes, setEdges,
  screenToFlowCoordinate, fitView, getViewport, findNode, getSelectedNodes, addSelectedNodes, removeSelectedNodes,
} = useVueFlow('editor');

const SHORTCUTS = [
  ['Ctrl/⌘ + S', 'Save'],
  ['Ctrl/⌘ + Enter', 'Run the flow'],
  ['Ctrl/⌘ + Z', 'Undo'],
  ['Ctrl/⌘ + Shift + Z, Ctrl + Y', 'Redo'],
  ['Ctrl/⌘ + C / V', 'Copy / paste selected nodes'],
  ['Ctrl/⌘ + D', 'Duplicate selected nodes'],
  ['Ctrl/⌘ + A', 'Select all nodes'],
  ['Delete, Backspace', 'Delete the selection'],
  ['Shift + drag', 'Box-select nodes'],
  ['1', 'Fit the flow in view'],
  ['N', 'Focus node search'],
  ['Esc', 'Close panels / deselect'],
];

// ── Layout ──
const narrowQuery = window.matchMedia('(max-width: 760px)');
const isNarrow = ref(narrowQuery.matches);
const isTouch = window.matchMedia('(pointer: coarse)').matches;
const onNarrowChange = (e) => { isNarrow.value = e.matches; };
narrowQuery.addEventListener('change', onNarrowChange);

const canvasWrap = ref(null);
const menuOpen = ref(false);
const showDetails = ref(false);
const showShortcuts = ref(false);
const sheet = ref(null);          // null | 'palette' | 'inspector' (mobile)
const quickAdd = ref(null);       // { x, y } (desktop popover)
const drawerOpen = ref(!narrowQuery.matches);
const drawerTab = ref('output');
const inspectorTab = ref('params');

// ── Flow document ──
const loaded = ref(false);
const loadError = ref('');
const flowName = ref('');
const flowDescription = ref('');
const exitOnError = ref(true);
const active = ref(false);
const saving = ref(false);
const savedJson = ref('');
const savedMeta = ref('');
let initialViewport = { x: 0, y: 0, zoom: 1 };
let savedViewport = null;

const graphJson = computed(() => JSON.stringify(toGraph(nodes.value, edges.value)));
const metaJson = computed(() => JSON.stringify([flowName.value, flowDescription.value, exitOnError.value]));
const dirty = computed(() => loaded.value && (graphJson.value !== savedJson.value || metaJson.value !== savedMeta.value));
const hasListeningTrigger = computed(() => nodes.value.some((n) => ['schedule', 'webhook'].includes(n.data.type)));

// ── Selection ──
const selectedId = ref(null);
const selectedNode = computed(() => (selectedId.value ? nodes.value.find((n) => n.id === selectedId.value) ?? null : null));
const otherNames = computed(() => nodes.value.filter((n) => n.id !== selectedId.value).map((n) => n.data.name));

// ── Run state (shown on nodes, edges, inspector and drawer) ──
const runState = reactive({});   // node id → { status, count, running, branch }
const nodeRuns = reactive({});   // node id → [run entries]
const outputs = ref([]);
const log = ref([]);
const executions = ref([]);
const liveId = ref(null);
const liveStatus = ref(null);
const viewing = ref(null);
const running = computed(() => liveStatus.value === 'running');
const previewState = reactive({ loading: false, error: '', tree: null, serialized: null });
const status = reactive({ badge: '—', step: '—', detail: 'idle', state: 'idle', runs: 0, steps: 0 });

provide('runState', runState);
provide('nodeActions', markRaw({
  runFrom: (id) => run(id),
  removeEdge: (id) => removeEdges([id]),
  insertOnEdge: (id) => startInsert(id),
}));

// ── History ──
const history = createHistory();
let historyTimer = null;
watch(graphJson, (json) => {
  if (!loaded.value) return;
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => history.push(json), 300);
});

function applyGraph(json) {
  const graph = JSON.parse(json);
  const { nodes: n, edges: e } = fromGraph(graph);
  setNodes(n);
  setEdges(e);
  if (selectedId.value && !n.some((node) => node.id === selectedId.value)) deselect();
}

function undo() {
  clearTimeout(historyTimer);
  history.push(graphJson.value);
  const json = history.undo();
  if (json) applyGraph(json);
}

function redo() {
  const json = history.redo();
  if (json) applyGraph(json);
}

// ── Loading and saving ──
async function load() {
  try {
    const flow = await api.getFlow(props.id);
    flowName.value = flow.name;
    flowDescription.value = flow.description;
    exitOnError.value = flow.options?.exit_on_error !== false;
    active.value = flow.active;
    // A viewport saved on a big screen can leave a phone looking at nothing,
    // so phones always fit the flow instead.
    savedViewport = isNarrow.value ? null : flow.graph.viewport ?? null;
    if (savedViewport) initialViewport = savedViewport;
    const { nodes: n, edges: e } = fromGraph(flow.graph);
    setNodes(n);
    setEdges(e);
    loaded.value = true;
    await nextTick();
    savedJson.value = graphJson.value;
    savedMeta.value = metaJson.value;
    history.reset(graphJson.value);
    document.title = `${flow.name} · micro-flow editor`;
  } catch (e) {
    loadError.value = e.status === 404 ? 'This flow does not exist (it may have been deleted).' : `Could not load the flow: ${e.message}`;
  }
}

function onPaneReady() {
  if (!savedViewport) nextTick(() => fitView({ padding: isNarrow.value ? 0.08 : 0.2, maxZoom: 1 }));
}

async function save(extra = {}) {
  if (saving.value) return false;
  saving.value = true;
  const graph = { ...toGraph(nodes.value, edges.value), viewport: getViewport() };
  const json = graphJson.value;
  const meta = metaJson.value;
  try {
    const flow = await api.updateFlow(props.id, {
      name: flowName.value,
      description: flowDescription.value,
      graph,
      options: { exit_on_error: exitOnError.value },
      ...extra,
    });
    savedJson.value = json;
    savedMeta.value = meta;
    active.value = flow.active;
    document.title = `${flow.name} · micro-flow editor`;
    return true;
  } catch (e) {
    toast(e.message, 'bad', 7000);
    // Saving can succeed but deactivate the flow (bad cron, webhook clash).
    if (e.status === 400) {
      savedJson.value = json;
      savedMeta.value = meta;
      active.value = false;
    }
    return false;
  } finally {
    saving.value = false;
  }
}

async function setActive(value) {
  const ok = await save({ active: value });
  if (ok) toast(value ? 'Active: listening on Schedule and Webhook triggers' : 'Inactive', value ? 'good' : 'info');
}

async function duplicateFlow() {
  if (dirty.value && !(await save())) return;
  try {
    const copy = await api.duplicateFlow(props.id);
    router.push(`/flows/${copy.id}`);
  } catch (e) {
    toast(e.message, 'bad');
  }
}

async function deleteFlow() {
  if (!confirm(`Delete "${flowName.value}" and all of its executions?`)) return;
  try {
    await api.deleteFlow(props.id);
    savedJson.value = graphJson.value;
    savedMeta.value = metaJson.value;
    router.push('/');
  } catch (e) {
    toast(e.message, 'bad');
  }
}

// ── Adding, connecting and removing nodes ──
const NODE_W = 220;
const NODE_H = 90;
const pendingConnect = ref(null);   // { nodeId, handleId } while a wire dropped on the pane picks a node
const pendingInsert = ref(null);    // { edge } while the + on a wire picks a node
let connectStart = null;
let connectedThisDrag = false;
// Releasing a wire over the pane also fires a click on the pane, which would
// close the picker the wire just opened.
let connectEndedAt = 0;
let dropPosition = null;

function viewportCenter() {
  const rect = canvasWrap.value.getBoundingClientRect();
  const p = screenToFlowCoordinate({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  return { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 };
}

const snap = (v) => Math.round(v / 20) * 20;

function freeSpot(x, y) {
  let spot = { x: snap(x), y: snap(y) };
  const busy = (p) => nodes.value.some((n) => Math.abs(n.position.x - p.x) < NODE_W - 20 && Math.abs(n.position.y - p.y) < NODE_H);
  for (let i = 0; i < 20 && busy(spot); i++) spot = { x: spot.x, y: spot.y + 140 };
  return spot;
}

function makeNode(type, position) {
  const def = NODE_TYPES[type];
  return {
    id: newId(),
    type: 'flow',
    position,
    data: {
      type,
      name: uniqueName(def.title, nodes.value.map((n) => n.data.name)),
      config: structuredClone(def.defaults),
      settings: defaultSettings(),
    },
  };
}

function connectEdge(source, port, target) {
  const id = edgeId(source, port, target);
  if (edges.value.some((e) => e.id === id)) return;
  addEdges([{ id, type: 'flow', source, sourceHandle: port, target, targetHandle: 'in' }]);
}

const firstPort = (node) => outputsOf({ type: node.data.type, config: node.data.config })[0];

// One entry point for every way of adding a node from a palette.
function addFromPalette(type, position = null) {
  const def = NODE_TYPES[type];
  const needsWire = pendingConnect.value || pendingInsert.value;
  if (needsWire && def.kind === 'trigger') return toast('Triggers start a flow, so they have no input.', 'warn');

  let pos = position;
  let from = null;
  if (pendingInsert.value) {
    const edge = pendingInsert.value.edge;
    const a = findNode(edge.source);
    const b = findNode(edge.target);
    pos = { x: snap((a.position.x + b.position.x) / 2), y: snap((a.position.y + b.position.y) / 2 + 60) };
  } else if (pendingConnect.value) {
    pos = dropPosition ?? viewportCenter();
    from = pendingConnect.value;
  } else if (!pos) {
    // Click in the palette: add after the selected node, wired up.
    const sel = selectedNode.value;
    const port = sel && firstPort(sel);
    if (sel && port && def.kind !== 'trigger') {
      pos = freeSpot(sel.position.x + 280, sel.position.y);
      from = { nodeId: sel.id, handleId: port };
    } else {
      pos = freeSpot(viewportCenter().x, viewportCenter().y);
    }
  }

  const node = makeNode(type, { x: snap(pos.x), y: snap(pos.y) });
  addNodes([node]);
  if (from && hasInput({ type })) connectEdge(from.nodeId, from.handleId, node.id);
  if (pendingInsert.value) {
    const edge = pendingInsert.value.edge;
    removeEdges([edge.id]);
    connectEdge(edge.source, edge.sourceHandle, node.id);
    const out = outputsOf({ type, config: node.data.config })[0];
    if (out) connectEdge(node.id, out, edge.target);
  }

  pendingConnect.value = null;
  pendingInsert.value = null;
  quickAdd.value = null;
  dropPosition = null;
  selectNode(node.id);
}

function onDragOver(event) {
  event.dataTransfer.dropEffect = 'move';
}

function onDrop(event) {
  const type = event.dataTransfer.getData('application/x-micro-flow-node');
  if (!NODE_TYPES[type]) return;
  const p = screenToFlowCoordinate({ x: event.clientX, y: event.clientY });
  addFromPalette(type, { x: p.x - NODE_W / 2, y: p.y - 24 });
}

function isValidConnection(connection) {
  if (connection.source === connection.target) return false;
  if (connection.targetHandle !== 'in') return false;
  return !wouldCycle(edges.value, connection.source, connection.target);
}

function onConnect(connection) {
  connectedThisDrag = true;
  // Connections are always drawn from an output to an input.
  connectEdge(connection.source, connection.sourceHandle, connection.target);
}

const pointOf = (event) => event?.changedTouches?.[0] ?? event?.touches?.[0] ?? event;

function onConnectStart({ event, nodeId, handleId, handleType }) {
  const p = pointOf(event);
  connectStart = { nodeId, handleId, handleType, x: p?.clientX ?? 0, y: p?.clientY ?? 0 };
  connectedThisDrag = false;
}

// A wire dropped on empty canvas opens the node picker, n8n-style.
function onConnectEnd(event) {
  const start = connectStart;
  connectStart = null;
  connectEndedAt = Date.now();
  if (connectedThisDrag || !start || start.handleType !== 'source' || !event) return;
  const point = pointOf(event);
  // A tap on a port is not a drop: it starts tap-to-connect instead.
  if (Math.hypot(point.clientX - start.x, point.clientY - start.y) < 12) return;
  const target = document.elementFromPoint(point.clientX, point.clientY);
  if (!target?.closest('.vue-flow__pane') || target.closest('.vue-flow__node, .vue-flow__handle')) return;
  const p = screenToFlowCoordinate({ x: point.clientX, y: point.clientY });
  dropPosition = { x: p.x, y: p.y - 24 };
  pendingConnect.value = { nodeId: start.nodeId, handleId: start.handleId };
  openPicker(point.clientX, point.clientY);
}

function startInsert(id) {
  const edge = edges.value.find((e) => e.id === id);
  if (!edge) return;
  pendingInsert.value = { edge };
  const rect = canvasWrap.value.getBoundingClientRect();
  openPicker(rect.left + rect.width / 2, rect.top + rect.height / 3);
}

function openPicker(clientX, clientY) {
  if (isNarrow.value) {
    sheet.value = 'palette';
    return;
  }
  const x = Math.min(clientX, window.innerWidth - 340);
  const y = Math.min(clientY, window.innerHeight - 440);
  quickAdd.value = { x: Math.max(8, x), y: Math.max(56, y) };
}

function cancelQuickAdd() {
  quickAdd.value = null;
  pendingConnect.value = null;
  pendingInsert.value = null;
  dropPosition = null;
}

function openSheetPalette() {
  pendingConnect.value = null;
  pendingInsert.value = null;
  sheet.value = 'palette';
}

function closeSheet() {
  if (sheet.value === 'inspector') deselect();
  sheet.value = null;
  pendingConnect.value = null;
  pendingInsert.value = null;
}

function removeNode(id) {
  removeNodes([id], true);
  deselect();
}

function renameNode(node, name) {
  const taken = nodes.value.filter((n) => n.id !== node.id).map((n) => n.data.name);
  if (taken.includes(name)) toast(`"${name}" is taken. Node names must be unique.`, 'warn');
  node.data = { ...node.data, name };
}

function onNodesChange(changes) {
  for (const change of changes) {
    if (change.type === 'remove' && change.id === selectedId.value) deselect();
  }
}

// ── Selection ──
function selectNode(id, tab = 'params') {
  selectedId.value = id;
  inspectorTab.value = tab;
  removeSelectedNodes(getSelectedNodes.value);
  const node = findNode(id);
  if (node) addSelectedNodes([node]);
  if (isNarrow.value) sheet.value = 'inspector';
}

function deselect() {
  selectedId.value = null;
  if (sheet.value === 'inspector') sheet.value = null;
}

function onNodeClick({ event, node }) {
  // Tapping a port starts a connection; it shouldn't open the node.
  if (event?.target?.closest?.('.vue-flow__handle, .fnode-run')) return;
  // After a run, open straight to the node's data.
  selectNode(node.id, nodeRuns[node.id]?.length ? 'data' : 'params');
}

function onPaneClick() {
  if (Date.now() - connectEndedAt < 400) return;
  deselect();
  menuOpen.value = false;
  if (quickAdd.value) cancelQuickAdd();
}

const minimapColor = (node) => NODE_TYPES[node.data?.type]?.color ?? '#64748b';

function fit() {
  fitView({ padding: 0.2, maxZoom: 1, duration: 250 });
}

// Lays nodes out left-to-right by depth from the triggers.
function tidy() {
  const depth = new Map();
  const roots = nodes.value.filter((n) => isTrigger(n.data.type) || !edges.value.some((e) => e.target === n.id));
  const queue = roots.map((n) => [n.id, 0]);
  while (queue.length) {
    const [id, d] = queue.shift();
    if ((depth.get(id) ?? -1) >= d) continue;
    if (d > nodes.value.length) break;
    depth.set(id, d);
    for (const e of edges.value.filter((edge) => edge.source === id)) queue.push([e.target, d + 1]);
  }
  const columns = new Map();
  for (const node of nodes.value) {
    const d = depth.get(node.id) ?? 0;
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d).push(node);
  }
  for (const [d, column] of columns) {
    column.sort((a, b) => a.position.y - b.position.y);
    column.forEach((node, i) => {
      node.position = { x: d * 280, y: i * 140 - ((column.length - 1) * 140) / 2 };
    });
  }
  nextTick(fit);
}

// ── Clipboard ──
let clipboard = null;

function copySelection() {
  const selected = getSelectedNodes.value;
  if (!selected.length) return false;
  const ids = new Set(selected.map((n) => n.id));
  clipboard = JSON.stringify(toGraph(selected, edges.value.filter((e) => ids.has(e.source) && ids.has(e.target))));
  navigator.clipboard?.writeText(clipboard).catch(() => {});
  return true;
}

// Accepts copied nodes ({ nodes, edges }) or a whole export file ({ graph }).
function parseGraph(json) {
  try {
    const data = JSON.parse(json);
    const graph = Array.isArray(data?.nodes) ? data : data?.graph;
    return Array.isArray(graph?.nodes) ? graph : null;
  } catch {
    return null;
  }
}

function pasteGraph(json, offset = 40) {
  const graph = parseGraph(json);
  if (!graph) return;
  const ids = new Map();
  const names = nodes.value.map((n) => n.data.name);
  const fresh = graph.nodes.filter((n) => NODE_TYPES[n.type]).map((n) => {
    const id = newId();
    ids.set(n.id, id);
    const name = uniqueName(n.name, names);
    names.push(name);
    return fromGraph({ nodes: [{ ...n, id, name, x: n.x + offset, y: n.y + offset }], edges: [] }).nodes[0];
  });
  const freshEdges = (graph.edges ?? [])
    .filter((e) => ids.has(e.from) && ids.has(e.to))
    .map((e) => ({ id: edgeId(ids.get(e.from), e.port, ids.get(e.to)), type: 'flow', source: ids.get(e.from), sourceHandle: e.port, target: ids.get(e.to), targetHandle: 'in' }));
  addNodes(fresh);
  addEdges(freshEdges);
  nextTick(() => {
    removeSelectedNodes(getSelectedNodes.value);
    addSelectedNodes(fresh.map((n) => findNode(n.id)).filter(Boolean));
  });
}

function duplicateNodes(list) {
  const ids = new Set(list.map((n) => n.id));
  pasteGraph(JSON.stringify(toGraph(list, edges.value.filter((e) => ids.has(e.source) && ids.has(e.target)))));
}

// ── Running ──
function resetRunState() {
  for (const key of Object.keys(runState)) delete runState[key];
  for (const key of Object.keys(nodeRuns)) delete nodeRuns[key];
  outputs.value = [];
  log.value = [];
}

function applyNodeRun(node_id, entry) {
  (nodeRuns[node_id] ??= []).push(entry);
  const list = nodeRuns[node_id];
  runState[node_id] = { ...(runState[node_id] ?? {}), status: entry.status, count: list.filter((r) => r.status !== 'retrying').length, branch: entry.branch ?? runState[node_id]?.branch };
}

function describeNode(node_id) {
  const node = findNode(node_id);
  if (!node) return { name: node_id, micro: 'Step' };
  return { name: node.data.name, micro: NODE_TYPES[node.data.type]?.micro ?? 'Step' };
}

async function run(trigger_id = null) {
  if (running.value) return;
  const triggers = nodes.value.filter((n) => isTrigger(n.data.type));
  if (!triggers.length) return toast('Add a trigger first: every flow starts at one.', 'warn');
  if (!trigger_id && selectedNode.value && isTrigger(selectedNode.value.data.type)) trigger_id = selectedNode.value.id;
  viewing.value = null;
  resetRunState();
  liveStatus.value = 'running';
  Object.assign(status, { badge: 'Workflow', step: '—', detail: 'starting', state: 'running' });
  try {
    const { execution_id } = await api.runFlow(props.id, {
      graph: toGraph(nodes.value, edges.value),
      options: { exit_on_error: exitOnError.value },
      trigger_id,
    });
    liveId.value = execution_id;
    if (!drawerOpen.value && !isNarrow.value) drawerOpen.value = true;
  } catch (e) {
    liveStatus.value = null;
    Object.assign(status, { detail: 'could not start', state: 'error' });
    toast(e.message, 'bad', 6000);
    if (e.node_id) selectNode(e.node_id);
  }
}

async function stop() {
  if (!liveId.value) return;
  try {
    await api.stopExecution(liveId.value);
  } catch (e) {
    toast(e.message, 'warn');
  }
}

// ── Live updates over SSE ──
let source = null;

function handleMessage(msg) {
  if (msg.type === 'execution_started') {
    executions.value = [msg.execution, ...executions.value.filter((e) => e.id !== msg.execution.id)];
    // Follow every new run (manual, webhook or schedule) unless an old one is open.
    if (viewing.value) return;
    if (liveId.value !== msg.execution_id) resetRunState();
    liveId.value = msg.execution_id;
    liveStatus.value = 'running';
    Object.assign(status, { badge: 'Workflow', step: msg.execution.mode, detail: 'running', state: 'running' });
    return;
  }

  if (msg.type === 'execution_finished') {
    const i = executions.value.findIndex((e) => e.id === msg.execution.id);
    if (i >= 0) executions.value[i] = msg.execution;
    else executions.value.unshift(msg.execution);
    if (msg.execution_id !== liveId.value || viewing.value) return;
    liveStatus.value = msg.execution.status;
    for (const state of Object.values(runState)) state.running = false;
    status.runs++;
    Object.assign(status, {
      detail: msg.execution.status === 'success' ? 'complete' : msg.execution.status,
      state: msg.execution.status,
    });
    if (msg.execution.status === 'error') toast(`Run failed: ${msg.execution.error}`, 'bad', 6000);
    else if (msg.execution.status === 'stopped') toast('Run stopped', 'warn');
    return;
  }

  if (msg.execution_id !== liveId.value || viewing.value) return;

  if (msg.type === 'node_running') {
    runState[msg.node_id] = { ...(runState[msg.node_id] ?? {}), running: true };
    const { name, micro } = describeNode(msg.node_id);
    Object.assign(status, { badge: micro, step: name, detail: 'running' });
  } else if (msg.type === 'node_done') {
    if (runState[msg.node_id]) runState[msg.node_id].running = false;
  } else if (msg.type === 'node_run') {
    applyNodeRun(msg.node_id, msg.entry);
    if (msg.entry.status !== 'retrying') status.steps++;
    const { name, micro } = describeNode(msg.node_id);
    Object.assign(status, { badge: micro, step: name, detail: msg.entry.status });
  } else if (msg.type === 'log') {
    log.value.push(msg.entry);
  } else if (msg.type === 'output') {
    outputs.value.push(msg.card);
    if (drawerTab.value !== 'output' && outputs.value.length === 1) drawerTab.value = 'output';
  }
}

function connectStream() {
  if (source) return;
  source = new EventSource(`/api/flows/${props.id}/stream`);
  source.onmessage = (event) => {
    try { handleMessage(JSON.parse(event.data)); } catch (e) { console.error(e); }
  };
}

function disconnectStream() {
  source?.close();
  source = null;
}

// Browsers allow ~6 connections per host over HTTP/1.1, so hidden tabs let go.
function onVisibility() {
  if (document.hidden && !running.value) disconnectStream();
  else if (!document.hidden) connectStream();
}

// ── Executions ──
async function loadExecutions() {
  try {
    executions.value = await api.listExecutions(props.id);
  } catch { /* the list just stays empty */ }
}

async function openExecution(id) {
  if (id === liveId.value && !viewing.value) return;
  try {
    const execution = await api.getExecution(id);
    resetRunState();
    viewing.value = { id: execution.id, mode: execution.mode, started_at: execution.started_at, status: execution.status };
    for (const [node_id, entries] of Object.entries(execution.node_runs)) {
      for (const entry of entries) applyNodeRun(node_id, entry);
    }
    log.value = execution.log;
    outputs.value = execution.outputs;
    Object.assign(status, { badge: 'Workflow', step: execution.mode, detail: execution.status, state: execution.status });
    const missing = Object.keys(execution.node_runs).filter((nid) => !findNode(nid)).length;
    if (missing) toast(`${missing} node(s) from this execution are no longer in the flow.`, 'warn');
  } catch (e) {
    toast(e.message, 'bad');
  }
}

function closeExecution() {
  viewing.value = null;
  resetRunState();
  Object.assign(status, { badge: '—', step: '—', detail: 'idle', state: 'idle' });
}

async function clearExecutions() {
  if (!confirm('Delete every finished execution of this flow?')) return;
  await api.clearExecutions(props.id);
  if (viewing.value) closeExecution();
  loadExecutions();
}

async function loadPreview() {
  previewState.loading = true;
  previewState.error = '';
  try {
    const { tree, serialized } = await api.preview(props.id, { graph: toGraph(nodes.value, edges.value) });
    previewState.tree = tree;
    previewState.serialized = serialized;
  } catch (e) {
    previewState.error = e.message;
    previewState.tree = null;
    if (e.node_id) selectNode(e.node_id);
  } finally {
    previewState.loading = false;
  }
}

// Keep the micro-flow tab current while it is open.
let previewTimer = null;
watch(graphJson, () => {
  if (!drawerOpen.value || drawerTab.value !== 'micro') return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(loadPreview, 600);
});

// ── Keyboard ──
function onKeydown(event) {
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  const typing = event.target.closest?.('input, textarea, select, [contenteditable]');

  if (mod && key === 's') { event.preventDefault(); save(); return; }
  if (mod && key === 'enter') { event.preventDefault(); run(); return; }
  if (key === 'escape') {
    menuOpen.value = false;
    if (quickAdd.value) cancelQuickAdd();
    else if (sheet.value) closeSheet();
    else deselect();
    return;
  }
  if (typing) return;

  if (mod && key === 'z' && !event.shiftKey) { event.preventDefault(); undo(); }
  else if ((mod && key === 'z' && event.shiftKey) || (mod && key === 'y')) { event.preventDefault(); redo(); }
  else if (mod && key === 'c') { copySelection(); }
  else if (mod && key === 'v') {
    if (clipboard) { event.preventDefault(); pasteGraph(clipboard); }
  } else if (mod && key === 'd') {
    event.preventDefault();
    const selected = getSelectedNodes.value;
    if (selected.length) duplicateNodes(selected);
  } else if (mod && key === 'a') {
    event.preventDefault();
    addSelectedNodes(nodes.value);
  } else if (!mod && key === '1') {
    fit();
  } else if (!mod && key === 'n') {
    event.preventDefault();
    if (isNarrow.value) openSheetPalette();
    else document.querySelector('.palette.dock .palette-search')?.focus();
  }
}

// Paste flows copied from another tab (or exported JSON) via the system clipboard.
function onPaste(event) {
  if (event.target.closest?.('input, textarea')) return;
  const text = event.clipboardData?.getData('text');
  if (text && parseGraph(text)) {
    event.preventDefault();
    pasteGraph(text);
  }
}

function onBeforeUnload(event) {
  if (dirty.value) {
    event.preventDefault();
    event.returnValue = '';
  }
}

function onDocumentClick() {
  menuOpen.value = false;
}

onBeforeRouteLeave(() => !dirty.value || confirm('You have unsaved changes. Leave anyway?'));

onMounted(async () => {
  await load();
  loadExecutions();
  connectStream();
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('paste', onPaste);
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('click', onDocumentClick);
});

onBeforeUnmount(() => {
  disconnectStream();
  narrowQuery.removeEventListener('change', onNarrowChange);
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('paste', onPaste);
  window.removeEventListener('beforeunload', onBeforeUnload);
  document.removeEventListener('visibilitychange', onVisibility);
  document.removeEventListener('click', onDocumentClick);
  clearTimeout(historyTimer);
  clearTimeout(previewTimer);
});
</script>

<style scoped>
.editor {
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Top bar ── */
.topbar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.8rem;
  padding-top: max(0.55rem, env(safe-area-inset-top));
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex: none;
  z-index: 20;
}

.flow-title {
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 0.35rem 0.5rem;
  min-width: 0;
  flex: 0 1 340px;
}

.flow-title:hover { border-color: var(--border); }
.flow-title:focus { outline: none; border-color: var(--accent); color: var(--text); background: var(--bg); }

.save-state { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--dim); white-space: nowrap; }
.save-state.dirty { color: var(--warn); }

.topbar-tools { display: flex; align-items: center; gap: 0.45rem; margin-left: auto; }
.topbar-tools .switch { margin: 0 0.3rem; }

.menu-wrap { position: relative; }
.menu-wrap .menu { right: 0; top: calc(100% + 6px); }
.menu .check { padding: 0.55rem 0.7rem; }

/* ── Workspace ── */
.workspace { flex: 1; display: flex; min-height: 0; }

.canvas { position: relative; flex: 1; min-width: 0; background: #13192a; }
.flow { width: 100%; height: 100%; }

.canvas-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  color: var(--dim);
  font-size: 0.85rem;
  text-align: center;
  padding: 2rem;
}

.canvas-status { position: absolute; top: 12px; right: 12px; z-index: 5; }

.fab-stack { position: absolute; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 10px; z-index: 6; }

.fab {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  border: none;
  background: var(--grad);
  color: #fff;
  font-size: 1.6rem;
  line-height: 1;
  box-shadow: 0 0 24px rgba(99, 102, 241, .55), 0 6px 18px rgba(0, 0, 0, .4);
  cursor: pointer;
}

/* ── Quick-add popover ── */
.quick-add {
  position: fixed;
  z-index: 45;
  width: 320px;
  height: 420px;
  display: flex;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, .6);
}

.quick-add > * { flex: 1; }

/* ── Mobile sheets ── */
.sheet-scrim {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(2, 6, 23, .5);
  display: flex;
  align-items: flex-end;
}

.bottom-sheet {
  width: 100%;
  max-height: 82dvh;
  height: 82dvh;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border-top: 1px solid var(--border);
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -12px 40px rgba(0, 0, 0, .55);
  overflow: hidden;
  padding-bottom: env(safe-area-inset-bottom);
}

.bottom-sheet > :not(.sheet-grip) { flex: 1; min-height: 0; }
.sheet-grip { width: 40px; height: 4px; border-radius: 2px; background: var(--border-strong); margin: 8px auto 0; flex: none; }

.sheet-enter-active, .sheet-leave-active { transition: opacity 0.2s; }
.sheet-enter-active .bottom-sheet, .sheet-leave-active .bottom-sheet { transition: transform 0.25s ease; }
.sheet-enter-from, .sheet-leave-to { opacity: 0; }
.sheet-enter-from .bottom-sheet, .sheet-leave-to .bottom-sheet { transform: translateY(100%); }

.shortcuts { display: grid; grid-template-columns: auto 1fr; gap: 0.45rem 1rem; font-size: 0.8rem; }
.shortcuts dt { color: var(--accent-text); font-size: 0.75rem; }
.shortcuts dd { color: var(--muted); }

/* ── Phones ── */
@media (max-width: 760px) {
  .wide-only { display: none !important; }
  .topbar { gap: 0.4rem; padding-left: 0.5rem; padding-right: 0.5rem; }
  .flow-title { font-size: 0.8rem; flex: 1 1 auto; }
  .save-state { display: none; }
  .canvas-status { top: 8px; right: 8px; }
}
</style>

<style>
/* Vue Flow theme overrides, in the demo palette. */
.vue-flow .vue-flow__controls { box-shadow: 0 8px 24px rgba(0, 0, 0, .45); border-radius: 10px; overflow: hidden; border: 1px solid var(--border); }
.vue-flow .vue-flow__controls .vue-flow__controls-button { background: var(--panel); border-bottom: 1px solid var(--border); width: 30px; height: 30px; }
.vue-flow .vue-flow__controls .vue-flow__controls-button:hover { background: #1a2238; }
.vue-flow .vue-flow__controls .vue-flow__controls-button svg { fill: var(--accent-text); }
.vue-flow .vue-flow__minimap { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.vue-flow .vue-flow__minimap svg { background: var(--bg); }
.vue-flow__selection, .vue-flow__nodesselection-rect { background: rgba(99, 102, 241, .08); border: 1px dashed var(--accent); }
.vue-flow__connection-path { stroke: var(--accent-2); stroke-width: 2; }
.vue-flow__node-flow { padding: 0; border: none; background: none; width: auto; }
.vue-flow__node.selected, .vue-flow__node:focus-visible { outline: none; }
.vue-flow__handle.connectionindicator:hover, .vue-flow__handle.connecting { background: var(--accent); }
.vue-flow__handle.valid { background: var(--good); border-color: var(--good); }

@media (max-width: 760px) {
  .vue-flow .vue-flow__controls { display: none; }
}
</style>
