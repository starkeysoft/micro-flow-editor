<template>
  <div class="toasts" aria-live="polite">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.tone">{{ t.text }}</div>
  </div>
</template>

<script setup>
import { toasts } from '../lib/toast.js';
</script>
