// Persistence through Sequelize, so any SQL database it supports works:
// SQLite (the default), PostgreSQL, MySQL, MariaDB and SQL Server. Pick one
// with DATABASE_URL; the driver for each is installed with the app.
import fs from 'fs';
import path from 'path';
import { Sequelize, DataTypes } from 'sequelize';
import { config } from './config.js';

function connect() {
  const logging = config.db_logging ? console.log : false;

  if (config.database_url && !config.database_url.startsWith('sqlite:')) {
    return new Sequelize(config.database_url, { logging });
  }

  const storage = config.database_url
    ? config.database_url.replace(/^sqlite:(\/\/)?/, '')
    : config.sqlite_path;
  if (storage !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(storage)), { recursive: true });
  return new Sequelize({ dialect: 'sqlite', storage, logging });
}

export const sequelize = connect();

// TEXT columns holding JSON, so every dialect stores them the same way.
// LONGTEXT on MySQL/MariaDB (plain TEXT caps at 64 KB there); TEXT elsewhere.
// MySQL doesn't allow defaults on TEXT columns, so fillJsonDefaults() fills
// in missing values before validation instead of a column DEFAULT.
const long_text = ['mysql', 'mariadb'].includes(sequelize.getDialect()) ? DataTypes.TEXT('long') : DataTypes.TEXT;

const json = (name, fallback) => ({
  type: long_text,
  allowNull: false,
  get() {
    const raw = this.getDataValue(name);
    try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
  },
  set(value) {
    this.setDataValue(name, JSON.stringify(value ?? fallback));
  },
});

export const Flow = sequelize.define('Flow', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(200), allowNull: false },
  description: { type: DataTypes.STRING(1000), allowNull: false, defaultValue: '' },
  // { nodes: [{ id, type, name, x, y, config, settings }], edges: [{ id, from, port, to }] }
  graph: json('graph', { nodes: [], edges: [] }),
  // { exit_on_error }
  options: json('options', { exit_on_error: true }),
  // Active flows listen on their Schedule and Webhook triggers.
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, { tableName: 'flows' });

export const Execution = sequelize.define('Execution', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  // manual | webhook | schedule
  mode: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'manual' },
  // running | success | error | stopped
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'running' },
  started_at: { type: DataTypes.DATE, allowNull: false },
  finished_at: { type: DataTypes.DATE, allowNull: true },
  error: { type: DataTypes.TEXT, allowNull: true },
  // The graph that ran, so old executions still open after the flow changes.
  graph: json('graph', { nodes: [], edges: [] }),
  // { [node_id]: [{ status, input, output, error, ms, attempt, at }] }
  node_runs: json('node_runs', {}),
  // [{ at, event, node_id, step, text, level }]
  log: json('log', []),
  // Cards from Output nodes: [{ title, text, image, tone, at }]
  outputs: json('outputs', []),
}, { tableName: 'executions' });

function fillJsonDefaults(model, fallbacks) {
  model.addHook('beforeValidate', (instance) => {
    for (const [column, fallback] of Object.entries(fallbacks)) {
      if (instance.getDataValue(column) == null) instance.setDataValue(column, JSON.stringify(fallback));
    }
  });
}

fillJsonDefaults(Flow, { graph: { nodes: [], edges: [] }, options: { exit_on_error: true } });
fillJsonDefaults(Execution, { graph: { nodes: [], edges: [] }, node_runs: {}, log: [], outputs: [] });

Flow.hasMany(Execution, { foreignKey: { name: 'flow_id', allowNull: false }, onDelete: 'CASCADE' });
Execution.belongsTo(Flow, { foreignKey: 'flow_id' });

export async function initDatabase({ attempts = 30, delay_ms = 2000 } = {}) {
  // A database container may still be starting (docker compose), so retry.
  for (let attempt = 1; ; attempt++) {
    try {
      await sequelize.authenticate();
      break;
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.log(`Waiting for the database (${error.message})…`);
      await new Promise((resolve) => setTimeout(resolve, delay_ms));
    }
  }
  // Creates missing tables and never drops data. Use migrations if you need
  // to change columns on an existing production database.
  await sequelize.sync();
}
