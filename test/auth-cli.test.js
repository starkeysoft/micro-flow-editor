// ADMIN_USERNAME/ADMIN_PASSWORD at startup, and the `user` CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfe-auth-'));
const db = path.join(dir, 'flows.sqlite');
const bin = path.resolve('bin/micro-flow-editor.js');

const cli = (args, input = '') => spawnSync(process.execPath, [bin, '--sqlite', db, 'user', ...args], {
  input, encoding: 'utf8', env: { ...process.env, DATABASE_URL: '' },
});

test('user CLI adds, lists, resets and removes accounts', () => {
  let r = cli(['add', 'ada'], 'first password\n');
  assert.equal(r.status, 0, r.stderr);
  r = cli(['add', 'ada'], 'second password\n');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already exists/);
  r = cli(['passwd', 'ada'], 'short\n');
  assert.equal(r.status, 1, 'password policy applies');
  r = cli(['passwd', 'ada'], 'a new password\n');
  assert.equal(r.status, 0, r.stderr);
  r = cli(['list']);
  assert.match(r.stdout, /^ada\t/m);
  r = cli(['remove', 'ada']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(cli(['list']).stdout, /No accounts yet/);
});

test('ADMIN_USERNAME/ADMIN_PASSWORD create the account at startup', async () => {
  process.env.SQLITE_PATH = db;
  process.env.DATABASE_URL = '';
  const { startServer } = await import('../lib/index.js');
  const editor = await startServer({ port: 0, admin_username: 'boss', admin_password: 'boss password' });
  const base = `http://127.0.0.1:${editor.server.address().port}`;
  // Sign-in is still off (nothing turned it on), but the account exists.
  const session = await (await fetch(`${base}/api/auth/session`)).json();
  assert.equal(session.auth_enabled, false);
  assert.equal(session.has_users, true);
  const res = await fetch(`${base}/api/auth/enable`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'boss', password: 'boss password' }),
  });
  assert.equal(res.status, 200);
  await editor.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
