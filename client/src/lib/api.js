// Thin wrappers around the REST API (server/api/flows.js, server/auth.js).
import { signedOut } from './session.js';

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.auth_required) signedOut();
  if (!res.ok) {
    const error = new Error(data.error || `${res.status} ${res.statusText}`);
    error.status = res.status;
    error.node_id = data.node_id ?? null;
    error.deactivated = Boolean(data.deactivated);
    throw error;
  }
  return data;
}

export const api = {
  meta: () => request('GET', '/api/meta'),
  listFlows: () => request('GET', '/api/flows'),
  createFlow: (body) => request('POST', '/api/flows', body),
  getFlow: (id) => request('GET', `/api/flows/${id}`),
  updateFlow: (id, body) => request('PUT', `/api/flows/${id}`, body),
  deleteFlow: (id) => request('DELETE', `/api/flows/${id}`),
  duplicateFlow: (id) => request('POST', `/api/flows/${id}/duplicate`),
  importFlow: (body) => request('POST', '/api/flows/import', body),
  exportUrl: (id) => `/api/flows/${id}/export`,
  runFlow: (id, body) => request('POST', `/api/flows/${id}/run`, body),
  preview: (id, body) => request('POST', `/api/flows/${id}/preview`, body),
  listExecutions: (id) => request('GET', `/api/flows/${id}/executions`),
  clearExecutions: (id) => request('DELETE', `/api/flows/${id}/executions`),
  getExecution: (id) => request('GET', `/api/executions/${id}`),
  deleteExecution: (id) => request('DELETE', `/api/executions/${id}`),
  stopExecution: (id) => request('POST', `/api/executions/${id}/stop`),

  // Autosave and snapshots
  saveDraft: (id, body) => request('PUT', `/api/flows/${id}/draft`, body),
  listSnapshots: (id) => request('GET', `/api/flows/${id}/snapshots`),
  createSnapshot: (id, body) => request('POST', `/api/flows/${id}/snapshots`, body),
  getSnapshot: (id) => request('GET', `/api/snapshots/${id}`),
  deleteSnapshot: (id) => request('DELETE', `/api/snapshots/${id}`),
  snapshotExportUrl: (id) => `/api/snapshots/${id}/export`,

  // Archive
  archiveFlow: (id) => request('POST', `/api/flows/${id}/archive`),
  listArchived: () => request('GET', '/api/archive'),
  getArchived: (id) => request('GET', `/api/archive/${id}`),
  unarchiveFlow: (id) => request('POST', `/api/archive/${id}/unarchive`),
  deleteArchived: (id) => request('DELETE', `/api/archive/${id}`),
  archivedExportUrl: (id) => `/api/archive/${id}/export`,

  // Sign-in
  login: (body) => request('POST', '/api/auth/login', body),
  setup: (body) => request('POST', '/api/auth/setup', body),
  logout: () => request('POST', '/api/auth/logout'),
  enableAuth: (body) => request('POST', '/api/auth/enable', body),
  disableAuth: () => request('POST', '/api/auth/disable'),
  changePassword: (body) => request('POST', '/api/auth/password', body),
  listUsers: () => request('GET', '/api/auth/users'),
  addUser: (body) => request('POST', '/api/auth/users', body),
  deleteUser: (id) => request('DELETE', `/api/auth/users/${id}`),
};
