<template>
  <div class="status-panel" :class="{ collapsed }" @click="collapsed && (collapsed = false)">
    <h2>
      <span class="dot" :class="state" aria-hidden="true"></span>
      Workflow Status
      <button class="collapse" type="button" :aria-label="collapsed ? 'Expand status' : 'Collapse status'" @click.stop="collapsed = !collapsed">{{ collapsed ? '▸' : '▾' }}</button>
    </h2>
    <template v-if="!collapsed">
      <div class="step-type-badge">{{ badge }}</div>
      <div class="stat-row">
        <span class="stat-label">Step</span>
        <span class="stat-value">{{ step }}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Status</span>
        <span class="stat-value" :class="state">{{ detail }}</span>
      </div>
      <div class="counter">
        Runs: <span>{{ runs }}</span> ·
        Steps run: <span>{{ steps }}</span>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref } from 'vue';

defineProps({
  badge: { type: String, default: '—' },
  step: { type: String, default: '—' },
  detail: { type: String, default: 'idle' },
  state: { type: String, default: 'idle' }, // idle | running | success | error | stopped
  runs: { type: Number, default: 0 },
  steps: { type: Number, default: 0 },
});

const collapsed = ref(window.matchMedia('(max-width: 760px)').matches);
</script>

<style scoped>
.status-panel { width: 240px; pointer-events: auto; }
.status-panel.collapsed { width: auto; padding: 0.55rem 0.8rem; cursor: pointer; }
.status-panel.collapsed h2 { margin-bottom: 0; }
h2 { display: flex; align-items: center; gap: 7px; }
.collapse { margin-left: auto; background: none; border: none; color: var(--dim); cursor: pointer; font-size: 0.75rem; padding: 0 2px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dim); flex: none; }
.dot.running { background: var(--accent-2); box-shadow: 0 0 8px rgba(139, 92, 246, .9); animation: blink 1s infinite; }
.dot.success { background: var(--good); box-shadow: 0 0 8px rgba(52, 211, 153, .8); }
.dot.error { background: var(--bad); }
.dot.stopped { background: var(--warn); }
.stat-value.success { color: var(--good); }
.stat-value.error { color: #fca5a5; }
.stat-value.stopped { color: var(--warn); }
@keyframes blink { 50% { opacity: .35; } }
</style>
