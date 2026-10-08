// Thin wrappers around the REST API (server/api/flows.js).
async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `${res.status} ${res.statusText}`);
    error.status = res.status;
    error.node_id = data.node_id ?? null;
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
};
