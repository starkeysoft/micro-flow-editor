#!/usr/bin/env node
// CLI: starts the editor. Flags override the matching environment variables.
//   micro-flow-editor [--port 8090] [--database-url <url>] [--sqlite <file>] [--block-private-networks]
const args = process.argv.slice(2);
const flags = {
  '--port': 'PORT',
  '-p': 'PORT',
  '--database-url': 'DATABASE_URL',
  '--db': 'DATABASE_URL',
  '--sqlite': 'SQLITE_PATH',
};

for (let i = 0; i < args.length; i++) {
  const eq = args[i].indexOf('=');
  const flag = eq === -1 ? args[i] : args[i].slice(0, eq);
  const inline = eq === -1 ? undefined : args[i].slice(eq + 1);
  if (flag === '--help' || flag === '-h') {
    console.log(`Usage: micro-flow-editor [options]

  -p, --port <port>          port to listen on (default 8090, env PORT)
  --db, --database-url <url> Sequelize URL: postgres://…, mysql://…, mariadb://…,
                             mssql://…, sqlite:… (env DATABASE_URL)
  --sqlite <file>            SQLite file when no URL is given
                             (default data/micro-flow-editor.sqlite, env SQLITE_PATH)
  --block-private-networks[=true|false]
                             stop HTTP Request nodes reaching private addresses
  -h, --help                 show this help`);
    process.exit(0);
  }
  if (flag === '--block-private-networks') {
    process.env.BLOCK_PRIVATE_NETWORKS = inline ?? 'true';
  } else if (flags[flag]) {
    process.env[flags[flag]] = inline ?? args[++i];
  } else {
    console.error(`Unknown option ${args[i]}. Try --help.`);
    process.exit(1);
  }
}

await import('../server/index.js');
