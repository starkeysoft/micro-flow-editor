// AUTH_ENABLED=true: sign-in forced on, the editor toggle locked, first-run setup.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../lib/index.js';
import { client } from './auth-helpers.js';

let editor;
let base;

before(async () => {
  // A bad ADMIN_PASSWORD only warns; behind a proxy, X-Forwarded-Host is used.
  editor = await startServer({
    port: 0, database_url: 'sqlite::memory:', auth_enabled: true,
    admin_username: 'admin', admin_password: 'short', trust_proxy: 'true',
  });
  base = `http://127.0.0.1:${editor.server.address().port}`;
});
after(() => editor.close());

test('forced on: first account, locked toggle', async () => {
  const first = client(base);
  let r = await first.get('/api/auth/session');
  assert.equal(r.data.auth_enabled, true);
  assert.equal(r.data.auth_locked, true);
  assert.equal(r.data.needs_setup, true);
  assert.equal((await first.get('/api/flows')).status, 401);

  assert.equal((await first.post('/api/auth/setup', { username: 'root', password: 'root password' })).status, 201);
  assert.equal((await first.get('/api/flows')).status, 200);
  assert.equal((await client(base).post('/api/auth/setup', { username: 'late', password: 'late password' })).status, 409, 'setup only once');

  assert.equal((await first.post('/api/auth/disable')).status, 409, 'can\'t switch off what AUTH_ENABLED forces');

  // A proxy that rewrites Host: the Origin matches X-Forwarded-Host instead.
  const proxied = { origin: 'https://flows.example.com', 'x-forwarded-host': 'flows.example.com', 'x-forwarded-proto': 'https' };
  assert.equal((await first.post('/api/flows', { name: 'via proxy' }, proxied)).status, 201);
  assert.equal((await first.post('/api/flows', { name: 'x' }, { ...proxied, origin: 'https://evil.example' })).status, 403);
  r = await first.get('/api/auth/session');
  assert.equal(r.data.needs_setup, false);
  assert.equal(r.data.user.username, 'root');
});
