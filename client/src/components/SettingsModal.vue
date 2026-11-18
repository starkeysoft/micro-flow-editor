<template>
  <div class="scrim" @click.self="$emit('close')">
    <div class="modal settings" role="dialog" aria-labelledby="settings-title">
      <div class="settings-head">
        <h2 id="settings-title">Settings</h2>
        <button class="button ghost small icon" type="button" aria-label="Close" @click="$emit('close')">✕</button>
      </div>

      <!-- Sign-in on/off -->
      <section class="block">
        <div class="row">
          <div>
            <h3 class="label">Sign-in</h3>
            <p class="field-hint">
              When on, the editor and its API need an account. Webhook URLs (/webhook/…) stay open so outside callers still work.
            </p>
          </div>
          <label class="switch" :title="session.auth_locked ? lockedText : ''">
            <input type="checkbox" :checked="session.auth_enabled" :disabled="session.auth_locked || busy" @change="toggle($event)" />
            <span class="track"></span>
            <span class="label">{{ session.auth_enabled ? 'On' : 'Off' }}</span>
          </label>
        </div>
        <p v-if="session.auth_locked" class="field-hint locked">🔒 {{ lockedText }}</p>

        <!-- Turning it on asks for an account in the same step -->
        <form v-if="enabling" class="enable-form" @submit.prevent="enable">
          <p class="field-hint">
            {{ session.has_users
              ? 'Sign in with an existing account to turn sign-in on.'
              : 'Create the first account. You can add more accounts afterwards.' }}
          </p>
          <div class="field">
            <label class="label" for="en-user">Username</label>
            <input id="en-user" v-model="form.username" class="input" autocomplete="username" autocapitalize="off" spellcheck="false" required />
          </div>
          <div class="field">
            <label class="label" for="en-pass">Password</label>
            <input id="en-pass" v-model="form.password" class="input" type="password" :autocomplete="session.has_users ? 'current-password' : 'new-password'" required />
          </div>
          <div v-if="!session.has_users" class="field">
            <label class="label" for="en-repeat">Repeat password</label>
            <input id="en-repeat" v-model="form.repeat" class="input" type="password" autocomplete="new-password" required />
            <p class="field-hint">At least 8 characters.</p>
          </div>
          <p v-if="error" class="field-error" role="alert">{{ error }}</p>
          <div class="actions">
            <button class="button ghost small" type="button" @click="cancelEnable">Cancel</button>
            <button class="button small" type="submit" :disabled="busy">Turn sign-in on</button>
          </div>
        </form>
      </section>

      <template v-if="session.auth_enabled && session.user">
        <!-- Your account -->
        <section class="block">
          <div class="row">
            <div>
              <h3 class="label">Your account</h3>
              <p class="me mono">{{ session.user.username }}</p>
            </div>
            <button class="button ghost small" type="button" @click="logout">Sign out</button>
          </div>
          <details class="password" :open="passwordOpen" @toggle="passwordOpen = $event.target.open">
            <summary class="label">Change password</summary>
            <form @submit.prevent="changePassword">
              <div class="field">
                <label class="label" for="pw-current">Current password</label>
                <input id="pw-current" v-model="pw.current" class="input" type="password" autocomplete="current-password" required />
              </div>
              <div class="field">
                <label class="label" for="pw-new">New password</label>
                <input id="pw-new" v-model="pw.next" class="input" type="password" autocomplete="new-password" required />
              </div>
              <div class="field">
                <label class="label" for="pw-repeat">Repeat new password</label>
                <input id="pw-repeat" v-model="pw.repeat" class="input" type="password" autocomplete="new-password" required />
                <p class="field-hint">Your other sessions are signed out.</p>
              </div>
              <div class="actions">
                <button class="button small" type="submit" :disabled="busy">Change password</button>
              </div>
            </form>
          </details>
        </section>

        <!-- Users -->
        <section class="block">
          <h3 class="label">Users <span class="count">{{ users.length }}</span></h3>
          <p class="field-hint">Every user can see and edit every flow.</p>
          <ul class="users">
            <li v-for="u in users" :key="u.id">
              <span class="mono">{{ u.username }}</span>
              <span class="when">{{ u.last_login_at ? `signed in ${ago(u.last_login_at)}` : 'never signed in' }}</span>
              <span v-if="u.id === session.user.id" class="badge dim">you</span>
              <button v-else class="button ghost small icon danger" type="button" :aria-label="`Delete ${u.username}`" @click="removeUser(u)">✕</button>
            </li>
          </ul>
          <form class="add-user" @submit.prevent="addUser">
            <input v-model="newUser.username" class="input" placeholder="username" aria-label="New username" autocapitalize="off" spellcheck="false" required />
            <input v-model="newUser.password" class="input" type="password" placeholder="password (8+ characters)" aria-label="New user's password" autocomplete="new-password" required />
            <button class="button small" type="submit" :disabled="busy">Add user</button>
          </form>
        </section>
      </template>

      <!-- MCP for AI agents -->
      <section v-if="mcpEnabled" class="block">
        <h3 class="label">AI agents (MCP)</h3>
        <p class="field-hint">
          Agents such as Claude Code can build, check and run flows through the MCP endpoint
          <span class="mono">{{ mcpUrl }}</span>.
          {{ session.auth_enabled
            ? 'They sign in with an API token, which acts as your account.'
            : 'While sign-in is off it is open to anyone who can reach this editor, like the rest of it.' }}
        </p>
        <div class="command">
          <code class="mono">{{ mcpCommand }}</code>
          <button class="button ghost small" type="button" @click="copy(mcpCommand)">Copy</button>
        </div>

        <template v-if="session.auth_enabled && session.user">
          <div v-if="newToken" class="new-token" role="status">
            <p class="field-hint">Copy the token "{{ newToken.name }}" now. It isn't shown again.</p>
            <div class="command">
              <code class="mono">{{ newToken.token }}</code>
              <button class="button ghost small" type="button" @click="copy(newToken.token)">Copy</button>
            </div>
          </div>
          <ul v-if="tokens.length" class="users">
            <li v-for="t in tokens" :key="t.id">
              <span class="mono">{{ t.name }}</span>
              <span class="when">{{ t.hint }}… · {{ t.last_used_at ? `used ${ago(t.last_used_at)}` : 'never used' }}</span>
              <button class="button ghost small icon danger" type="button" :aria-label="`Revoke ${t.name}`" @click="revokeToken(t)">✕</button>
            </li>
          </ul>
          <form class="add-token" @submit.prevent="createToken">
            <input v-model="tokenName" class="input" placeholder="token name, e.g. Claude Code" aria-label="New token name" maxlength="100" required />
            <button class="button small" type="submit" :disabled="busy">Create API token</button>
          </form>
        </template>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../lib/api.js';
