import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import FlowsView from './views/FlowsView.vue';
import EditorView from './views/EditorView.vue';

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
    { path: '/:rest(.*)*', redirect: '/' },
  ],
});

createApp(App).use(router).mount('#app');
