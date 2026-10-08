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
};
