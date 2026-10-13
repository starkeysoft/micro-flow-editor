import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import FlowsView from './views/FlowsView.vue';
import EditorView from './views/EditorView.vue';
import LoginView from './views/LoginView.vue';
import { session, loadSession, setSignedOutHandler } from './lib/session.js';

import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import '@vue-flow/controls/dist/style.css';
import '@vue-flow/minimap/dist/style.css';
import './styles/base.css';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: FlowsView, meta: { title: 'flows' } },
    { path: '/flows/:id', component: EditorView, props: true },
    { path: '/login', component: LoginView, meta: { public: true } },
    { path: '/:rest(.*)*', redirect: '/' },
  ],
});

// With sign-in on, every page but /login needs a signed-in user.
router.beforeEach(async (to) => {
  if (!session.loaded) {
    try { await loadSession(); } catch { /* server unreachable: let the page show its own error */ }
  }
  const needs_login = session.auth_enabled && !session.user;
  if (to.meta.public) return needs_login ? true : { path: typeof to.query.next === 'string' ? to.query.next : '/' };
  if (needs_login) return { path: '/login', query: to.fullPath !== '/' ? { next: to.fullPath } : {} };
  return true;
});

// An API call that comes back 401 (the session expired, or someone turned
// sign-in on) sends you to the login page.
setSignedOutHandler(() => {
  const current = router.currentRoute.value;
  if (current.meta.public) return;
  loadSession().finally(() => router.push({ path: '/login', query: { next: current.fullPath } }));
});

createApp(App).use(router).mount('#app');
