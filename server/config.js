// Runtime settings, all read from the environment (see .env.example).
const env = process.env;

const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

export const config = {
  // 0 picks a free port.
  port: env.PORT !== undefined && env.PORT !== '' && Number.isFinite(Number(env.PORT)) ? Number(env.PORT) : 8090,

  // Any Sequelize connection URL: sqlite:, postgres:, mysql:, mariadb:, mssql:.
  // Defaults to a SQLite file under ./data.
  database_url: env.DATABASE_URL || '',
  sqlite_path: env.SQLITE_PATH || 'data/micro-flow-editor.sqlite',
  db_logging: bool(env.DB_LOGGING, false),

  // Server-side HTTP Request nodes may not reach private, loopback or
  // link-local addresses when this is on. Turn it on for a public deployment.
  block_private_networks: bool(env.BLOCK_PRIVATE_NETWORKS, false),

  // Limits that keep one flow from swamping the server.
  max_concurrent_runs: Number(env.MAX_CONCURRENT_RUNS) || 10,
  max_loop_iterations: Number(env.MAX_LOOP_ITERATIONS) || 1000,
  max_executions_per_flow: Number(env.MAX_EXECUTIONS_PER_FLOW) || 100,

  // Editor autosave: every change goes into a cache and a background worker
  // writes changed flows to the database every FLUSH_INTERVAL_MS. The cache is
  // in-process unless REDIS_URL is set (then Redis, which survives a crash of
  // this process and can be shared by several editor instances).
  redis_url: env.REDIS_URL || '',
  flush_interval_ms: Math.max(100, Number(env.FLUSH_INTERVAL_MS) || 1000),
  // Snapshots kept per flow (Save creates one); 0 keeps them all.
  max_snapshots_per_flow: env.MAX_SNAPSHOTS_PER_FLOW === undefined || env.MAX_SNAPSHOTS_PER_FLOW === ''
    ? 100 : Math.max(0, Number(env.MAX_SNAPSHOTS_PER_FLOW) || 0),

  // Optional login, off by default. When on, everything under /api needs a
  // signed-in user; /webhook/* stays public so outside callers still work.
  // Set AUTH_ENABLED to force it on or off (the editor's toggle is then
  // locked); leave it unset to switch it in the editor (stored in the
  // settings table).
  auth_enabled_env: env.AUTH_ENABLED === undefined || env.AUTH_ENABLED === '' ? null : bool(env.AUTH_ENABLED, false),
  // Creates this account at startup when it doesn't exist yet (never changes
  // an existing one). Without it, the first visitor creates the first account.
  admin_username: env.ADMIN_USERNAME || '',
  admin_password: env.ADMIN_PASSWORD || '',
  session_ttl_hours: Number(env.SESSION_TTL_HOURS) || 168,
  // Set when running behind a reverse proxy (Express "trust proxy"), so
  // client IPs and HTTPS (for Secure cookies) are read from X-Forwarded-*.
  trust_proxy: env.TRUST_PROXY || '',
};