import { session, loadSession } from '../lib/session.js';
import { toast } from '../lib/toast.js';
import { ago } from '../lib/format.js';

defineEmits(['close']);
const router = useRouter();

const busy = ref(false);
const error = ref('');
const enabling = ref(false);
const passwordOpen = ref(false);
const users = ref([]);
const form = reactive({ username: '', password: '', repeat: '' });
const pw = reactive({ current: '', next: '', repeat: '' });
const newUser = reactive({ username: '', password: '' });

const mcpEnabled = ref(false);
const tokens = ref([]);
const tokenName = ref('');
const newToken = ref(null);
const mcpUrl = `${location.origin}/mcp`;
const mcpCommand = computed(() => {
  const base = `claude mcp add --transport http micro-flow ${mcpUrl}`;
  if (!session.auth_enabled) return base;
  return `${base} --header "Authorization: Bearer ${newToken.value?.token ?? '<API token>'}"`;
});

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied', 'good', 1500);
  } catch {
    toast('Couldn\'t copy: select the text and copy it yourself.', 'warn');
  }
}

async function loadTokens() {
  if (!session.auth_enabled || !session.user) return;
  try {
    tokens.value = await api.listTokens();
  } catch (e) {
    toast(e.message, 'bad');
  }
}

async function createToken() {
  busy.value = true;
  try {
    newToken.value = await api.createToken({ name: tokenName.value });
    tokenName.value = '';
    await loadTokens();
  } catch (e) {
    toast(e.message, 'bad', 6000);
  } finally {
    busy.value = false;
  }
}

async function revokeToken(token) {
  if (!confirm(`Revoke the API token "${token.name}"? Agents using it lose access straight away.`)) return;
  try {
    await api.deleteToken(token.id);
    if (newToken.value?.id === token.id) newToken.value = null;
    await loadTokens();
  } catch (e) {
    toast(e.message, 'bad');
  }
}

const lockedText = computed(() => `Set by the AUTH_ENABLED environment variable on the server, so it can't be changed here.`);

async function loadUsers() {
  if (!session.auth_enabled || !session.user) return;
  try {
    users.value = await api.listUsers();
  } catch (e) {
    toast(e.message, 'bad');
  }
}

