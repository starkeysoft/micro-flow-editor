<template>
  <div class="login-page">
    <form class="login-card" @submit.prevent="submit">
      <div class="brand">
        <span class="logo" aria-hidden="true"></span>
        <h1>micro-flow &mdash; editor</h1>
      </div>

      <h2 class="panel-title">{{ setup ? 'Create the first account' : 'Sign in' }}</h2>
      <p v-if="setup" class="field-hint">
        Sign-in is on and this server has no accounts yet. The account you create here can add others later.
      </p>

      <div class="field">
        <label class="label" for="login-username">Username</label>
        <input id="login-username" v-model="username" class="input" autocomplete="username" autocapitalize="off" spellcheck="false" required autofocus />
      </div>
      <div class="field">
        <label class="label" for="login-password">Password</label>
        <input id="login-password" v-model="password" class="input" type="password" :autocomplete="setup ? 'new-password' : 'current-password'" required />
      </div>
      <div v-if="setup" class="field">
        <label class="label" for="login-repeat">Repeat password</label>
        <input id="login-repeat" v-model="repeat" class="input" type="password" autocomplete="new-password" required />
        <p class="field-hint">At least 8 characters.</p>
      </div>

      <p v-if="error" class="field-error" role="alert">{{ error }}</p>

      <button class="button" type="submit" :disabled="busy">{{ busy ? 'One moment…' : setup ? 'Create account' : 'Sign in' }}</button>
    </form>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../lib/api.js';
import { session, loadSession } from '../lib/session.js';

const route = useRoute();
const router = useRouter();
const username = ref('');
const password = ref('');
const repeat = ref('');
const error = ref('');
const busy = ref(false);

const setup = computed(() => session.needs_setup);

async function submit() {
  error.value = '';
  if (setup.value && password.value !== repeat.value) {
    error.value = 'The passwords don\'t match.';
    return;
  }
  busy.value = true;
  try {
    const body = { username: username.value, password: password.value };
    await (setup.value ? api.setup(body) : api.login(body));
    await loadSession();
    const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/';
    router.replace(next);
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  document.title = 'Sign in · micro-flow editor';
});
</script>

<style scoped>
.login-page {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 24px 16px;
}

.login-card {
  width: min(380px, 100%);
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 1.6rem 1.5rem;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 20px 60px rgba(0, 0, 0, .5);
}

.login-card .field + .field { margin-top: 0; }
.brand { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 0.4rem; }
.logo { width: 26px; height: 26px; border-radius: 8px; background: var(--grad); box-shadow: 0 0 24px rgba(99, 102, 241, .55); flex: none; }
.brand h1 { font-size: 0.95rem; }
.login-card .button { margin-top: 0.3rem; }
</style>
