<template>
  <div class="json-block">
    <button v-if="copyable" class="copy button ghost small" type="button" @click="copy">{{ copied ? 'Copied' : 'Copy' }}</button>
    <pre class="json" v-html="html"></pre>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { highlight } from '../lib/format.js';

const props = defineProps({
  value: { default: undefined },
  copyable: { type: Boolean, default: true },
});

const html = computed(() => highlight(props.value));
const copied = ref(false);

async function copy() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(props.value, null, 2));
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1200);
  } catch { /* clipboard needs a secure context */ }
}
</script>

<style scoped>
.json-block { position: relative; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 0.6rem 0.7rem; max-height: 340px; overflow: auto; }
.copy { position: sticky; float: right; top: 0; margin-left: 0.5rem; }
</style>
