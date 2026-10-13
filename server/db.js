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

// Saved versions of a flow. The editor autosaves every change into the flow
// row itself; Save adds a snapshot here. Active flows' webhooks and schedules
// run the latest snapshot, so half-finished edits never go live.
export const Snapshot = sequelize.define('Snapshot', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  label: { type: DataTypes.STRING(200), allowNull: false, defaultValue: '' },
  // The flow's name and description when the snapshot was taken.
  name: { type: DataTypes.STRING(200), allowNull: false },
  description: { type: DataTypes.STRING(1000), allowNull: false, defaultValue: '' },
  graph: json('graph', { nodes: [], edges: [] }),
  options: json('options', { exit_on_error: true }),
  // Who saved it (sign-in on), or null.
  created_by: { type: DataTypes.STRING(64), allowNull: true },
}, { tableName: 'snapshots' });

// Archived flows: taken out of the flows table, with only their most recent
// snapshot kept (copied here). Unarchiving recreates the flow (same id) from
// that snapshot. The row id is the flow's id.
export const ArchivedFlow = sequelize.define('ArchivedFlow', {
  id: { type: DataTypes.UUID, primaryKey: true },
  // The flow's name and description in the kept snapshot.
  name: { type: DataTypes.STRING(200), allowNull: false },
  description: { type: DataTypes.STRING(1000), allowNull: false, defaultValue: '' },
  graph: json('graph', { nodes: [], edges: [] }),
  options: json('options', { exit_on_error: true }),
  // The kept snapshot itself, so unarchiving restores it unchanged.
  snapshot_id: { type: DataTypes.UUID, allowNull: false },
  snapshot_label: { type: DataTypes.STRING(200), allowNull: false, defaultValue: '' },
  snapshot_created_by: { type: DataTypes.STRING(64), allowNull: true },
  snapshot_created_at: { type: DataTypes.DATE, allowNull: false },
  flow_created_at: { type: DataTypes.DATE, allowNull: true },
  archived_at: { type: DataTypes.DATE, allowNull: false },
  // Who archived it (sign-in on), or null.
  archived_by: { type: DataTypes.STRING(64), allowNull: true },
}, { tableName: 'archived_flows' });

// Editor-wide settings changed from the UI, as JSON values by key
// (currently just auth_enabled).
export const Setting = sequelize.define('Setting', {
  key: { type: DataTypes.STRING(64), primaryKey: true },
  value: { type: DataTypes.STRING(1000), allowNull: false },
}, { tableName: 'settings' });

export async function getSetting(key, fallback = null) {
  const row = await Setting.findByPk(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}

export async function putSetting(key, value) {
  await Setting.upsert({ key, value: JSON.stringify(value) });
}

// Login accounts (only used when sign-in is on). Every user can see and
// edit every flow; there are no roles.
export const User = sequelize.define('User', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  username: { type: DataTypes.STRING(64), allowNull: false, unique: true },
  // scrypt$N$r$p$salt$hash (see server/auth.js)
  password_hash: { type: DataTypes.STRING(255), allowNull: false },
  last_login_at: { type: DataTypes.DATE, allowNull: true },
}, { tableName: 'users' });

// Sign-in sessions. The cookie holds a random token; only its SHA-256 is stored.
export const Session = sequelize.define('Session', {
  id: { type: DataTypes.STRING(64), primaryKey: true },
  expires_at: { type: DataTypes.DATE, allowNull: false },
}, { tableName: 'sessions' });

User.hasMany(Session, { foreignKey: { name: 'user_id', allowNull: false }, onDelete: 'CASCADE' });
Session.belongsTo(User, { foreignKey: 'user_id' });

function fillJsonDefaults(model, fallbacks) {
  model.addHook('beforeValidate', (instance) => {
    for (const [column, fallback] of Object.entries(fallbacks)) {
      if (instance.getDataValue(column) == null) instance.setDataValue(column, JSON.stringify(fallback));
    }
  });
}

fillJsonDefaults(Flow, { graph: { nodes: [], edges: [] }, options: { exit_on_error: true } });
fillJsonDefaults(Execution, { graph: { nodes: [], edges: [] }, node_runs: {}, log: [], outputs: [] });
fillJsonDefaults(Snapshot, { graph: { nodes: [], edges: [] }, options: { exit_on_error: true } });
fillJsonDefaults(ArchivedFlow, { graph: { nodes: [], edges: [] }, options: { exit_on_error: true } });

Flow.hasMany(Execution, { foreignKey: { name: 'flow_id', allowNull: false }, onDelete: 'CASCADE' });
Execution.belongsTo(Flow, { foreignKey: 'flow_id' });
Flow.hasMany(Snapshot, { foreignKey: { name: 'flow_id', allowNull: false }, onDelete: 'CASCADE' });
Snapshot.belongsTo(Flow, { foreignKey: 'flow_id' });

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
