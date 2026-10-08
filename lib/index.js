// @ronaldroe/micro-flow-editor
//
//   import { startServer } from '@ronaldroe/micro-flow-editor';
//   const editor = await startServer({ port: 8090, database_url: 'postgres://…' });
//   // … later: await editor.close();
//
// The standalone runtime (run exported flows in your own app) is also
// re-exported here, and on its own at '@ronaldroe/micro-flow-editor/runtime'.
export * from '../runtime/index.js';

const ENV = {
  port: 'PORT',
  database_url: 'DATABASE_URL',
  sqlite_path: 'SQLITE_PATH',
  db_logging: 'DB_LOGGING',
  block_private_networks: 'BLOCK_PRIVATE_NETWORKS',
  max_concurrent_runs: 'MAX_CONCURRENT_RUNS',
  max_loop_iterations: 'MAX_LOOP_ITERATIONS',
  max_executions_per_flow: 'MAX_EXECUTIONS_PER_FLOW',
};

let started = null;
let closed = false;

/**
 * Starts the editor server (UI, REST API, webhooks and schedules) in this
 * process. Options override the matching environment variables. One editor
 * per process: later calls return the running one, and once it has been
 * closed it can't be started again in the same process.
 * @param {object} [options] - port, database_url, sqlite_path, db_logging,
 *   block_private_networks, max_concurrent_runs, max_loop_iterations, max_executions_per_flow
 * @returns {Promise<{ app: import('express').Express, server: import('http').Server, close: () => Promise<void> }>}
 */
export async function startServer(options = {}) {
  if (closed) throw new Error('startServer(): the editor was closed; start a new process to run it again');
  if (started) return started;
  for (const [key, value] of Object.entries(options)) {
    if (!ENV[key]) throw new Error(`startServer(): unknown option "${key}"`);
    if (value !== undefined && value !== null) process.env[ENV[key]] = String(value);
  }
  started = import('../server/server.js')
    .then(({ start }) => start())
    .then((editor) => ({
      ...editor,
      close: async () => {
        closed = true;
        await editor.close();
      },
    }))
    .catch((error) => {
      // A failed start (e.g. the database is unreachable) may be retried.
      started = null;
      throw error;
    });
  return started;
}