async function toggle(event) {
  const on = event.target.checked;
  // Keep the switch showing the real state until the server agrees.
  event.target.checked = session.auth_enabled;
  if (on) {
    enabling.value = true;
    error.value = '';
    return;
  }
  if (!confirm('Turn sign-in off? Anyone who can reach this editor will be able to use it. Accounts are kept.')) return;
  busy.value = true;
  try {
    await api.disableAuth();
    await loadSession();
    users.value = [];
    tokens.value = [];
    newToken.value = null;
    toast('Sign-in is off', 'warn');
  } catch (e) {
    toast(e.message, 'bad', 6000);
  } finally {
    busy.value = false;
  }
}

function cancelEnable() {
  enabling.value = false;
  error.value = '';
  Object.assign(form, { username: '', password: '', repeat: '' });
}

async function enable() {
  error.value = '';
  if (!session.has_users && form.password !== form.repeat) {
    error.value = 'The passwords don\'t match.';
    return;
  }
  busy.value = true;
  try {
    await api.enableAuth({ username: form.username, password: form.password });
    await loadSession();
    cancelEnable();
    await loadUsers();
    await loadTokens();
    toast(`Sign-in is on. You're signed in as ${session.user.username}.`, 'good', 5000);
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

async function logout() {
  try {
    await api.logout();
  } finally {
    await loadSession();
    router.push('/login');
  }
}

async function changePassword() {
  if (pw.next !== pw.repeat) return toast('The new passwords don\'t match.', 'warn');
  busy.value = true;
  try {
    await api.changePassword({ current_password: pw.current, new_password: pw.next });
    Object.assign(pw, { current: '', next: '', repeat: '' });
    passwordOpen.value = false;
    toast('Password changed', 'good');
  } catch (e) {
    toast(e.message, 'bad', 6000);
  } finally {
    busy.value = false;
  }
}

async function addUser() {
  busy.value = true;
  try {
    await api.addUser({ ...newUser });
    toast(`Added ${newUser.username}`, 'good');
    Object.assign(newUser, { username: '', password: '' });
    await loadUsers();
  } catch (e) {
    toast(e.message, 'bad', 6000);
  } finally {
    busy.value = false;
  }
}

async function removeUser(user) {
  if (!confirm(`Delete the account "${user.username}"? They are signed out straight away.`)) return;
  try {
    await api.deleteUser(user.id);
    await loadUsers();
  } catch (e) {
    toast(e.message, 'bad');
  }
}

watch(() => session.auth_enabled, (on) => { if (!on) enabling.value = false; });

onMounted(async () => {
  await loadSession().catch(() => {});
  loadUsers();
  loadTokens();
  api.meta().then((meta) => { mcpEnabled.value = Boolean(meta.mcp_enabled); }).catch(() => {});
});
</script>

<style scoped>
.settings { width: min(520px, 100%); }
.settings-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem; }
.settings-head h2 { margin-bottom: 0; }

.block { padding: 1rem 0; border-top: 1px solid var(--border); }
.block:first-of-type { border-top: none; }
.block h3 { font-weight: 600; margin-bottom: 0.3rem; }
.block .count { color: var(--accent-text); margin-left: 4px; }
.row { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.row .switch { margin-top: 2px; flex: none; }
.locked { margin-top: 0.6rem; }

.enable-form { margin-top: 0.9rem; padding: 0.9rem; border: 1px dashed var(--border-strong); border-radius: 10px; display: flex; flex-direction: column; gap: 0.6rem; }
.enable-form .field + .field { margin-top: 0; }
.actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.4rem; }

.me { color: var(--accent-text); font-size: 0.9rem; }
.password { margin-top: 0.8rem; }
.password summary { cursor: pointer; }
.password form { margin-top: 0.7rem; }

.users { list-style: none; display: flex; flex-direction: column; gap: 4px; margin: 0.6rem 0 0.8rem; }
.users li { display: flex; align-items: center; gap: 0.6rem; padding: 0.35rem 0.6rem; min-height: 40px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; }
.users .mono { color: var(--accent-text); font-size: 0.82rem; }
.users .when { font-size: 0.68rem; color: var(--dim); margin-right: auto; }

.add-user { display: grid; grid-template-columns: 1fr 1fr auto; gap: 6px; }

.command { display: flex; align-items: center; gap: 6px; margin-top: 0.6rem; padding: 0.4rem 0.4rem 0.4rem 0.7rem; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; }
.command code { flex: 1; min-width: 0; font-size: 0.74rem; overflow-wrap: anywhere; user-select: all; }
.command .button { flex: none; }
.new-token { margin-top: 0.8rem; padding: 0.7rem; border: 1px dashed var(--border-strong); border-radius: 10px; }
.new-token .command { margin-top: 0.4rem; }
.add-token { display: grid; grid-template-columns: 1fr auto; gap: 6px; margin-top: 0.8rem; }

@media (max-width: 520px) {
  .add-user, .add-token { grid-template-columns: 1fr; }
}
</style>
