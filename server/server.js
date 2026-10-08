import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { initDatabase, sequelize } from './db.js';
import { router as flowsRouter } from './api/flows.js';
import { router as streamRouter } from './api/stream.js';
import { router as webhooksRouter } from './api/webhooks.js';
import { markInterrupted } from './engine/runner.js';
import { registerAll, unregisterAll } from './engine/triggers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client_dir = path.join(root, 'dist');

/**
 * Starts the editor: connects the database, re-activates active flows and
 * listens for HTTP. Settings come from config.js (environment variables).
 * @returns {Promise<{ app, server, close: () => Promise<void> }>}
 */
export async function start() {
  await initDatabase();
  await markInterrupted();
  await registerAll();

  const app = express();
  app.disable('x-powered-by');

  // Webhooks accept JSON, form and plain-text bodies.
  app.use('/webhook', express.json({ limit: '1mb' }), express.urlencoded({ extended: true, limit: '1mb' }), express.text({ limit: '1mb' }));
  app.use(webhooksRouter);

  app.use('/api', express.json({ limit: '4mb' }));
  app.get('/api/meta', (req, res) => res.json({
    dialect: sequelize.getDialect(),
    block_private_networks: config.block_private_networks,
    max_loop_iterations: config.max_loop_iterations,
  }));
  app.use('/api', flowsRouter, streamRouter);
  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

  // The node catalogue is shared with the browser.
  app.use('/shared', express.static(path.join(root, 'shared')));

  // The Vue app (built by `npm run build` into dist/). Unknown paths fall back
  // to index.html so client-side routes like /flows/<id> load directly.
  if (fs.existsSync(path.join(client_dir, 'index.html'))) {
    app.use(express.static(client_dir, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (req, res) => res.sendFile(path.join(client_dir, 'index.html')));
  } else {
    app.get('/', (req, res) => res.type('text').send('The editor has not been built yet. Run `npm run build`, or use `npm run dev` for the Vite dev server.'));
  }

  const server = await new Promise((resolve) => {
    const s = app.listen(config.port, () => resolve(s));
  });
  console.log(`micro-flow-editor running → http://localhost:${server.address().port} (database: ${sequelize.getDialect()})`);

  const close = async () => {
    unregisterAll();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(() => resolve()));
    await sequelize.close();
  };
  return { app, server, close };
}
